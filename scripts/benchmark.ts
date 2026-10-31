/**
 * Decision OS - Performance and Scale Benchmark Suite
 * Reproducible baseline and post-optimization measurement script.
 */
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  evaluateDecision,
  normalizeWeights,
  runMonteCarloSimulation,
  calculateOptionScoreSensitivity,
  calculateMultiParameterCounterfactual,
  type EngineCriterion,
  type EngineOption,
} from '../packages/decision-engine/src/index.js';
import { buildApp } from '../apps/api/src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../apps/api/src/db/connection.js';
import { DecisionModel } from '../apps/api/src/models/decision.model.js';
import { UserModel } from '../apps/api/src/models/user.model.js';
import { AuditEventModel } from '../apps/api/src/models/audit.model.js';
import { auditService } from '../apps/api/src/services/audit.service.js';
import { analyticsRepository } from '../apps/api/src/repositories/analytics.repository.js';
import { collaborationService } from '../apps/api/src/services/collaboration.service.js';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_perf';

// Sample dataset: 5 criteria, 4 options
const sampleCriteria: EngineCriterion[] = [
  { id: 'crit-cost', name: 'Total Cost', weight: 30, isLocked: false },
  { id: 'crit-speed', name: 'Speed to Market', weight: 25, isLocked: false },
  { id: 'crit-quality', name: 'Code Quality', weight: 20, isLocked: true },
  { id: 'crit-risk', name: 'Technical Risk', weight: 15, isLocked: false },
  { id: 'crit-ux', name: 'User Experience', weight: 10, isLocked: false },
];

const sampleOptions: EngineOption[] = [
  {
    id: 'opt-cloud-native',
    name: 'Cloud Native Microservices',
    scores: { 'crit-cost': 60, 'crit-speed': 85, 'crit-quality': 90, 'crit-risk': 50, 'crit-ux': 95 },
  },
  {
    id: 'opt-monolith',
    name: 'Modular Monolith',
    scores: { 'crit-cost': 90, 'crit-speed': 90, 'crit-quality': 85, 'crit-risk': 80, 'crit-ux': 85 },
  },
  {
    id: 'opt-serverless',
    name: 'Full Serverless',
    scores: { 'crit-cost': 75, 'crit-speed': 70, 'crit-quality': 75, 'crit-risk': 65, 'crit-ux': 80 },
  },
  {
    id: 'opt-cots',
    name: 'COTS / SaaS Platform',
    scores: { 'crit-cost': 40, 'crit-speed': 95, 'crit-quality': 60, 'crit-risk': 85, 'crit-ux': 70 },
  },
];

