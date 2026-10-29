import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import {
  connectToDatabase,
  disconnectFromDatabase,
} from '../../src/db/connection';
import { assertTestDatabase } from '../../src/db/guard';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

describe('Health and Readiness Endpoints Integration', () => {
  let app: FastifyInstance;

  assertTestDatabase(TEST_MONGODB_URI);

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  it('GET /health returns 200 liveness signal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      status: 'ok',
      service: 'decision-os-api',
      version: '1.0.0',
    });
  });

  it('GET /health/ready returns 200 with database: connected when connected', async () => {
    await connectToDatabase(TEST_MONGODB_URI);

    const res = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('decision-os-api');
    expect(body.database).toBe('connected');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('GET /health/ready returns 503 with database: disconnected when disconnected', async () => {
    await disconnectFromDatabase();

    const res = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.service).toBe('decision-os-api');
    expect(body.database).toBe('disconnected');
    expect(body.error).toBeDefined();

    // Verify /health process liveness still reports 200 even when database is disconnected
    const livenessRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(livenessRes.statusCode).toBe(200);
    expect(livenessRes.json().status).toBe('ok');
  });
});
