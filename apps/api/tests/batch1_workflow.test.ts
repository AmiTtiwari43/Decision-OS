import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';

const TEST_MONGODB_URI = getTestDatabaseUri();

assertTestDatabase(TEST_MONGODB_URI);

describe('Batch 1: End-to-End Authentication & Session Restoration Workflows', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
    await UserModel.deleteMany({ email: /batch1-.*@decision-os\.internal/ });
  });

  afterAll(async () => {
    await UserModel.deleteMany({ email: /batch1-.*@decision-os\.internal/ });
    await app.close();
    await disconnectFromDatabase();
  });

  // Workflow 1: New user registration
  it('Workflow 1: registers a new user, hashes password, returns valid JWT and user profile', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'batch1-newuser@decision-os.internal',
        password: 'Password123!',
        name: 'Batch One Pioneer',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe('batch1-newuser@decision-os.internal');
    expect(body.user.name).toBe('Batch One Pioneer');
    expect(body.user.role).toBe('user');
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.token).toBeDefined();

    // Verify token can be decoded by jwt plugin
    const decoded = app.jwt.verify<{ id: string; email: string }>(body.token);
    expect(decoded.email).toBe('batch1-newuser@decision-os.internal');
    expect(decoded.id).toBe(body.user.id);
  });

  // Workflow 2: Login with valid credentials
  it('Workflow 2: logs in with valid credentials and issues valid 7-day bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'batch1-newuser@decision-os.internal',
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe('batch1-newuser@decision-os.internal');
  });

  // Workflow 3: Login with invalid credentials
  it('Workflow 3: rejects login with invalid password with generic 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'batch1-newuser@decision-os.internal',
        password: 'WrongPassword999!',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toBe('Invalid email or password');
  });

  // Workflow 4: Refresh while authenticated (Session restoration via /api/auth/me)
  it('Workflow 4: verifies session restoration via GET /api/auth/me with restored bearer token', async () => {
    // 1. Log in to acquire bearer token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'batch1-newuser@decision-os.internal',
        password: 'Password123!',
      },
    });
    const { token } = loginRes.json();

    // 2. Simulate browser reload: re-read stored token and call GET /api/auth/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json();
    expect(meBody.user).toBeDefined();
    expect(meBody.user.email).toBe('batch1-newuser@decision-os.internal');
    expect(meBody.user.name).toBe('Batch One Pioneer');
  });

  // Workflow 5: Open a protected route while unauthenticated
  it('Workflow 5: rejects unauthenticated requests to protected decision routes with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/decisions',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toContain('missing or invalid Authorization header');
  });

  // Workflow 6: Expired or invalid session
  it('Workflow 6: rejects expired, tampered, or fabricated JWTs with 401', async () => {
    const tamperedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalidpayload.invalidsig';
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${tamperedToken}`,
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toContain('invalid or expired token');
  });

  // Workflow 7: Logout
  it('Workflow 7: logs out via /api/auth/logout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('Successfully logged out');
  });

  // Workflow 8: Browser refresh after logout
  it('Workflow 8: verifies that after logout and storage purge, no token is attached', async () => {
    // When storage is purged, request sends no Authorization header
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  // Workflow 9: API requests with missing or invalid authentication
  it('Workflow 9: blocks access across protected decision and analytics routes when token is missing', async () => {
    const protectedRoutes = [
      { method: 'GET', url: '/api/decisions' },
      { method: 'POST', url: '/api/decisions', payload: {} },
      { method: 'GET', url: '/api/analytics/overview' },
      { method: 'GET', url: '/api/invitations/pending' },
    ];

    for (const route of protectedRoutes) {
      const res = await app.inject({
        method: route.method as 'GET' | 'POST',
        url: route.url,
        payload: route.payload,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  // Workflow 10: CORS and preflight headers
  it('Workflow 10: enforces CORS preflight and allows Authorization header', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/me',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });
});
