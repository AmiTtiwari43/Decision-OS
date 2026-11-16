import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp, redactUrlCredentials } from '../src/app';
import { env as defaultEnv } from '../src/config/env';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard';
import { UserModel } from '../src/models/user.model';
import { DecisionModel } from '../src/models/decision.model';
import { createDecision } from '../src/services/decision.service';
import { collaborationService } from '../src/services/collaboration.service';

const TEST_MONGODB_URI = getTestDatabaseUri(undefined, { runId: 'sse_transport' });
assertTestDatabase(TEST_MONGODB_URI);

const WEB_ORIGIN = 'http://localhost:5173';

/** Opens a real HTTP connection and resolves with the response status and headers, then aborts. */
function readStreamHeaders(
  port: number,
  path: string,
  headers: Record<string, string>
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
      res.destroy();
      req.destroy();
    });
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
    });
  });
}

describe('Collaboration SSE transport (real HTTP listener)', () => {
  let app: FastifyInstance;
  let port: number;
  let ownerToken: string;
  let decisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as AddressInfo).port;

    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    const owner = await UserModel.create({
      email: 'sse-owner@example.com',
      passwordHash: 'dummy_hash',
      name: 'SSE Owner',
      role: 'user',
    });
    const ownerId = owner._id.toString();
    ownerToken = app.jwt.sign({ sub: ownerId, id: ownerId, email: owner.email, name: owner.name, role: owner.role });

    const decision = await createDecision(
      {
        title: 'SSE transport decision',
        criteria: [{ id: 'c1', name: 'Speed', weight: 100, direction: 'benefit', isLocked: false }],
        options: [
          { id: 'o1', name: 'A' },
          { id: 'o2', name: 'B' },
        ],
        scores: { o1: { c1: 60 }, o2: { c1: 40 } },
      },
      { id: ownerId, email: owner.email, name: owner.name, role: 'user' }
    );
    decisionId = decision._id.toString();
  });

  afterAll(async () => {
    collaborationService.reset();
    await app.close();
    await disconnectFromDatabase();
  });

  it('sends CORS headers on the hijacked event-stream response so browsers can connect', async () => {
    const res = await readStreamHeaders(
      port,
      `/api/decisions/${decisionId}/collaboration/stream?token=${encodeURIComponent(ownerToken)}`,
      { origin: WEB_ORIGIN, accept: 'text/event-stream' }
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant CORS to an unlisted origin on the stream', async () => {
    const res = await readStreamHeaders(
      port,
      `/api/decisions/${decisionId}/collaboration/stream`,
      { origin: 'https://evil.example', authorization: `Bearer ${ownerToken}` }
    );

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Request log credential redaction', () => {
  it('redacts token and access_token query values', () => {
    expect(redactUrlCredentials('/api/x/stream?token=eyJabc.def&lastEventId=5')).toBe(
      '/api/x/stream?token=[REDACTED]&lastEventId=5'
    );
    expect(redactUrlCredentials('/a?b=1&access_token=secret')).toBe('/a?b=1&access_token=[REDACTED]');
    expect(redactUrlCredentials('/api/health')).toBe('/api/health');
  });
});

describe('CORS allowlist in production', () => {
  it('does not implicitly trust localhost development origins', async () => {
    const prodApp = await buildApp({
      env: { ...defaultEnv, NODE_ENV: 'production', CORS_ORIGIN: 'https://decisions.example.com' },
      enableRateLimit: false,
    });
    try {
      const allowed = await prodApp.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: { origin: 'https://decisions.example.com', 'access-control-request-method': 'GET' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://decisions.example.com');

      const dev = await prodApp.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' },
      });
      expect(dev.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await prodApp.close();
    }
  });
});
