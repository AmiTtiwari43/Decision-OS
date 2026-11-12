import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  connectToDatabase,
  disconnectFromDatabase,
  isReplicaSetSupported,
  assertReplicaSetSupported,
} from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import {
  DecisionModel,
  AuditEventModel,
  OperationJournalModel,
} from '../src/models/index.js';
import {
  populateSyntheticDemo,
  replaceSyntheticScore,
} from '../src/services/decision.service.js';
import { auditService } from '../src/services/audit.service.js';
import {
  DecisionConflictError,
} from '../src/errors/domain.errors.js';

// The replica set URI on port 27018
const REPLICA_SET_URI =
  process.env.TEST_REPLICA_SET_URI ||
  (process.env.TEST_MONGODB_URI?.includes('replicaSet')
    ? process.env.TEST_MONGODB_URI
    : 'mongodb://127.0.0.1:27018/decision_os_rs_atomicity_test?replicaSet=rs0&directConnection=true');

assertTestDatabase(REPLICA_SET_URI);

describe('Batch 02-R5: Real Replica Set Transaction Atomicity & Rollback Verification', () => {
  const baseCriteria = [
    { id: 'crit-cost', name: 'Cost', weight: 40, direction: 'cost' as const },
    { id: 'crit-perf', name: 'Performance', weight: 60, direction: 'benefit' as const },
  ];

  const baseOptions = [
    { id: 'opt-a', name: 'Option A' },
    { id: 'opt-b', name: 'Option B' },
  ];

  const testActor = {
    id: new mongoose.Types.ObjectId().toString(),
    role: 'admin',
    email: 'rs-auditor@decision-os.org',
    name: 'RS Auditor',
  };

  beforeAll(async () => {
    await disconnectFromDatabase();
    await connectToDatabase(REPLICA_SET_URI);
    assertReplicaSetSupported();
    expect(isReplicaSetSupported()).toBe(true);

    // Sync indexes
    await DecisionModel.syncIndexes();
    await AuditEventModel.syncIndexes();
    await OperationJournalModel.syncIndexes();
  });

  afterAll(async () => {
    try {
      if (mongoose.connection.readyState === 1) {
        await DecisionModel.collection.deleteMany({});
        await AuditEventModel.collection.deleteMany({});
        await OperationJournalModel.collection.deleteMany({});
        await mongoose.connection.db!.dropDatabase();
      }
    } finally {
      await disconnectFromDatabase();
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    if (mongoose.connection.readyState === 1) {
      await DecisionModel.collection.deleteMany({});
      await AuditEventModel.collection.deleteMany({});
      await OperationJournalModel.collection.deleteMany({});
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Objective 2.1: Audit append failure rolls back the decision update
  // ──────────────────────────────────────────────────────────────────────────
  it('1. Audit append failure aborts transaction and rolls back decision update directly in MongoDB', async () => {
    // 1. Create a real decision in MongoDB with 1 score present (3 missing)
    const initialScores = { 'opt-a': { 'crit-cost': 80 } };
    const decisionDoc = await DecisionModel.create({
      title: 'RS Atomicity Test Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: initialScores,
      scoreProvenance: {},
      ownerId: new mongoose.Types.ObjectId(testActor.id),
      version: 1,
      auditIntegrityStatus: 'healthy',
      isAudited: true,
    });

    const decisionId = decisionDoc._id.toString();

    // 2. Inject an audit append failure into auditService.recordEvent
    const auditFailureError = new Error('Injected disk I/O failure during audit append');
    vi.spyOn(auditService, 'recordEvent').mockRejectedValueOnce(auditFailureError);

    // 3. Execute synthetic demo-fill -> must throw the injected error
    await expect(
      populateSyntheticDemo(decisionId, 75, 1, testActor)
    ).rejects.toThrow('Injected disk I/O failure during audit append');

    // 4. Read the decision DIRECTLY from MongoDB (outside any session)
    const freshDecision = await DecisionModel.findById(decisionId).lean().exec();

    // 5. Confirms the original version, scores, and provenance remain unchanged
    expect(freshDecision).not.toBeNull();
    expect(freshDecision!.version).toBe(1);
    expect(freshDecision!.scores).toEqual(initialScores);
    expect(freshDecision!.scoreProvenance ?? {}).toEqual({});
    expect(freshDecision!.auditIntegrityStatus).toBe('healthy');
    expect(freshDecision!.pendingOperationId).toBeFalsy();

    // 6. Confirms NO audit event was committed to MongoDB
    const auditEvents = await AuditEventModel.find({ decisionId }).exec();
    expect(auditEvents.length).toBe(0);

    // 7. Confirms no operation journal was created (replica-set mode uses native transactions)
    const journalEntries = await OperationJournalModel.find({ decisionId }).exec();
    expect(journalEntries.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Objective 2.2: Decision update failure produces no audit event
  // ──────────────────────────────────────────────────────────────────────────
  it('2. Decision update failure produces NO audit event', async () => {
    // Create decision at version 1
    const decisionDoc = await DecisionModel.create({
      title: 'Update Failure Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: { 'opt-a': { 'crit-cost': 80 } },
      version: 1,
      ownerId: new mongoose.Types.ObjectId(testActor.id),
    });

    const decisionId = decisionDoc._id.toString();
    const auditSpy = vi.spyOn(auditService, 'recordEvent');

    // Expected version 99 causes optimistic concurrency check failure
    await expect(
      populateSyntheticDemo(decisionId, 75, 99, testActor)
    ).rejects.toThrow(DecisionConflictError);

    // Verify auditService was NEVER invoked
    expect(auditSpy).not.toHaveBeenCalled();

    // Directly verify MongoDB has zero audit events
    const auditCount = await AuditEventModel.countDocuments({ decisionId });
    expect(auditCount).toBe(0);

    // Decision version remains 1
    const fresh = await DecisionModel.findById(decisionId);
    expect(fresh!.version).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Objective 2.3: Duplicate retries do not increment versions or create duplicate events
  // ──────────────────────────────────────────────────────────────────────────
  it('3. Duplicate retries do not increment versions or create duplicate events', async () => {
    // 1. Create decision with missing scores
    const decisionDoc = await DecisionModel.create({
      title: 'Duplicate Retry Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: {},
      version: 1,
      ownerId: new mongoose.Types.ObjectId(testActor.id),
    });

    const decisionId = decisionDoc._id.toString();

    // 2. First populate: fills all 4 cells with demo 75 -> advances version to 2
    const firstPopulate = await populateSyntheticDemo(decisionId, 75, 1, testActor);
    expect(firstPopulate.version).toBe(2);

    // Verify 1 audit event committed in MongoDB
    const auditCountAfterFirst = await AuditEventModel.countDocuments({ decisionId });
    expect(auditCountAfterFirst).toBe(1);

    // 3. Second populate (duplicate retry): all cells already filled -> NO-OP
    const secondPopulate = await populateSyntheticDemo(decisionId, 75, 2, testActor);

    // Version remains 2
    expect(secondPopulate.version).toBe(2);

    // Verify MongoDB directly: version is still 2
    const freshDecision = await DecisionModel.findById(decisionId);
    expect(freshDecision!.version).toBe(2);

    // Audit event count in MongoDB is STILL EXACTLY 1 (no duplicate audit events)
    const auditCountAfterSecond = await AuditEventModel.countDocuments({ decisionId });
    expect(auditCountAfterSecond).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Objective 2.4: replaceSyntheticScore transaction atomicity
  // ──────────────────────────────────────────────────────────────────────────
  it('4. Audit append failure during replaceSyntheticScore rolls back score replacement in MongoDB', async () => {
    // 1. Create decision with synthetic scores
    const decisionDoc = await DecisionModel.create({
      title: 'Replace Synthetic Score Atomicity Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: {
        'opt-a': { 'crit-cost': 75, 'crit-perf': 75 },
        'opt-b': { 'crit-cost': 75, 'crit-perf': 75 },
      },
      scoreProvenance: {
        'opt-a': {
          'crit-cost': { isSynthetic: true, source: 'demo' },
          'crit-perf': { isSynthetic: true, source: 'demo' },
        },
        'opt-b': {
          'crit-cost': { isSynthetic: true, source: 'demo' },
          'crit-perf': { isSynthetic: true, source: 'demo' },
        },
      },
      version: 2,
      ownerId: new mongoose.Types.ObjectId(testActor.id),
    });

    const decisionId = decisionDoc._id.toString();

    // Inject failure on audit append
    vi.spyOn(auditService, 'recordEvent').mockRejectedValueOnce(
      new Error('Injected audit failure during replacement')
    );

    // 2. Attempt to replace (opt-a, crit-cost) with 92
    await expect(
      replaceSyntheticScore(
        decisionId,
        {
          optionId: 'opt-a',
          criterionId: 'crit-cost',
          score: 92,
          expectedVersion: 2,
        },
        testActor
      )
    ).rejects.toThrow('Injected audit failure during replacement');

    // 3. Verify in MongoDB: score is still 75, provenance still synthetic, version is still 2
    const freshDecision = await DecisionModel.findById(decisionId);
    expect(freshDecision!.version).toBe(2);
    expect(freshDecision!.scores['opt-a']['crit-cost']).toBe(75);
    expect(freshDecision!.scoreProvenance?.['opt-a']?.['crit-cost']?.isSynthetic).toBe(true);

    // Verify zero audit events committed
    const auditCount = await AuditEventModel.countDocuments({ decisionId });
    expect(auditCount).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Objective 2.5: Successful populateSyntheticDemo commits both writes atomically
  // ──────────────────────────────────────────────────────────────────────────
  it('5. Successful populateSyntheticDemo commits decision mutation and audit event atomically', async () => {
    const decisionDoc = await DecisionModel.create({
      title: 'Successful RS Demo Fill Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: { 'opt-a': { 'crit-cost': 50 } },
      scoreProvenance: {},
      version: 1,
      ownerId: new mongoose.Types.ObjectId(testActor.id),
    });

    const decisionId = decisionDoc._id.toString();

    const result = await populateSyntheticDemo(decisionId, 75, 1, testActor);
    expect(result.version).toBe(2);

    // Direct MongoDB verification: decision state committed
    const freshDecision = await DecisionModel.findById(decisionId);
    expect(freshDecision!.version).toBe(2);
    expect(freshDecision!.scores['opt-a']['crit-cost']).toBe(50); // Real preserved
    expect(freshDecision!.scores['opt-a']['crit-perf']).toBe(75); // Synthetic filled
    expect(freshDecision!.scoreProvenance?.['opt-a']?.['crit-perf']?.isSynthetic).toBe(true);

    // Direct MongoDB verification: audit event committed with sequenceNumber 1
    const auditEvents = await AuditEventModel.find({ decisionId });
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toBe('decision.synthetic_demo_populated');
    expect(auditEvents[0].sequenceNumber).toBe(1);
    expect(auditEvents[0].diff?.populatedCount).toBe(3);

    // Authoritative audit head on DecisionModel is updated
    expect(freshDecision!.auditHead?.sequenceNumber).toBe(1);
    expect(freshDecision!.auditHead?.eventHash).toBe(auditEvents[0].eventHash);
  });
});
