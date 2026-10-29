import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

describe('Authentication API — /api/auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user with valid details and returns a JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Test Engineer',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user).toBeDefined();
      expect(body.user.id).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.name).toBe('Test Engineer');
      expect(body.user.role).toBe('user');
      expect(body.user.passwordHash).toBeUndefined();
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
    });

    it('rejects registration with duplicate email with 409 Conflict', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'dup@example.com',
          password: 'Password123!',
          name: 'First User',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'DUP@example.com', // Case insensitivity check
          password: 'Password456!',
          name: 'Second User',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error).toBe('Conflict');
      expect(body.message).toMatch(/already exists/i);
    });

    it('rejects password shorter than 8 characters with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'short@example.com',
          password: 'short',
          name: 'Short Password User',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Bad Request');
      expect(body.message).toMatch(/at least 8 characters/i);
    });

    it('rejects invalid email formats with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'not-an-email',
          password: 'ValidPassword123!',
          name: 'Invalid Email User',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Bad Request');
      expect(body.message).toMatch(/valid email/i);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'alice@example.com',
          password: 'CorrectPassword123!',
          name: 'Alice Cooper',
        },
      });
    });

    it('authenticates valid credentials and returns user profile and JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'alice@example.com',
          password: 'CorrectPassword123!',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.email).toBe('alice@example.com');
      expect(body.user.name).toBe('Alice Cooper');
      expect(body.user.passwordHash).toBeUndefined();
      expect(body.token).toBeDefined();
    });

    it('rejects incorrect password with generic 401 message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'alice@example.com',
          password: 'WrongPassword!',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toBe('Invalid email or password');
    });

    it('rejects nonexistent email with identical generic 401 message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'AnyPassword123!',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/auth/me', () => {
    let validToken: string;

    beforeEach(async () => {
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'me@example.com',
          password: 'Password123!',
          name: 'Profile User',
        },
      });
      validToken = regRes.json().token;
    });

    it('returns the current user profile with valid Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('me@example.com');
      expect(body.user.name).toBe('Profile User');
      expect(body.user.passwordHash).toBeUndefined();
    });

    it('returns 401 when Authorization header is omitted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toMatch(/Authentication required/i);
    });

    it('returns 401 when token is tampered', async () => {
      const tamperedToken = validToken.slice(0, -6) + 'abcdef';
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
      expect(body.message).toMatch(/invalid or expired/i);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 200 indicating logout success', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.message).toMatch(/logged out/i);
    });
  });
});

