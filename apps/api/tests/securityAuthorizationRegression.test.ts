import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model';
import { ExpertPredictionModel } from '../src/models/prediction.model';
import { createDecision } from '../src/services/decision.service';

const TEST_MONGODB_URI = getTestDatabaseUri(undefined, { runId: 'security_authz' });
assertTestDatabase(TEST_MONGODB_URI);

/**
 * Regression tests for authorization gaps found in the unified-spec audit:
 * - POST /decisions/:id/reconcile-audit ran without any authorization and could
 *   quarantine any decision on behalf of any authenticated user.
 * - GET /users/:userId/calibration aggregated an expert's forecasts across all
 *   decisions, including decisions the requester cannot read (IDOR).
 */
describe('Security authorization regressions', () => {
  let app: FastifyInstance;
  const users: Record<string, { id: string; token: string }> = {};

  async function makeUser(key: string) {
    const u = await UserModel.create({ email: `${key}@example.com`, passwordHash: 'x', name: key, role: 'user' });
    const id = u._id.toString();
    users[key] = { id, token: app.jwt.sign({ sub: id, id, email: u.email, name: u.name, role: 'user' }) };
  }

  async function makeDecision(ownerKey: string, title: string) {
    return createDecision(
      {
        title,
        criteria: [{ id: 'c1', name: 'Speed', weight: 100, direction: 'benefit', isLocked: false }],
        options: [
          { id: 'o1', name: 'A' },
          { id: 'o2', name: 'B' },
        ],
        scores: { o1: { c1: 70 }, o2: { c1: 40 } },
      },
      { id: users[ownerKey].id, email: `${ownerKey}@example.com`, name: ownerKey, role: 'user' }
    );
  }

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await Promise.all([
      UserModel.deleteMany({}),
      DecisionModel.deleteMany({}),
      DecisionAccessGrantModel.deleteMany({}),
      ExpertPredictionModel.deleteMany({}),
    ]);
    for (const key of ['owner', 'editor', 'outsider', 'expert']) await makeUser(key);
  });

  describe('POST /api/decisions/:id/reconcile-audit', () => {
    it('returns 404 to a user with no access and leaves the decision unquarantined', async () => {
      const doc = await makeDecision('owner', 'Private decision');
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id}/reconcile-audit`,
        headers: { authorization: `Bearer ${users.outsider.token}` },
        payload: { operationId: 'forged-operation-id' },
      });

      expect(res.statusCode).toBe(404);
      const after = await DecisionModel.findById(doc._id).lean();
      expect(after?.auditIntegrityStatus).not.toBe('quarantined');
    });

    it('forbids a non-owner collaborator from triggering reconciliation', async () => {
      const doc = await makeDecision('owner', 'Shared decision');
      await DecisionAccessGrantModel.create({
        decisionId: doc._id,
        userId: users.editor.id,
        role: 'editor',
        grantedBy: users.owner.id,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id}/reconcile-audit`,
        headers: { authorization: `Bearer ${users.editor.token}` },
        payload: { operationId: 'forged-operation-id' },
      });

      expect(res.statusCode).toBe(403);
      const after = await DecisionModel.findById(doc._id).lean();
      expect(after?.auditIntegrityStatus).not.toBe('quarantined');
    });

    it('still allows the owner to run reconciliation on a healthy decision', async () => {
      const doc = await makeDecision('owner', 'Owner decision');
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id}/reconcile-audit`,
        headers: { authorization: `Bearer ${users.owner.token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects unauthenticated requests', async () => {
      const doc = await makeDecision('owner', 'Owner decision');
      const res = await app.inject({ method: 'POST', url: `/api/decisions/${doc._id}/reconcile-audit`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/users/:userId/calibration', () => {
    async function addPrediction(decisionId: unknown, predictionId: string) {
      await ExpertPredictionModel.create({
        decisionId,
        contributorId: users.expert.id,
        contributorName: 'expert',
        predictionId,
        statement: `Forecast ${predictionId}`,
        probability: 0.7,
        domain: 'engineering',
        targetDate: new Date(Date.now() + 86400000),
        status: 'awaiting_outcome',
        submittedAt: new Date(),
      });
    }

    it('hides forecasts made on decisions the requester cannot read', async () => {
      const privateDoc = await makeDecision('owner', 'Private to owner');
      const outsiderDoc = await makeDecision('outsider', 'Outsider decision');
      await addPrediction(privateDoc._id, 'pred_private');
      await addPrediction(outsiderDoc._id, 'pred_shared');

      const res = await app.inject({
        method: 'GET',
        url: `/api/users/${users.expert.id}/calibration`,
        headers: { authorization: `Bearer ${users.outsider.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().experience.totalPredictions).toBe(1);
    });

    it('returns 404 when the requester shares no readable decision with the expert', async () => {
      const privateDoc = await makeDecision('owner', 'Private to owner');
      await addPrediction(privateDoc._id, 'pred_private');

      const res = await app.inject({
        method: 'GET',
        url: `/api/users/${users.expert.id}/calibration`,
        headers: { authorization: `Bearer ${users.outsider.token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('lets experts see their own full profile', async () => {
      const privateDoc = await makeDecision('owner', 'Private to owner');
      await addPrediction(privateDoc._id, 'pred_private');

      const res = await app.inject({
        method: 'GET',
        url: `/api/users/${users.expert.id}/calibration`,
        headers: { authorization: `Bearer ${users.expert.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().experience.totalPredictions).toBe(1);
    });
  });
});
