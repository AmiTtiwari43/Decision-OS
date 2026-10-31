import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import { DecisionModel } from '../src/models/decision.model.js';
import { UserModel } from '../src/models/user.model.js';
import { evaluationCache } from '../src/services/evaluationCache.js';
import { collaborationService } from '../src/services/collaboration.service.js';
import { runAnalysis, analyzeDecision, updateDecision, deleteDecision } from '../src/services/decision.service.js';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

describe('Phase 15: Observability, Diagnostics, Caching & Performance Controls', () => {
  let app: FastifyInstance;
  let testUserId: string;
  let authToken: string;

  assertTestDatabase(TEST_MONGODB_URI);

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();

    const user = await UserModel.create({
      email: 'diagnostics-test@example.com',
      name: 'Diagnostics Tester',
      passwordHash: 'dummy_hash_for_testing',
      role: 'admin',
    });
    testUserId = user._id.toString();

    authToken = app.jwt.sign({
      id: testUserId,
      email: user.email,
      name: user.name,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await DecisionModel.deleteMany({});
    await UserModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    evaluationCache.clear();
    collaborationService.reset();
  });

  it('GET /health/diagnostics returns operational metrics without sensitive data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/diagnostics',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe('decision-os-api');
    expect(body.version).toBe('1.0.0');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.database.status).toBe('connected');
    expect(typeof body.database.latencyMs).toBe('number');
    expect(body.memory.heapUsedMb).toBeGreaterThan(0);
    expect(body.engineCache).toBeDefined();
    expect(typeof body.engineCache.size).toBe('number');
    expect(typeof body.engineCache.hits).toBe('number');
    expect(body.realtimeCollaboration).toBeDefined();
    expect(typeof body.realtimeCollaboration.activeSubscribersCount).toBe('number');
  });

  it('evaluationCache caches authoritative MCDA evaluations and invalidates on update/delete', async () => {
    const decision = await DecisionModel.create({
      title: 'Cache Benchmark Scenario',
      ownerId: new mongoose.Types.ObjectId(testUserId),
      criteria: [
        { id: 'c1', name: 'Crit 1', weight: 60, direction: 'benefit' },
        { id: 'c2', name: 'Crit 2', weight: 40, direction: 'benefit' },
      ],
      options: [
        { id: 'o1', name: 'Option A' },
        { id: 'o2', name: 'Option B' },
      ],
      scores: {
        o1: { c1: 90, c2: 80 },
        o2: { c1: 70, c2: 85 },
      },
      version: 1,
    });
    const decisionId = decision._id.toString();

    const criteria = [
      { id: 'c1', name: 'Crit 1', weight: 60, direction: 'benefit' as const },
      { id: 'c2', name: 'Crit 2', weight: 40, direction: 'benefit' as const },
    ];
    const options = [
      { id: 'o1', name: 'Option A' },
      { id: 'o2', name: 'Option B' },
    ];
    const scores = {
      o1: { c1: 90, c2: 80 },
      o2: { c1: 70, c2: 85 },
    };

    // First call computes and caches result
    const firstResult = runAnalysis(criteria, options, scores, undefined, { decisionId, version: 1 });
    expect(firstResult.winnerId).toBe('o1');
    expect(evaluationCache.getMetrics().size).toBe(1);
    expect(evaluationCache.getMetrics().misses).toBe(1);

    // Repeated call with same version and inputs hits cache directly
    const secondResult = runAnalysis(criteria, options, scores, undefined, { decisionId, version: 1 });
    expect(secondResult.winnerId).toBe('o1');
    expect(evaluationCache.getMetrics().hits).toBe(1);

    // Explicit invalidation clears cache for this decision
    evaluationCache.invalidate(decisionId);
    expect(evaluationCache.getMetrics().size).toBe(0);

    // Re-cache for version 1
    runAnalysis(criteria, options, scores, undefined, { decisionId, version: 1 });
    expect(evaluationCache.getMetrics().size).toBe(1);

    // Updating decision invalidates the previous cache version and re-evaluates under nextVersion
    await updateDecision(decisionId, { title: 'Updated Title' }, { id: testUserId, role: 'admin' });
    expect(evaluationCache.get(decisionId, 1, 'dummy_hash')).toBeNull();

    // Deleting decision completely evicts from cache
    await deleteDecision(decisionId, { id: testUserId, role: 'admin' });
    expect(evaluationCache.getMetrics().size).toBe(0);
  });

  it('compresses JSON response payloads with gzip when client requests it', async () => {
    // Generate a decision with large metadata to cross compression threshold (>1KB)
    const largeDecision = await DecisionModel.create({
      title: 'Large Payload Scenario for Compression Verification',
      description: 'x'.repeat(2000), // 2KB description
      ownerId: new mongoose.Types.ObjectId(testUserId),
      criteria: [
        { id: 'c1', name: 'Crit 1', weight: 50 },
        { id: 'c2', name: 'Crit 2', weight: 50 },
      ],
      options: [
        { id: 'o1', name: 'Option 1' },
      ],
      scores: {
        o1: { c1: 80, c2: 90 },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${largeDecision._id}`,
      headers: {
        authorization: `Bearer ${authToken}`,
        'accept-encoding': 'gzip',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('realtimeCollaboration metrics accurately track active subscribers and channels', () => {
    const dummyDecisionId = '66f1a2b3c4d5e6f7a8b9c0d1';
    const mockRes = {
      writeHead: () => mockRes,
      write: () => true,
      end: () => {},
      on: () => mockRes,
    } as any;

    collaborationService.registerClient(
      dummyDecisionId,
      { id: 'test-user-1', email: 'test1@example.com', name: 'User 1', role: 'editor' },
      mockRes
    );

    const metrics = collaborationService.getMetrics();
    expect(metrics.activeSubscribersCount).toBe(1);
    expect(metrics.activeChannelsCount).toBe(1);
    expect(metrics.activePresenceCount).toBe(1);

    collaborationService.reset();
    const resetMetrics = collaborationService.getMetrics();
    expect(resetMetrics.activeSubscribersCount).toBe(0);
    expect(resetMetrics.activeChannelsCount).toBe(0);
  });
});

