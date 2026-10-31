import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model';
import { ExpertPredictionModel } from '../src/models/prediction.model';
import { createDecision } from '../src/services/decision.service';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

describe('Expert Calibration API — /api/decisions/:id/predictions & /calibration', () => {
  let app: FastifyInstance;
  let userAToken: string;
  let userBToken: string;
  let userCToken: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();

    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await ExpertPredictionModel.deleteMany({});

    // User A (Owner)
    const userA = new UserModel({
      email: 'calib-owner-a@example.com',
      passwordHash: 'dummy_hash',
      name: 'Owner Alice',
      role: 'user',
    });
    await userA.save();
    userAId = userA._id.toString();
    userAToken = app.jwt.sign({ sub: userAId, id: userAId, email: userA.email, name: userA.name, role: userA.role });

    // User B (Collaborator / Expert)
    const userB = new UserModel({
      email: 'calib-expert-b@example.com',
      passwordHash: 'dummy_hash',
      name: 'Expert Bob',
      role: 'user',
    });
    await userB.save();
    userBId = userB._id.toString();
    userBToken = app.jwt.sign({ sub: userBId, id: userBId, email: userB.email, name: userB.name, role: userB.role });

    // User C (Unrelated User)
    const userC = new UserModel({
      email: 'calib-unrelated-c@example.com',
      passwordHash: 'dummy_hash',
      name: 'User Charlie',
      role: 'user',
    });
    await userC.save();
    userCId = userC._id.toString();
    userCToken = app.jwt.sign({ sub: userCId, id: userCId, email: userC.email, name: userC.name, role: userC.role });
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await ExpertPredictionModel.deleteMany({});
  });

  describe('POST /api/decisions/:id/predictions', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/decisions/507f1f77bcf86cd799439011/predictions',
        payload: {
          statement: 'Will scale to 100k RPS',
          probability: 0.8,
          targetDate: new Date(Date.now() + 86400000).toISOString(),
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for unrelated user (enumeration defense)', async () => {
      const doc = await createDecision(
        {
          title: 'Private Calibration Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions`,
        headers: { authorization: `Bearer ${userCToken}` },
        payload: {
          statement: 'Unauthorized prediction attempt',
          probability: 0.7,
          targetDate: new Date(Date.now() + 86400000).toISOString(),
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('creates a valid prospective prediction for authorized collaborator', async () => {
      const doc = await createDecision(
        {
          title: 'Prospective Forecast Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          statement: 'Option 1 will maintain p99 latency under 20ms during Black Friday.',
          probability: 0.85,
          domain: 'engineering',
          targetDate: futureDate,
          evidenceReferences: ['https://loadtest.internal/baseline'],
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.statement).toContain('p99 latency under 20ms');
      expect(data.probability).toBe(0.85);
      expect(data.domain).toBe('engineering');
      expect(data.status).toBe('awaiting_outcome');
      expect(data.predictionId).toMatch(/^pred_/);
      expect(data.submittedAt).toBeDefined();
    });

    it('rejects retrospective prediction with targetDate in the past with 400 Bad Request', async () => {
      const doc = await createDecision(
        {
          title: 'Retrospective Rejection Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      // Past target date
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          statement: 'Retrospective prediction cheat attempt',
          probability: 0.95,
          targetDate: pastDate,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Retrospective forecasts are strictly prohibited');
    });

    it('rejects probability outside [0, 1] with 400 Bad Request', async () => {
      const doc = await createDecision(
        {
          title: 'Probability Validation Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          statement: 'Invalid probability',
          probability: 1.5, // Invalid > 1
          targetDate: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/decisions/:id/predictions/:predictionId/outcome', () => {
    it('allows decision owner to record and verify an observed outcome', async () => {
      const doc = await createDecision(
        {
          title: 'Outcome Recording Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      // Create prediction submitted at T0
      const pred = await ExpertPredictionModel.create({
        decisionId: doc._id,
        contributorId: userBId,
        contributorName: 'Expert Bob',
        predictionId: 'pred_load_test',
        statement: 'Throughput will exceed 50k RPS',
        probability: 0.9,
        domain: 'engineering',
        targetDate: new Date(Date.now() + 86400000),
        status: 'awaiting_outcome',
        submittedAt: new Date(Date.now() - 3600000), // Submitted 1 hour ago
      });

      // Owner records verified outcome at T1 (now)
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions/${pred.predictionId}/outcome`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          observedOutcome: 1,
          outcomeDate: new Date().toISOString(),
          verificationSource: 'Datadog production dashboard load-run #412',
          verificationStatus: 'verified',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('verified');
      expect(data.outcome).toBeDefined();
      expect(data.outcome.observedOutcome).toBe(1);
      expect(data.outcome.verificationStatus).toBe('verified');
      expect(data.outcome.verifiedByName).toBe('Owner Alice');
    });

    it('blocks regular contributor from verifying outcomes with 403 Forbidden', async () => {
      const doc = await createDecision(
        {
          title: 'Permission Check Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      // Grant Bob contributor access
      await DecisionAccessGrantModel.create({
        decisionId: doc._id,
        userId: userBId,
        role: 'contributor',
        grantedBy: userAId,
      });

      const pred = await ExpertPredictionModel.create({
        decisionId: doc._id,
        contributorId: userBId,
        contributorName: 'Expert Bob',
        predictionId: 'pred_self_verify',
        statement: 'Self-verify attempt',
        probability: 0.9,
        domain: 'engineering',
        targetDate: new Date(Date.now() + 86400000),
        status: 'awaiting_outcome',
        submittedAt: new Date(Date.now() - 3600000),
      });

      // Bob attempts to unilaterally verify his own prediction
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions/${pred.predictionId}/outcome`,
        headers: { authorization: `Bearer ${userBToken}` },
        payload: {
          observedOutcome: 1,
          outcomeDate: new Date().toISOString(),
          verificationSource: 'Self-attestation',
          verificationStatus: 'verified',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects outcomeDate that precedes prediction submission with 400 Bad Request', async () => {
      const doc = await createDecision(
        {
          title: 'Anachronistic Outcome Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      const pred = await ExpertPredictionModel.create({
        decisionId: doc._id,
        contributorId: userAId,
        contributorName: 'Owner Alice',
        predictionId: 'pred_anachronism',
        statement: 'Submitted today',
        probability: 0.8,
        domain: 'general',
        targetDate: new Date(Date.now() + 86400000),
        status: 'awaiting_outcome',
        submittedAt: new Date(), // Today
      });

      // Attempt to record an outcome that happened yesterday
      const yesterday = new Date(Date.now() - 86400000).toISOString();

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${doc._id.toString()}/predictions/${pred.predictionId}/outcome`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          observedOutcome: 1,
          outcomeDate: yesterday,
          verificationSource: 'Yesterday news',
          verificationStatus: 'verified',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('cannot precede prediction submission date');
    });
  });

  describe('PATCH /api/decisions/:id/predictions/:predictionId/dispute', () => {
    it('allows collaborator to dispute an outcome, setting status to disputed', async () => {
      const doc = await createDecision(
        {
          title: 'Dispute Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      // Grant Bob contributor access
      await DecisionAccessGrantModel.create({
        decisionId: doc._id,
        userId: userBId,
        role: 'contributor',
        grantedBy: userAId,
      });

      const pred = await ExpertPredictionModel.create({
        decisionId: doc._id,
        contributorId: userBId,
        contributorName: 'Expert Bob',
        predictionId: 'pred_disputed_perf',
        statement: '99.9% uptime in region us-east-1',
        probability: 0.95,
        domain: 'operations',
        targetDate: new Date(Date.now() + 86400000),
        status: 'verified',
        submittedAt: new Date(Date.now() - 7200000),
        outcome: {
          outcomeId: 'outc_disputed',
          observedOutcome: 0,
          verificationStatus: 'verified',
          verificationSource: 'Downtime log',
          outcomeDate: new Date(Date.now() - 3600000),
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${doc._id.toString()}/predictions/${pred.predictionId}/dispute`,
        headers: { authorization: `Bearer ${userBToken}` },
        payload: {
          disputeReason: 'The measured downtime was caused by an upstream DNS outage outside AWS us-east-1.',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('disputed');
      expect(data.outcome.verificationStatus).toBe('disputed');
      expect(data.outcome.disputeReason).toContain('upstream DNS outage');
    });
  });

  describe('GET /api/decisions/:id/calibration', () => {
    it('returns insufficient sample size when verified predictions < 3', async () => {
      const doc = await createDecision(
        {
          title: 'Low Observation Calibration Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      // Only 1 verified prediction
      await ExpertPredictionModel.create({
        decisionId: doc._id,
        contributorId: userAId,
        contributorName: 'Owner Alice',
        predictionId: 'pred_single',
        statement: 'Single prediction',
        probability: 0.8,
        domain: 'engineering',
        targetDate: new Date(Date.now() + 86400000),
        status: 'verified',
        submittedAt: new Date(Date.now() - 7200000),
        outcome: {
          outcomeId: 'outc_single',
          observedOutcome: 1,
          verificationStatus: 'verified',
          verificationSource: 'Report #1',
          outcomeDate: new Date(Date.now() - 3600000),
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/calibration`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.hasSufficientSample).toBe(false);
      expect(data.verifiedCount).toBe(1);
      expect(data.minimumSampleThreshold).toBe(3);
      expect(data.summary).toContain('Preliminary sample size (N = 1 < 3)');
    });

    it('calculates deterministic Brier score and calibration bins when N >= 3', async () => {
      const doc = await createDecision(
        {
          title: 'Full Calibration Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      // Add 4 verified predictions (matching the known 4-item fixture BS = 0.125):
      // Item 1: p=0.9, o=1 -> 0.01
      // Item 2: p=0.7, o=1 -> 0.09
      // Item 3: p=0.2, o=0 -> 0.04
      // Item 4: p=0.4, o=1 -> 0.36
      // Sum = 0.50 -> BS = 0.125
      const dataset = [
        { id: 'pred_1', p: 0.9, o: 1, domain: 'engineering' },
        { id: 'pred_2', p: 0.7, o: 1, domain: 'engineering' },
        { id: 'pred_3', p: 0.2, o: 0, domain: 'finance' },
        { id: 'pred_4', p: 0.4, o: 1, domain: 'finance' },
      ];

      for (const it of dataset) {
        await ExpertPredictionModel.create({
          decisionId: doc._id,
          contributorId: userAId,
          contributorName: 'Owner Alice',
          predictionId: it.id,
          statement: `Statement for ${it.id}`,
          probability: it.p,
          domain: it.domain,
          targetDate: new Date(Date.now() + 86400000),
          status: 'verified',
          submittedAt: new Date(Date.now() - 7200000),
          outcome: {
            outcomeId: `outc_${it.id}`,
            observedOutcome: it.o,
            verificationStatus: 'verified',
            verificationSource: `Source for ${it.id}`,
            outcomeDate: new Date(Date.now() - 3600000),
          },
        });
      }

      // Add a 5th prediction that is DISPUTED (must be excluded from scoring!)
      await ExpertPredictionModel.create({
        decisionId: doc._id,
        contributorId: userAId,
        contributorName: 'Owner Alice',
        predictionId: 'pred_disputed',
        statement: 'Disputed prediction',
        probability: 0.99,
        domain: 'finance',
        targetDate: new Date(Date.now() + 86400000),
        status: 'disputed',
        submittedAt: new Date(Date.now() - 7200000),
        outcome: {
          outcomeId: 'outc_disp',
          observedOutcome: 0,
          verificationStatus: 'disputed',
          verificationSource: 'Disputed source',
          outcomeDate: new Date(Date.now() - 3600000),
          disputeReason: 'Invalid measurement',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/calibration`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.hasSufficientSample).toBe(true);
      expect(data.verifiedCount).toBe(4);
      expect(data.disputedCount).toBe(1);
      // Brier score matches exact theoretical value 0.125
      expect(data.brierScore).toBe(0.125);
      expect(data.methodologyVersion).toBe('1.0.0');

      // Domain segregation
      expect(data.domainBreakdown.length).toBe(2);
      const eng = data.domainBreakdown.find((d: any) => d.domain === 'engineering');
      const fin = data.domainBreakdown.find((d: any) => d.domain === 'finance');
      expect(eng).toBeDefined();
      expect(fin).toBeDefined();

      // Expert profile dimension segregation
      expect(data.expertProfiles.length).toBeGreaterThan(0);
      const profile = data.expertProfiles[0];
      expect(profile.experience).toBeDefined();
      expect(profile.evidenceQuality).toBeDefined();
      expect(profile.popularity).toBeDefined();
      expect(profile.popularity.label).toContain('Social consensus signal');
    });

    it('guarantees calibration operations do NOT alter authoritative decision inputs or results', async () => {
      const doc = await createDecision(
        {
          title: 'MCDA Immutability Decision',
          criteria: [{ id: 'c1', name: 'Perf', weight: 100 }],
          options: [{ id: 'o1', name: 'Opt 1' }],
          scores: { o1: { c1: 90 } },
        },
        { id: userAId, email: 'calib-owner-a@example.com', name: 'Owner Alice', role: 'user' }
      );

      const beforeDoc = await DecisionModel.findById(doc._id).lean();

      // Request calibration
      await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/calibration`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      const afterDoc = await DecisionModel.findById(doc._id).lean();
      expect(afterDoc?.calculationVersion).toBe(beforeDoc?.calculationVersion);
      expect(afterDoc?.scores).toEqual(beforeDoc?.scores);
      expect(afterDoc?.criteria).toEqual(beforeDoc?.criteria);
      expect(afterDoc?.updatedAt?.getTime()).toBe(beforeDoc?.updatedAt?.getTime());
    });
  });
});
