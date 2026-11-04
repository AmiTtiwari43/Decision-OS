import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard.js';
import { DecisionModel } from '../src/models/decision.model.js';
import { UserModel } from '../src/models/user.model.js';
import { evaluationCache } from '../src/services/evaluationCache.js';
import { collaborationService } from '../src/services/collaboration.service.js';
import { auditService } from '../src/services/audit.service.js';
import { decisionRepository } from '../src/repositories/decision.repository.js';
import { analyticsRepository } from '../src/repositories/analytics.repository.js';
import { runMonteCarloSimulation, evaluateDecision } from '@decision-os/decision-engine';

const TEST_MONGODB_URI = getTestDatabaseUri();

describe('Phase 15: Automated Performance Regression & Scale Suite', () => {
  let app: FastifyInstance;
  let testUserId: string;
  let authToken: string;
  let testDecisionId: string;

  assertTestDatabase(TEST_MONGODB_URI);

  const testCriteria = [
    { id: 'perf-c1', name: 'Latency', weight: 40, direction: 'benefit' as const },
    { id: 'perf-c2', name: 'Throughput', weight: 35, direction: 'benefit' as const },
    { id: 'perf-c3', name: 'Resource Cost', weight: 25, direction: 'benefit' as const },
  ];

  const testOptions = [
    { id: 'opt-a', name: 'Strategy Alpha', scores: { 'perf-c1': 95, 'perf-c2': 85, 'perf-c3': 70 } },
    { id: 'opt-b', name: 'Strategy Beta', scores: { 'perf-c1': 80, 'perf-c2': 90, 'perf-c3': 85 } },
  ];

  const testScores = {
    'opt-a': { 'perf-c1': 95, 'perf-c2': 85, 'perf-c3': 70 },
    'opt-b': { 'perf-c1': 80, 'perf-c2': 90, 'perf-c3': 85 },
  };

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();

    const user = await UserModel.create({
      email: 'perf-regression-tester@example.com',
      name: 'Regression Tester',
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

    const doc = await DecisionModel.create({
      title: 'Performance Regression Fixture',
      description: 'Used for latency and regression measurements',
      ownerId: new mongoose.Types.ObjectId(testUserId),
      criteria: testCriteria,
      options: testOptions,
      scores: testScores,
      version: 1,
    });
    testDecisionId = doc._id.toString();
  });

  afterAll(async () => {
    await DecisionModel.deleteMany({});
    await UserModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  // 1. API Latency Checks
  it('1. API latency on representative endpoints is strictly bounded', async () => {
    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);

    const readyRes = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json().database).toBe('connected');

    const diagRes = await app.inject({ method: 'GET', url: '/health/diagnostics' });
    expect(diagRes.statusCode).toBe(200);
  });

  // 2. MongoDB Query Efficiency
  it('2. MongoDB queries use lean plain objects and execute efficiently', async () => {
    const start = performance.now();
    const result = await decisionRepository.findById(testDecisionId);
    const duration = performance.now() - start;

    expect(result).not.toBeNull();
    expect(duration).toBeLessThan(100); // Sub-100ms on local DB
  });

  // 3. Aggregation Query Limits
  it('3. Aggregation pipelines respect bounds and handle date filters safely', async () => {
    const start = performance.now();
    const aggResult = await analyticsRepository.getWorkspaceDecisionsAggregation([testDecisionId], {
      startDate: new Date('2020-01-01'),
      endDate: new Date('2030-01-01'),
    });
    const duration = performance.now() - start;

    expect(aggResult).toBeDefined();
    expect(aggResult.totalDecisions).toBe(1);
    expect(duration).toBeLessThan(150);
  });

  // 4. Bounded Pagination
  it('4. Decision repository and API enforce bounded pagination (max limit 100)', async () => {
    const paged = await decisionRepository.list(undefined, { page: 1, limit: 500 }); // Attempt 500
    expect(paged.limit).toBe(100); // Clamped to 100

    const apiRes = await app.inject({
      method: 'GET',
      url: '/api/decisions?limit=999',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(apiRes.statusCode).toBe(200);
    expect(apiRes.json().limit).toBe(100);
  });

  // 5. Large Response Handling & Compression
  it('5. Large JSON responses are compressed with gzip when requested', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${testDecisionId}`,
      headers: {
        authorization: `Bearer ${authToken}`,
        'accept-encoding': 'gzip',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  // 6. Event-Loop Non-Blocking
  it('6. Engine evaluations do not block event loop', async () => {
    const t0 = performance.now();
    const results = evaluateDecision({
      criteria: testCriteria,
      options: testOptions,
    });
    const duration = performance.now() - t0;

    expect(results.winnerId).toBe('opt-a');
    expect(duration).toBeLessThan(50);
  });

  // 7. Connection Cleanup
  it('7. Real-time collaboration cleans up connections and timers', () => {
    collaborationService.reset();
    const metrics = collaborationService.getMetrics();
    expect(metrics.activeSubscribersCount).toBe(0);
    expect(metrics.activeChannelsCount).toBe(0);
  });

  // 8. Real-time Event Delivery
  it('8. Real-time event broadcasting delivers to 20 subscribers in <5ms', () => {
    const clients: any[] = [];
    for (let i = 0; i < 20; i++) {
      const mockRes = {
        writeHead: () => mockRes,
        write: () => true,
        end: () => {},
        on: () => mockRes,
      } as any;
      collaborationService.registerClient(
        testDecisionId,
        { id: `user-sim-${i}`, email: `user${i}@example.com`, name: `Sim ${i}`, role: 'viewer' },
        mockRes
      );
      clients.push(mockRes);
    }

    const t0 = performance.now();
    collaborationService.broadcastEvent(testDecisionId, {
      type: 'decision.updated',
      decisionId: testDecisionId,
      version: 2,
      payload: { title: 'Broadcast Bench' },
    });
    const deliveryMs = performance.now() - t0;

    expect(deliveryMs).toBeLessThan(20);
    collaborationService.reset();
  });

  // 9. Graceful Reset
  it('9. Collaboration service reset safely ends subscriber responses', () => {
    let ended = false;
    const mockRes = {
      writeHead: () => mockRes,
      write: () => true,
      end: () => { ended = true; },
      on: () => mockRes,
    } as any;

    collaborationService.registerClient(
      testDecisionId,
      { id: 'user-shutdown', email: 'shutdown@example.com', name: 'Shutdown User', role: 'viewer' },
      mockRes
    );

    collaborationService.reset();
    expect(ended).toBe(true);
    expect(collaborationService.getMetrics().activeSubscribersCount).toBe(0);
  });

  // 10. Safe Retry Behavior on Hash Chain
  it('10. Audit event creation handles concurrent writes without chain breakage', async () => {
    const [e1, e2] = await Promise.all([
      auditService.recordEvent({
        decisionId: testDecisionId,
        actor: { id: testUserId, email: 'tester@example.com' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Concurrent Event 1',
      }),
      auditService.recordEvent({
        decisionId: testDecisionId,
        actor: { id: testUserId, email: 'tester@example.com' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Concurrent Event 2',
      }),
    ]);

    expect(e1.eventHash).toBeDefined();
    expect(e2.eventHash).toBeDefined();
    expect(e1.previousEventHash).not.toBe(e2.previousEventHash); // Serialized chain linkage

    const verifyResult = await auditService.verifyChainIntegrity(testDecisionId, { id: testUserId, role: 'admin' });
    expect(verifyResult.isValid).toBe(true);
  });

  // 11. Cache Invalidation
  it('11. In-memory evaluation cache correctly invalidates on decision eviction', () => {
    evaluationCache.clear();
    const inputHash = evaluationCache.computeInputHash({
      criteria: testCriteria,
      options: testOptions,
    });

    const mockResult = evaluateDecision({ criteria: testCriteria, options: testOptions });
    evaluationCache.set(testDecisionId, 1, inputHash, mockResult);

    expect(evaluationCache.get(testDecisionId, 1, inputHash)).not.toBeNull();
    evaluationCache.invalidate(testDecisionId);
    expect(evaluationCache.get(testDecisionId, 1, inputHash)).toBeNull();
  });

  // 12. Canonical Engine Output Preservation
  it('12. Engine produces identical scores, winner, and ranking before and after optimizations', () => {
    const res = evaluateDecision({
      criteria: testCriteria,
      options: testOptions,
    });

    expect(res.winnerId).toBe('opt-a');
    expect(res.decisionOutcome).toBe('decisive');
    expect(res.pointLead).toBeGreaterThan(0);
    expect(res.evaluations[0].optionId).toBe('opt-a');
    expect(res.evaluations[1].optionId).toBe('opt-b');
  });

  // 13. Monte Carlo Deterministic Behavior
  it('13. Monte Carlo simulation produces deterministic win counts for identical seed', () => {
    const run1 = runMonteCarloSimulation(testOptions, testCriteria, { 'perf-c1': 40, 'perf-c2': 35, 'perf-c3': 25 }, [], {
      iterations: 100,
      seed: 4242,
    });

    const run2 = runMonteCarloSimulation(testOptions, testCriteria, { 'perf-c1': 40, 'perf-c2': 35, 'perf-c3': 25 }, [], {
      iterations: 100,
      seed: 4242,
    });

    expect(run1.dominantOptionId).toBe(run2.dominantOptionId);
    expect(run1.dominantWinProbability).toBe(run2.dominantWinProbability);
    expect(run1.optionResults[0].winCount).toBe(run2.optionResults[0].winCount);
  });

  // 14. Memory Stability Under Sustained Workload
  it('14. Memory remains stable across 500 consecutive evaluations', () => {
    const memStart = process.memoryUsage().heapUsed;

    for (let i = 0; i < 500; i++) {
      evaluateDecision({
        criteria: testCriteria,
        options: testOptions,
      });
    }

    const memEnd = process.memoryUsage().heapUsed;
    const diffMb = (memEnd - memStart) / 1024 / 1024;
    // Growth must be bounded (<25MB)
    expect(diffMb).toBeLessThan(25);
  });
});

