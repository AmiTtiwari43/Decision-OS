import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env as defaultEnv } from '../src/config/env';
import { AUTH_RATE_LIMIT } from '../src/routes/auth';

/**
 * Login and registration have a tight per-IP limit on top of the global API
 * limit. Requests use invalid bodies (400 before any database access); the
 * limiter counts them in its onRequest hook regardless.
 */
describe('Auth endpoint rate limiting', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  for (const path of ['/api/auth/login', '/api/auth/register']) {
    it(`returns 429 on ${path} after ${AUTH_RATE_LIMIT.max} attempts per window`, async () => {
      app = await buildApp({ env: { ...defaultEnv, NODE_ENV: 'development', LOG_LEVEL: 'silent' } });

      const statuses: number[] = [];
      for (let i = 0; i < AUTH_RATE_LIMIT.max + 1; i++) {
        const res = await app.inject({ method: 'POST', url: path, payload: {} });
        statuses.push(res.statusCode);
      }

      expect(statuses.slice(0, AUTH_RATE_LIMIT.max).every(s => s === 400)).toBe(true);
      expect(statuses[AUTH_RATE_LIMIT.max]).toBe(429);
    });
  }

  it('does not apply the auth limit to other endpoints', async () => {
    app = await buildApp({ env: { ...defaultEnv, NODE_ENV: 'development', LOG_LEVEL: 'silent' } });
    for (let i = 0; i < AUTH_RATE_LIMIT.max + 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).not.toBe(429);
    }
  });
});
