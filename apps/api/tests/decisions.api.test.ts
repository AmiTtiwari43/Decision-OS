import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';

const TEST_MONGODB_URI = getTestDatabaseUri();

assertTestDatabase(TEST_MONGODB_URI);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const baseCriteria = [
  { id: 'cost', name: 'Cost', weight: 50, direction: 'benefit' as const },
  { id: 'perf', name: 'Performance', weight: 50, direction: 'benefit' as const },
];

const baseOptions = [
  { id: 'opt-a', name: 'Option A' },
  { id: 'opt-b', name: 'Option B' },
];

const completeScores = {
  'opt-a': { cost: 80, perf: 90 },
  'opt-b': { cost: 70, perf: 60 },
};

const tiedScores = {
  'opt-a': { cost: 80, perf: 80 },
  'opt-b': { cost: 80, perf: 80 },
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Decision API — /api/decisions', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();

    await UserModel.deleteMany({});
    const user = new UserModel({
      email: 'decisions-api-test@example.com',
      passwordHash: 'dummy_hash',
      name: 'API Test User',
      role: 'user',
    });
    await user.save();
    authToken = app.jwt.sign({
      sub: user._id.toString(),
      id: user._id.toString(),
      email: user.email,
      role: 'user',
    });
  });

  const injectAuth = (options: Parameters<FastifyInstance['inject']>[0]) => {
    const headers = {
      authorization: `Bearer ${authToken}`,
      ...options.headers,
    };
    return app.inject({ ...options, headers });
  };

  afterAll(async () => {
    await DecisionModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
  });

  // ── POST /api/decisions ───────────────────────────────────────────────────

  it('1. POST /api/decisions (title only) → 201 with analysis null', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: { title: 'Simple decision' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('Simple decision');
    expect(body.analysis).toBeNull();
  });

  it('2. POST /api/decisions (complete scores) → 201 with analysis populated', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Full decision',
        criteria: baseCriteria,
        options: baseOptions,
        scores: completeScores,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.analysis).not.toBeNull();
    expect(body.analysis.engineVersion).toBe('1.0.0');
    expect(body.analysis.winnerId).toBeDefined();
  });

  it('3. POST /api/decisions (missing title) → 400', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: { description: 'No title here' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('4. POST /api/decisions (score out of range > 100) → 400', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Bad score',
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-a': { cost: 101, perf: 50 }, 'opt-b': { cost: 50, perf: 50 } },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('5. POST /api/decisions (infinite score via null) → 400', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Null score',
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-a': { cost: null, perf: 50 }, 'opt-b': { cost: 50, perf: 50 } },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('6. POST /api/decisions (duplicate criterion ID) → 400', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Dup criterion',
        criteria: [
          { id: 'dup', name: 'First', weight: 50, direction: 'benefit' },
          { id: 'dup', name: 'Second', weight: 50, direction: 'benefit' },
        ],
        options: baseOptions,
        scores: {},
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('7. POST /api/decisions (client winner field) → 201, winner not in response', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Winner injection test',
        winner: 'malicious-winner-id',
        winnerId: 'another-injection',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.winner).toBeUndefined();
    expect(body.winnerId).toBeUndefined();
  });

  it('8. POST /api/decisions (client analysis field) → 201, server analysis wins', async () => {
    const fakeAnalysis = {
      engineVersion: '9.9.9',
      winnerId: 'fake-winner',
      isTie: false,
    };
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Analysis injection test',
        analysis: fakeAnalysis,
        criteria: baseCriteria,
        options: baseOptions,
        scores: completeScores,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Server should have computed a real analysis (engineVersion === '1.0.0'), not the client fake
    expect(body.analysis).not.toBeNull();
    expect(body.analysis.engineVersion).toBe('1.0.0');
    expect(body.analysis.winnerId).not.toBe('fake-winner');
  });

  // ── GET /api/decisions ────────────────────────────────────────────────────

  it('9. GET /api/decisions → 200 with paginated items', async () => {
    await injectAuth({ method: 'POST', url: '/api/decisions', payload: { title: 'Dec 1' } });
    await injectAuth({ method: 'POST', url: '/api/decisions', payload: { title: 'Dec 2' } });

    const res = await injectAuth({ method: 'GET', url: '/api/decisions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.page).toBe(1);
  });

  it('10. GET /api/decisions?limit=200 → clamped to 100 max', async () => {
    const res = await injectAuth({ method: 'GET', url: '/api/decisions?limit=200' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(100);
  });

  // ── GET /api/decisions/:id ────────────────────────────────────────────────

  it('11. GET /api/decisions/:id (valid) → 200', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: { title: 'Fetch me' },
    });
    const { _id } = created.json();

    const res = await injectAuth({ method: 'GET', url: `/api/decisions/${_id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Fetch me');
  });

  it('12. GET /api/decisions/:id (invalid ObjectId) → 400', async () => {
    const res = await injectAuth({ method: 'GET', url: '/api/decisions/not-valid-id' });
    expect(res.statusCode).toBe(400);
  });

  it('13. GET /api/decisions/:id (not found) → 404', async () => {
    const res = await injectAuth({
      method: 'GET',
      url: '/api/decisions/507f1f77bcf86cd799439011',
    });
    expect(res.statusCode).toBe(404);
  });

  // ── PUT /api/decisions/:id ────────────────────────────────────────────────

  it('14. PUT /api/decisions/:id → 200', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: { title: 'Original' },
    });
    const { _id } = created.json();

    const res = await injectAuth({
      method: 'PUT',
      url: `/api/decisions/${_id}`,
      payload: { title: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Updated');
  });

  it('15. PUT /api/decisions/:id (making complete) → 200 with analysis', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: { title: 'Incomplete start' },
    });
    const { _id } = created.json();

    const res = await injectAuth({
      method: 'PUT',
      url: `/api/decisions/${_id}`,
      payload: {
        criteria: baseCriteria,
        options: baseOptions,
        scores: completeScores,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis).not.toBeNull();
    expect(body.analysis.engineVersion).toBe('1.0.0');
  });

  it('16. PUT /api/decisions/:id (making incomplete) → 200 with analysis null', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Complete start',
        criteria: baseCriteria,
        options: baseOptions,
        scores: completeScores,
      },
    });
    const { _id } = created.json();
    expect(created.json().analysis).not.toBeNull();

    // Clear scores to make it incomplete
    const res = await injectAuth({
      method: 'PUT',
      url: `/api/decisions/${_id}`,
      payload: { scores: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().analysis).toBeNull();
  });

  // ── DELETE /api/decisions/:id ─────────────────────────────────────────────

  it('17. DELETE /api/decisions/:id → 204', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: { title: 'Delete me' },
    });
    const { _id } = created.json();

    const res = await injectAuth({ method: 'DELETE', url: `/api/decisions/${_id}` });
    expect(res.statusCode).toBe(204);

    const check = await injectAuth({ method: 'GET', url: `/api/decisions/${_id}` });
    expect(check.statusCode).toBe(404);
  });

  it('18. DELETE /api/decisions/:id (not found) → 404', async () => {
    const res = await injectAuth({
      method: 'DELETE',
      url: '/api/decisions/507f1f77bcf86cd799439011',
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /api/decisions/:id/analyze ──────────────────────────────────────

  it('19. POST /api/decisions/:id/analyze (complete) → 200 with analysis', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Analyze me',
        criteria: baseCriteria,
        options: baseOptions,
        scores: completeScores,
      },
    });
    const { _id } = created.json();

    const res = await injectAuth({
      method: 'POST',
      url: `/api/decisions/${_id}/analyze`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis).not.toBeNull();
    expect(body.analysis.engineVersion).toBe('1.0.0');
    expect(body.analysis.winnerId).toBeDefined();
  });

  it('20. POST /api/decisions/:id/analyze (incomplete) → 422 with missingPairs', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Incomplete',
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-a': { cost: 80 } }, // missing perf and opt-b entirely
      },
    });
    const { _id } = created.json();

    const res = await injectAuth({
      method: 'POST',
      url: `/api/decisions/${_id}/analyze`,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.missingPairs).toBeDefined();
    expect(Array.isArray(body.missingPairs)).toBe(true);
    expect(body.missingPairs.length).toBeGreaterThan(0);
    // Should include the specific missing pair
    const hasMissing = body.missingPairs.some(
      (p: { optionId: string; criterionId: string }) =>
        (p.optionId === 'opt-a' && p.criterionId === 'perf') ||
        p.optionId === 'opt-b'
    );
    expect(hasMissing).toBe(true);
  });

  it('21. POST /api/decisions/:id/analyze (invalid id) → 400', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions/bad-id/analyze',
    });
    expect(res.statusCode).toBe(400);
  });

  it('22. POST /api/decisions/:id/analyze (not found) → 404', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions/507f1f77bcf86cd799439011/analyze',
    });
    expect(res.statusCode).toBe(404);
  });

  it('23. POST /api/decisions/:id/analyze twice → deterministic identical scores', async () => {
    const created = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Determinism test',
        criteria: baseCriteria,
        options: baseOptions,
        scores: completeScores,
      },
    });
    const { _id } = created.json();

    const res1 = await injectAuth({ method: 'POST', url: `/api/decisions/${_id}/analyze` });
    const res2 = await injectAuth({ method: 'POST', url: `/api/decisions/${_id}/analyze` });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const evals1 = res1.json().analysis.evaluations;
    const evals2 = res2.json().analysis.evaluations;

    expect(evals1.length).toBe(evals2.length);
    for (let i = 0; i < evals1.length; i++) {
      expect(evals1[i].weightedScore).toBe(evals2[i].weightedScore);
    }
  });

  it('24. Tied options → isTie:true in analysis', async () => {
    const res = await injectAuth({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        title: 'Tie scenario',
        criteria: baseCriteria,
        options: baseOptions,
        scores: tiedScores,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.analysis).not.toBeNull();
    expect(body.analysis.isTie).toBe(true);
  });
});
