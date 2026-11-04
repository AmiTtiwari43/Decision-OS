import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';
import { DecisionModel } from '../src/models/decision.model.js';

const TEST_MONGODB_URI = getTestDatabaseUri();

assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Architecture Choice',
  description: 'Evaluate compute platforms',
  criteria: [
    { id: 'cost', name: 'Cost', weight: 50, direction: 'benefit' as const },
    { id: 'perf', name: 'Performance', weight: 50, direction: 'benefit' as const },
  ],
  options: [
    { id: 'aws', name: 'AWS' },
    { id: 'gcp', name: 'GCP' },
  ],
  scores: {
    aws: { cost: 80, perf: 90 },
    gcp: { cost: 85, perf: 85 },
  },
};

describe('Decision Ownership & Authorization — /api/decisions', () => {
  let app: FastifyInstance;
  let userAToken: string;
  let userAId: string;
  let userBToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});

    // Register User A
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'user-a@example.com',
        password: 'Password123!',
        name: 'User Alpha',
      },
    });
    const bodyA = resA.json();
    userAToken = bodyA.token;
    userAId = bodyA.user.id;

    // Register User B
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'user-b@example.com',
        password: 'Password123!',
        name: 'User Beta',
      },
    });
    const bodyB = resB.json();
    userBToken = bodyB.token;

    // Create Admin User directly in DB to test admin role
    const adminUser = new UserModel({
      email: 'admin@example.com',
      passwordHash: 'dummy_hash',
      name: 'Super Admin',
      role: 'admin',
    });
    await adminUser.save();
    adminToken = app.jwt.sign({
      sub: adminUser._id.toString(),
      id: adminUser._id.toString(),
      email: adminUser.email,
      role: 'admin',
    });
  });

  it('rejects unauthenticated requests to /api/decisions with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/decisions',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('assigns authenticated user as owner on decision creation and strips spoofed ownerId', async () => {
    const spoofedOwnerId = '660000000000000000000099';
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: {
        authorization: `Bearer ${userAToken}`,
      },
      payload: {
        ...baseDecisionPayload,
        ownerId: spoofedOwnerId, // Client attempt to spoof ownership
      },
    });

    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created._id || created.id).toBeDefined();

    // Verify in DB that ownerId is strictly userAId, not the spoofed id
    const doc = await DecisionModel.findById(created._id || created.id);
    expect(doc).toBeDefined();
    expect(doc?.ownerId?.toString()).toBe(userAId);
    expect(doc?.ownerId?.toString()).not.toBe(spoofedOwnerId);
  });

  it('allows owner to get, update, analyze, and delete their own decision', async () => {
    // 1. Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: baseDecisionPayload,
    });
    expect(createRes.statusCode).toBe(201);
    const decId = createRes.json()._id || createRes.json().id;

    // 2. Get
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(getRes.statusCode).toBe(200);

    // 3. Update
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        ...baseDecisionPayload,
        title: 'Updated Cloud Choice',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().title).toBe('Updated Cloud Choice');

    // 4. Analyze
    const analyzeRes = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decId}/analyze`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(analyzeRes.statusCode).toBe(200);
    expect(analyzeRes.json().analysis).toBeDefined();

    // 5. Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it('returns 404 (NOT 403) when User B attempts to access User A private decision (enumeration prevention)', async () => {
    // User A creates a decision
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: baseDecisionPayload,
    });
    const decId = createRes.json()._id || createRes.json().id;

    // User B attempts to GET User A's decision
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error).toBe('Not Found');

    // User B attempts to PUT User A's decision
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${userBToken}` },
      payload: {
        ...baseDecisionPayload,
        title: 'Hijacked Decision Title',
      },
    });
    expect(putRes.statusCode).toBe(404);
    expect(putRes.json().error).toBe('Not Found');

    // User B attempts to DELETE User A's decision
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(delRes.statusCode).toBe(404);
    expect(delRes.json().error).toBe('Not Found');

    // User B attempts to POST /analyze User A's decision
    const analyzeRes = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decId}/analyze`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(analyzeRes.statusCode).toBe(404);
    expect(analyzeRes.json().error).toBe('Not Found');
  });

  it('strictly isolates listings: User A sees only A decisions and User B sees only B decisions', async () => {
    // User A creates 2 decisions
    await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: { ...baseDecisionPayload, title: 'Alpha Decision 1' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: { ...baseDecisionPayload, title: 'Alpha Decision 2' },
    });

    // User B creates 1 decision
    await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userBToken}` },
      payload: { ...baseDecisionPayload, title: 'Beta Decision 1' },
    });

    // User A lists decisions
    const resA = await app.inject({
      method: 'GET',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(resA.statusCode).toBe(200);
    const listA = resA.json();
    expect(listA.total).toBe(2);
    expect(listA.items.every((d: any) => d.title.startsWith('Alpha'))).toBe(true);

    // User B lists decisions
    const resB = await app.inject({
      method: 'GET',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(resB.statusCode).toBe(200);
    const listB = resB.json();
    expect(listB.total).toBe(1);
    expect(listB.items[0].title).toBe('Beta Decision 1');
  });

  it('allows administrator to access and manage decisions across all owners', async () => {
    // User A creates a decision
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: baseDecisionPayload,
    });
    const decId = createRes.json()._id || createRes.json().id;

    // Admin can GET User A's decision
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);

    // Admin can UPDATE User A's decision
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/decisions/${decId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...baseDecisionPayload,
        title: 'Admin Moderated Decision',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().title).toBe('Admin Moderated Decision');
  });
});
