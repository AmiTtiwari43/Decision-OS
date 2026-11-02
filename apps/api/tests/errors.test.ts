import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import { validateEnv } from '../src/config/env';

describe('API Foundation — Centralized Error Handling', () => {
  it('returns structured 404 JSON for unknown routes', async () => {
    const app = await buildApp();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/non-existent-route',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');

    const body = response.json();
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route GET /non-existent-route not found',
    });
    expect(body.requestId).toBeDefined();

    await app.close();
  });

  it('handles unexpected exceptions and returns RFC JSON error with request ID', async () => {
    const app = await buildApp();

    // Register a route that throws an unhandled error
    app.get('/test-error', async () => {
      throw new Error('Something broke internally');
    });

    await app.ready();

    const customReqId = 'trace-err-999';
    const response = await app.inject({
      method: 'GET',
      url: '/test-error',
      headers: {
        'x-request-id': customReqId,
      },
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      requestId: customReqId,
    });
    expect(body.message).toBe('Something broke internally');

    await app.close();
  });

  it('masks stack traces and internal messages in production mode', async () => {
    const prodEnv = validateEnv({
      NODE_ENV: 'production',
      PORT: '3000',
      JWT_SECRET: 'production-jwt-signing-secret-for-tests-only!',
    });

    const app = await buildApp({ env: prodEnv, logger: false });

    app.get('/test-prod-error', async () => {
      throw new Error('Sensitive database credentials failed');
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test-prod-error',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.message).not.toContain('Sensitive database');

    await app.close();
  });
});