function calculatePercentiles(latencies: number[]): { p50: number; p95: number; p99: number; min: number; max: number; avg: number } {
  latencies.sort((a, b) => a - b);
  const n = latencies.length;
  const p50 = latencies[Math.floor(n * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(n * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(n * 0.99)] ?? 0;
  const min = latencies[0] ?? 0;
  const max = latencies[n - 1] ?? 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / n;
  return {
    p50: Math.round(p50 * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    p99: Math.round(p99 * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    avg: Math.round(avg * 100) / 100,
  };
}

export async function runBenchmarks(): Promise<Record<string, unknown>> {
  console.log('=====================================================');
  console.log('DECISION OS PERFORMANCE & SCALE BENCHMARK SUITE');
  console.log(`Environment: Node ${process.version}, Platform: ${process.platform} (${process.arch})`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('=====================================================\n');

  const results: Record<string, unknown> = {};

  // -----------------------------------------------------------------
  // 1. CANONICAL MCDA ENGINE BENCHMARKS
  // -----------------------------------------------------------------
  console.log('--- 1. Authoritative MCDA Engine Profiling ---');

  // 1.1 Weight Normalization (Largest Remainder)
  const normIterations = 10000;
  const t0Norm = performance.now();
  for (let i = 0; i < normIterations; i++) {
    normalizeWeights(sampleCriteria, ['crit-quality']);
  }
  const normDurationMs = performance.now() - t0Norm;
  const normOpsPerSec = Math.round((normIterations / normDurationMs) * 1000);
  console.log(`1.1 Weight Normalization (10,000 runs): ${normDurationMs.toFixed(2)} ms (${normOpsPerSec} ops/sec)`);

  // 1.2 Full Evaluation (Validate, Normalize, Score, Ranks, Tipping Points)
  const evalIterations = 3000;
  const t0Eval = performance.now();
  for (let i = 0; i < evalIterations; i++) {
    evaluateDecision({
      criteria: sampleCriteria,
      options: sampleOptions,
      lockedIds: ['crit-quality'],
    });
  }
  const evalDurationMs = performance.now() - t0Eval;
  const evalOpsPerSec = Math.round((evalIterations / evalDurationMs) * 1000);
  console.log(`1.2 Full Authoritative Evaluation (3,000 runs): ${evalDurationMs.toFixed(2)} ms (${evalOpsPerSec} ops/sec)`);

  // 1.3 Monte Carlo Simulation (1,000 iterations per run)
  const mcRuns = 200;
  const baseNormalized = normalizeWeights(sampleCriteria, ['crit-quality']);
  const t0Mc1000 = performance.now();
  const memBeforeMc = process.memoryUsage().heapUsed;
  for (let i = 0; i < mcRuns; i++) {
    runMonteCarloSimulation(sampleOptions, sampleCriteria, baseNormalized, ['crit-quality'], {
      iterations: 1000,
      seed: 42 + i,
    });
  }
  const mc1000DurationMs = performance.now() - t0Mc1000;
  const memAfterMc = process.memoryUsage().heapUsed;
  const mc1000OpsPerSec = Math.round((mcRuns / mc1000DurationMs) * 1000);
  console.log(`1.3 Monte Carlo 1,000 iterations (200 simulations): ${mc1000DurationMs.toFixed(2)} ms (${mc1000OpsPerSec} runs/sec, ${(mc1000DurationMs / mcRuns).toFixed(2)} ms/run)`);

  // 1.4 Monte Carlo Simulation (5,000 iterations per run)
  const mcHeavyRuns = 50;
  const t0Mc5000 = performance.now();
  for (let i = 0; i < mcHeavyRuns; i++) {
    runMonteCarloSimulation(sampleOptions, sampleCriteria, baseNormalized, ['crit-quality'], {
      iterations: 5000,
      seed: 100 + i,
    });
  }
  const mc5000DurationMs = performance.now() - t0Mc5000;
  console.log(`1.4 Monte Carlo 5,000 iterations (50 simulations): ${mc5000DurationMs.toFixed(2)} ms (${(mc5000DurationMs / mcHeavyRuns).toFixed(2)} ms/run)`);

  // 1.5 Multi-parameter Counterfactual Weight Shifts
  const cfRuns = 500;
  const t0Cf = performance.now();
  for (let i = 0; i < cfRuns; i++) {
    calculateMultiParameterCounterfactual(sampleOptions[1], sampleOptions[0], sampleCriteria, baseNormalized);
  }
  const cfDurationMs = performance.now() - t0Cf;
  console.log(`1.5 Counterfactual Weight Shifts (500 runs): ${cfDurationMs.toFixed(2)} ms (${Math.round((cfRuns / cfDurationMs) * 1000)} ops/sec)\n`);

  results.engine = {
    weightNormalization: { iterations: normIterations, durationMs: normDurationMs, opsPerSec: normOpsPerSec },
    authoritativeEvaluation: { iterations: evalIterations, durationMs: evalDurationMs, opsPerSec: evalOpsPerSec },
    monteCarlo1000: { runs: mcRuns, durationMs: mc1000DurationMs, avgRunMs: mc1000DurationMs / mcRuns, runsPerSec: mc1000OpsPerSec },
    monteCarlo5000: { runs: mcHeavyRuns, durationMs: mc5000DurationMs, avgRunMs: mc5000DurationMs / mcHeavyRuns },
    counterfactualShifts: { runs: cfRuns, durationMs: cfDurationMs, opsPerSec: Math.round((cfRuns / cfDurationMs) * 1000) },
  };

  // -----------------------------------------------------------------
  // 2. DATABASE & MONGODB QUERY BENCHMARKS
  // -----------------------------------------------------------------
  console.log('--- 2. Database & MongoDB Query Profiling ---');
  await connectToDatabase(TEST_MONGODB_URI);

  // Setup seed user and decisions on a clean test db
  if (mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }

  const user = await UserModel.create({
    email: 'perf-benchmarker@example.com',
    name: 'Benchmark Admin',
    passwordHash: 'dummy_hash_for_benchmark_testing_purposes',
    role: 'admin',
  });

  const numDecisions = 50;
  const createdDecisionIds: string[] = [];

  for (let i = 0; i < numDecisions; i++) {
    const doc = await DecisionModel.create({
      title: `Benchmark Decision ${i + 1}`,
      description: `Evaluation scenario number ${i + 1}`,
      ownerId: user._id.toString(),
      criteria: sampleCriteria,
      options: sampleOptions,
      scoreMatrix: {
        'opt-monolith': { 'crit-cost': 90, 'crit-speed': 85, 'crit-quality': 80, 'crit-risk': 75, 'crit-ux': 70 },
        'opt-cloud-native': { 'crit-cost': 70, 'crit-speed': 90, 'crit-quality': 85, 'crit-risk': 80, 'crit-ux': 90 },
      },
      analysis: {
        winnerId: 'opt-monolith',
        decisionOutcome: 'decisive',
        pointLead: 5.2,
      },
      version: 1,
    });
    createdDecisionIds.push(doc._id.toString());
  }

  // 2.1 Single Decision Document Read Latency
  const readLatencies: number[] = [];
  const testId = createdDecisionIds[0];
  const readIterations = 300;
  for (let i = 0; i < readIterations; i++) {
    const t0 = performance.now();
    await DecisionModel.findById(testId).exec();
    readLatencies.push(performance.now() - t0);
  }
  const readStats = calculatePercentiles(readLatencies);
  console.log(`2.1 Decision Read (Mongoose doc, ${readIterations} queries): p50=${readStats.p50}ms, p95=${readStats.p95}ms, avg=${readStats.avg}ms`);

  // 2.2 Lean Decision Document Read Latency
  const leanLatencies: number[] = [];
  for (let i = 0; i < readIterations; i++) {
    const t0 = performance.now();
    await DecisionModel.findById(testId).lean().exec();
    leanLatencies.push(performance.now() - t0);
  }
  const leanStats = calculatePercentiles(leanLatencies);
  console.log(`2.2 Decision Read (Lean doc, ${readIterations} queries): p50=${leanStats.p50}ms, p95=${leanStats.p95}ms, avg=${leanStats.avg}ms`);

  // 2.3 Paginated List Query Latency
  const listLatencies: number[] = [];
  const listIterations = 150;
  for (let i = 0; i < listIterations; i++) {
    const t0 = performance.now();
    await DecisionModel.find({ ownerId: user._id.toString() }).sort({ createdAt: -1 }).skip(0).limit(20).exec();
    listLatencies.push(performance.now() - t0);
  }
  const listStats = calculatePercentiles(listLatencies);
  console.log(`2.3 Paginated List Query (${listIterations} queries): p50=${listStats.p50}ms, p95=${listStats.p95}ms, avg=${listStats.avg}ms`);

  // 2.4 Workspace Analytics Aggregation Pipeline
  const aggLatencies: number[] = [];
  const aggIterations = 100;
  for (let i = 0; i < aggIterations; i++) {
    const t0 = performance.now();
    await analyticsRepository.getWorkspaceDecisionsAggregation(createdDecisionIds);
    aggLatencies.push(performance.now() - t0);
  }
  const aggStats = calculatePercentiles(aggLatencies);
  console.log(`2.4 Workspace Analytics Aggregation (${aggIterations} pipelines across 50 decisions): p50=${aggStats.p50}ms, p95=${aggStats.p95}ms, avg=${aggStats.avg}ms`);

  // 2.5 Audit Chain 50 Events Cryptographic Verification
  for (let i = 0; i < 50; i++) {
    await auditService.recordEvent({
      decisionId: testId,
      actor: { id: user._id.toString(), email: user.email },
      action: 'decision.updated',
      entityType: 'decision',
      entityId: testId,
      summary: `Sequential Audit Record ${i + 1}`,
    });
  }
  const auditVerifyLatencies: number[] = [];
  const auditIterations = 50;
  for (let i = 0; i < auditIterations; i++) {
    const t0 = performance.now();
    await auditService.verifyChainIntegrity(testId, { id: user._id.toString(), email: user.email, role: 'admin' });
    auditVerifyLatencies.push(performance.now() - t0);
  }
  const auditStats = calculatePercentiles(auditVerifyLatencies);
  console.log(`2.5 Audit Chain Integrity Verification (50 events, ${auditIterations} checks): p50=${auditStats.p50}ms, p95=${auditStats.p95}ms, avg=${auditStats.avg}ms\n`);

  results.database = {
    documentRead: readStats,
    leanDocumentRead: leanStats,
    paginatedList: listStats,
    workspaceAggregation: aggStats,
    auditVerification: auditStats,
  };

  // -----------------------------------------------------------------
  // 3. FASTIFY API ENDPOINT BENCHMARKS
  // -----------------------------------------------------------------
  console.log('--- 3. Fastify API Response Latency Profiling ---');
  const app = await buildApp({ enableRateLimit: false });
  await app.ready();

  const userToken = app.jwt.sign({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: 'admin',
  });

  // 3.1 GET /health Liveness
  const healthLatencies: number[] = [];
  const apiIterations = 300;
  for (let i = 0; i < apiIterations; i++) {
    const t0 = performance.now();
    await app.inject({ method: 'GET', url: '/health' });
    healthLatencies.push(performance.now() - t0);
  }
  const healthStats = calculatePercentiles(healthLatencies);
  console.log(`3.1 GET /health (${apiIterations} requests): p50=${healthStats.p50}ms, p95=${healthStats.p95}ms, avg=${healthStats.avg}ms`);

  // 3.2 GET /health/ready Readiness (with DB ping)
  const readyLatencies: number[] = [];
  for (let i = 0; i < apiIterations; i++) {
    const t0 = performance.now();
    await app.inject({ method: 'GET', url: '/health/ready' });
    readyLatencies.push(performance.now() - t0);
  }
  const readyStats = calculatePercentiles(readyLatencies);
  console.log(`3.2 GET /health/ready (${apiIterations} requests with Mongo ping): p50=${readyStats.p50}ms, p95=${readyStats.p95}ms, avg=${readyStats.avg}ms`);

  // 3.3 GET /api/decisions (Paginated list over HTTP)
  const getListLatencies: number[] = [];
  for (let i = 0; i < 150; i++) {
    const t0 = performance.now();
    await app.inject({
      method: 'GET',
      url: '/api/decisions?page=1&limit=20',
      headers: { authorization: `Bearer ${userToken}` },
    });
    getListLatencies.push(performance.now() - t0);
  }
  const getListStats = calculatePercentiles(getListLatencies);
  console.log(`3.3 GET /api/decisions (150 requests): p50=${getListStats.p50}ms, p95=${getListStats.p95}ms, avg=${getListStats.avg}ms`);

  // 3.4 GET /api/decisions/:id
  const getDecisionLatencies: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    await app.inject({
      method: 'GET',
      url: `/api/decisions/${testId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    getDecisionLatencies.push(performance.now() - t0);
  }
  const getDecisionStats = calculatePercentiles(getDecisionLatencies);
  console.log(`3.4 GET /api/decisions/:id (200 requests): p50=${getDecisionStats.p50}ms, p95=${getDecisionStats.p95}ms, avg=${getDecisionStats.avg}ms`);

  // 3.5 GET /api/decisions/:id/analysis (on-demand canonical MCDA evaluation)
  const analysisLatencies: number[] = [];
  for (let i = 0; i < 150; i++) {
    const t0 = performance.now();
    await app.inject({
      method: 'GET',
      url: `/api/decisions/${testId}/analysis`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    analysisLatencies.push(performance.now() - t0);
  }
  const analysisStats = calculatePercentiles(analysisLatencies);
  console.log(`3.5 GET /api/decisions/:id/analysis (150 requests): p50=${analysisStats.p50}ms, p95=${analysisStats.p95}ms, avg=${analysisStats.avg}ms`);

  // 3.6 POST /api/decisions/:id/collaboration/presence (Heartbeat)
  const presenceLatencies: number[] = [];
  for (let i = 0; i < 150; i++) {
    const t0 = performance.now();
    await app.inject({
      method: 'POST',
      url: `/api/decisions/${testId}/collaboration/presence`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { status: 'active', currentView: 'matrix' },
    });
    presenceLatencies.push(performance.now() - t0);
  }
  const presenceStats = calculatePercentiles(presenceLatencies);
  console.log(`3.6 POST /presence heartbeat (150 requests): p50=${presenceStats.p50}ms, p95=${presenceStats.p95}ms, avg=${presenceStats.avg}ms\n`);

  results.api = {
    health: healthStats,
    healthReady: readyStats,
    listDecisions: getListStats,
    getDecision: getDecisionStats,
    getAnalysis: analysisStats,
    presenceHeartbeat: presenceStats,
  };

  // -----------------------------------------------------------------
  // 4. REAL-TIME COLLABORATION METRICS
  // -----------------------------------------------------------------
  console.log('--- 4. Real-Time Collaboration Metrics ---');
  const collabDecisionId = testId;
  const mockClients: any[] = [];
  const clientCount = 50;

  for (let i = 0; i < clientCount; i++) {
    const written: string[] = [];
    const mockRes = {
      writeHead: () => mockRes,
      write: (data: string) => written.push(data),
      end: () => {},
      on: () => mockRes,
    } as any;
    collaborationService.registerClient(
      collabDecisionId,
      { id: `user-sim-${i}`, email: `user${i}@example.com`, name: `User ${i}`, role: 'editor' },
      mockRes
    );
    mockClients.push(mockRes);
  }

  const broadcastT0 = performance.now();
  collaborationService.broadcastEvent(collabDecisionId, {
    type: 'decision.updated',
    decisionId: collabDecisionId,
    version: 2,
    actorId: user._id.toString(),
    actorName: user.name,
    payload: { title: 'Broadcasted Title Update' },
  });
  const broadcastLatencyMs = performance.now() - broadcastT0;
  console.log(`4.1 Broadcast to 50 active subscribers: ${broadcastLatencyMs.toFixed(3)} ms`);

  collaborationService.reset();
  console.log('4.2 Collaboration service subscribers reset cleanly.\n');

  results.realtime = {
    concurrentSubscribers: clientCount,
    broadcastLatencyMs: Math.round(broadcastLatencyMs * 1000) / 1000,
  };

  // Cleanup
  await app.close();
  await disconnectFromDatabase();

  console.log('=====================================================');
  console.log('BENCHMARK RUN COMPLETED SUCCESSFULLY');
  console.log('=====================================================');

  return results;
}

if (process.argv[1]?.endsWith('benchmark.ts') || process.argv[1]?.endsWith('benchmark.js')) {
  runBenchmarks()
    .then((r) => {
      console.log('\nJSON SUMMARY:');
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
