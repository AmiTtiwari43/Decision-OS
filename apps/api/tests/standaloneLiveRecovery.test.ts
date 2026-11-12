import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { assertTestDatabase } from '../src/db/guard.js';
import {
  DecisionModel,
  OperationJournalModel,
  AuditEventModel,
} from '../src/models/index.js';
import {
  populateSyntheticDemo,
  replaceSyntheticScore,
  reconcileStandaloneAudit,
  analyzeDecision,
  updateDecision,
} from '../src/services/decision.service.js';
import {
  auditService,
  computeCanonicalEventHash,
  GENESIS_PREVIOUS_HASH,
} from '../src/services/audit.service.js';
import {
  DecisionQuarantinedError,
} from '../src/errors/domain.errors.js';

const TEST_STANDALONE_URI =
  process.env.TEST_MONGODB_URI ||
  'mongodb://127.0.0.1:27017/decision_os_b02r6_live_test';

// Mandatory database safety precondition: Must strictly end with _test
assertTestDatabase(TEST_STANDALONE_URI);

describe('Batch 02-R6: Live Standalone Persistence & Recovery Verification', () => {
  const baseCriteria = [
    { id: 'crit-speed', name: 'Speed', weight: 50, direction: 'benefit' as const },
    { id: 'crit-cost', name: 'Cost', weight: 50, direction: 'cost' as const },
  ];

  const baseOptions = [
    { id: 'opt-x', name: 'Option X' },
    { id: 'opt-y', name: 'Option Y' },
  ];

  const testActor = {
    id: new mongoose.Types.ObjectId().toString(),
    role: 'admin',
    name: 'Live Standalone Auditor',
    email: 'auditor-live@decision-os.org',
  };

  beforeAll(async () => {
    // 1. Database Safety Precondition Checks
    assertTestDatabase(TEST_STANDALONE_URI);

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    await mongoose.connect(TEST_STANDALONE_URI);

    // Verify connected topology is Standalone (Topology Single, repl is null/undefined)
    const admin = mongoose.connection.db!.admin();
    const serverStatus = await admin.serverStatus();
    expect(serverStatus.repl).toBeUndefined();

    // Verify database name ends with _test and is not production/development
    const dbName = mongoose.connection.db!.databaseName;
    expect(dbName).toBe('decision_os_b02r6_live_test');
    expect(dbName).toMatch(/_test$/);
    expect(dbName).not.toBe('decision_os');

    // Sync indexes on all models to ensure collection indexes exist
    await DecisionModel.syncIndexes();
    await OperationJournalModel.syncIndexes();
    await AuditEventModel.syncIndexes();
  });

  afterAll(async () => {
    try {
      if (mongoose.connection.readyState === 1) {
        // Restricted cleanup strictly within this isolated test database
        await DecisionModel.collection.deleteMany({});
        await OperationJournalModel.collection.deleteMany({});
        await AuditEventModel.collection.deleteMany({});
        await mongoose.connection.db!.dropDatabase();
      }
    } catch {
      // Safe teardown
    } finally {
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await DecisionModel.collection.deleteMany({});
      await OperationJournalModel.collection.deleteMany({});
      await AuditEventModel.collection.deleteMany({});
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Mandatory Safety Preconditions
  // ══════════════════════════════════════════════════════════════════════════
  describe('1. Safety Preconditions & Topology Verification', () => {
    it('Refuses execution against non-test databases and verifies isolated test database', () => {
      expect(() => assertTestDatabase('mongodb://127.0.0.1:27017/decision_os')).toThrow(
        /Test database safety guard violation/
      );
      expect(() => assertTestDatabase('mongodb://127.0.0.1:27017/admin')).toThrow(
        /Test database safety guard violation/
      );
      expect(() => assertTestDatabase(TEST_STANDALONE_URI)).not.toThrow();
    });

    it('Verifies connected MongoDB is standalone instance on port 27017', async () => {
      const client = mongoose.connection.getClient() as unknown as {
        topology?: { description?: { type?: string; setName?: string } };
      };
      const type = client?.topology?.description?.type;
      const setName = client?.topology?.description?.setName;

      // Standalone MongoDB reports Single or null/undefined setName
      expect(setName ?? null).toBeNull();
      expect(['Single', 'Unknown']).toContain(type || 'Single');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Crash Boundary A: Journal created, decision not mutated
  // ══════════════════════════════════════════════════════════════════════════
  describe('2. Crash Boundary A — Journal created, decision not mutated', () => {
    it('reverts journal and leaves decision scores and version unchanged', async () => {
      // 1. Persist initial decision at version 1 with missing scores
      const decisionDoc = await DecisionModel.create({
        title: 'Crash Boundary A Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-x': { 'crit-speed': 80 } },
        scoreProvenance: {},
        version: 1,
        auditIntegrityStatus: 'healthy',
        isAudited: true,
      });

      const opId = `op-crash-a-${Date.now()}`;
      const eventId = `audit-crash-a-${Date.now()}`;

      // 2. Simulate interruption after journal creation but before decision mutation
      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decisionDoc._id,
        action: 'decision.synthetic_demo_populated',
        actor: testActor,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        auditDraft: {
          eventId,
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Simulated pending populate',
        },
      });

      // 3. Reconcile pending operation
      const reconciled = await reconcileStandaloneAudit(decisionDoc._id.toString(), opId);

      // 4. Verify journal is marked REVERTED in MongoDB
      const journalAfter = await OperationJournalModel.findOne({ operationId: opId });
      expect(journalAfter).not.toBeNull();
      expect(journalAfter!.state).toBe('REVERTED');

      // 5. Verify decision in MongoDB is unchanged
      const freshDecision = await DecisionModel.findById(decisionDoc._id);
      expect(freshDecision!.version).toBe(1);
      expect(freshDecision!.auditIntegrityStatus).toBe('healthy');
      expect(freshDecision!.pendingOperationId).toBeNull();
      expect(freshDecision!.scores).toEqual({ 'opt-x': { 'crit-speed': 80 } });

      // 6. Verify zero spurious audit events were appended
      const auditCount = await AuditEventModel.countDocuments({ decisionId: decisionDoc._id });
      expect(auditCount).toBe(0);
      expect(reconciled.version).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Crash Boundary B: Decision mutation committed, audit not appended
  // ══════════════════════════════════════════════════════════════════════════
  describe('3. Crash Boundary B — Decision mutation committed, audit not appended', () => {
    it('rolls forward audit event, transitions decision to healthy, and marks journal COMPLETED', async () => {
      const decisionDoc = await DecisionModel.create({
        title: 'Crash Boundary B Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-x': { 'crit-speed': 80 } },
        scoreProvenance: {},
        version: 1,
        auditIntegrityStatus: 'healthy',
        isAudited: true,
      });

      const opId = `op-crash-b-${Date.now()}`;
      const deterministicEventId = `audit-deterministic-b-${Date.now()}`;

      // 1. Journal persisted in PENDING state
      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decisionDoc._id,
        action: 'decision.synthetic_demo_populated',
        actor: testActor,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        auditDraft: {
          eventId: deterministicEventId,
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Populated 3 missing scores with demo 75',
          diff: { populatedCount: 3, defaultValue: 75 },
        },
      });

      // 2. Simulate interruption after decision mutation committed to MongoDB, but before audit append
      await DecisionModel.updateOne(
        { _id: decisionDoc._id, version: 1 },
        {
          $set: {
            scores: {
              'opt-x': { 'crit-speed': 80, 'crit-cost': 75 },
              'opt-y': { 'crit-speed': 75, 'crit-cost': 75 },
            },
            scoreProvenance: {
              'opt-x': { 'crit-cost': { isSynthetic: true, source: 'demo' } },
              'opt-y': {
                'crit-speed': { isSynthetic: true, source: 'demo' },
                'crit-cost': { isSynthetic: true, source: 'demo' },
              },
            },
            version: 2,
            isAudited: false,
            auditIntegrityStatus: 'pending_reconciliation',
            pendingOperationId: opId,
          },
        }
      );

      // Verify uncommitted state is visible in MongoDB
      const preRecovery = await DecisionModel.findById(decisionDoc._id);
      expect(preRecovery!.auditIntegrityStatus).toBe('pending_reconciliation');
      expect(preRecovery!.isAudited).toBe(false);
      expect(preRecovery!.version).toBe(2);

      // 3. Recovery worker reconciles
      const reconciled = await reconcileStandaloneAudit(decisionDoc._id.toString(), opId);

      // 4. Verify audit event is appended to MongoDB exactly once with the deterministic eventId
      const auditEvents = await AuditEventModel.find({ decisionId: decisionDoc._id });
      expect(auditEvents.length).toBe(1);
      expect(auditEvents[0].eventId).toBe(deterministicEventId);
      expect(auditEvents[0].sequenceNumber).toBe(1);
      expect(auditEvents[0].previousEventHash).toBe(GENESIS_PREVIOUS_HASH);
      expect(auditEvents[0].action).toBe('decision.synthetic_demo_populated');

      // 5. Verify decision became healthy and audited
      const freshDecision = await DecisionModel.findById(decisionDoc._id);
      expect(freshDecision!.auditIntegrityStatus).toBe('healthy');
      expect(freshDecision!.isAudited).toBe(true);
      expect(freshDecision!.pendingOperationId).toBeNull();
      expect(freshDecision!.version).toBe(2);

      // 6. Verify journal transitioned to COMPLETED
      const journalAfter = await OperationJournalModel.findOne({ operationId: opId });
      expect(journalAfter!.state).toBe('COMPLETED');
      expect(reconciled.auditIntegrityStatus).toBe('healthy');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Crash Boundary C: Audit event appended, decision not finalized
  // ══════════════════════════════════════════════════════════════════════════
  describe('4. Crash Boundary C — Audit event appended, decision not finalized', () => {
    it('is idempotent on retry: does not duplicate audit event, preserves hash chain, and finalizes decision', async () => {
      const decisionDoc = await DecisionModel.create({
        title: 'Crash Boundary C Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-x': { 'crit-speed': 80 } },
        scoreProvenance: {},
        version: 1,
        auditIntegrityStatus: 'healthy',
        isAudited: true,
      });

      const opId = `op-crash-c-${Date.now()}`;
      const deterministicEventId = `audit-deterministic-c-${Date.now()}`;

      // 1. Journal persisted
      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decisionDoc._id,
        action: 'decision.synthetic_demo_populated',
        actor: testActor,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        auditDraft: {
          eventId: deterministicEventId,
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Interrupted before finalization',
        },
      });

      // 2. Decision mutated to version 2 (pending_reconciliation)
      await DecisionModel.updateOne(
        { _id: decisionDoc._id },
        {
          $set: {
            version: 2,
            isAudited: false,
            auditIntegrityStatus: 'pending_reconciliation',
            pendingOperationId: opId,
          },
        }
      );

      // 3. Audit event was already written to MongoDB
      await auditService.recordEvent({
        decisionId: decisionDoc._id.toString(),
        eventId: deterministicEventId,
        actor: testActor,
        action: 'decision.synthetic_demo_populated',
        entityType: 'decision',
        entityId: decisionDoc._id.toString(),
        summary: 'Interrupted before finalization',
        sequenceNumber: 1,
      });

      // Verify audit event exists before recovery pass
      const initialCount = await AuditEventModel.countDocuments({ decisionId: decisionDoc._id });
      expect(initialCount).toBe(1);

      // 4. Recovery worker runs reconciliation
      await reconcileStandaloneAudit(decisionDoc._id.toString(), opId);

      // 5. Verify NO duplicate audit event was created
      const finalCount = await AuditEventModel.countDocuments({ decisionId: decisionDoc._id });
      expect(finalCount).toBe(1);

      // 6. Verify audit sequence and hash-chain integrity
      const auditDoc = await AuditEventModel.findOne({ eventId: deterministicEventId });
      expect(auditDoc).not.toBeNull();
      expect(auditDoc!.sequenceNumber).toBe(1);
      expect(auditDoc!.previousEventHash).toBe(GENESIS_PREVIOUS_HASH);

      const expectedHash = computeCanonicalEventHash({
        eventId: auditDoc!.eventId,
        decisionId: auditDoc!.decisionId.toString(),
        actorId: auditDoc!.actorId,
        action: auditDoc!.action,
        entityType: auditDoc!.entityType,
        entityId: auditDoc!.entityId,
        summary: auditDoc!.summary,
        diff: auditDoc!.diff,
        originalTimestamp: auditDoc!.originalTimestamp,
        timestamp: auditDoc!.timestamp,
        previousEventHash: auditDoc!.previousEventHash,
        schemaVersion: auditDoc!.schemaVersion,
        sequenceNumber: auditDoc!.sequenceNumber,
      });
      expect(auditDoc!.eventHash).toBe(expectedHash);

      // 7. Verify decision is healthy and journal COMPLETED
      const freshDecision = await DecisionModel.findById(decisionDoc._id);
      expect(freshDecision!.auditIntegrityStatus).toBe('healthy');
      expect(freshDecision!.pendingOperationId).toBeNull();
      expect(freshDecision!.isAudited).toBe(true);

      const freshJournal = await OperationJournalModel.findOne({ operationId: opId });
      expect(freshJournal!.state).toBe('COMPLETED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Crash Boundary D: Invariant violation handling
  // ══════════════════════════════════════════════════════════════════════════
  describe('5. Crash Boundary D — Invariant violations (Quarantine defenses)', () => {
    it('Subcase D1: Missing journal quarantines decision and blocks mutations & analysis', async () => {
      const decisionDoc = await DecisionModel.create({
        title: 'Missing Journal Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: {
          'opt-x': { 'crit-speed': 80, 'crit-cost': 60 },
          'opt-y': { 'crit-speed': 70, 'crit-cost': 90 },
        },
        version: 2,
        isAudited: false,
        auditIntegrityStatus: 'pending_reconciliation',
        pendingOperationId: 'non-existent-op-id',
      });

      // Reconciliation fails with DecisionQuarantinedError
      await expect(
        reconcileStandaloneAudit(decisionDoc._id.toString(), 'non-existent-op-id')
      ).rejects.toThrow(DecisionQuarantinedError);

      // Verify decision is quarantined in MongoDB
      const quarantined = await DecisionModel.findById(decisionDoc._id);
      expect(quarantined!.auditIntegrityStatus).toBe('quarantined');
      expect(quarantined!.quarantineReason).toContain('Operation journal not found');

      // Verify authoritative analysis is strictly blocked
      await expect(
        analyzeDecision(decisionDoc._id.toString(), testActor)
      ).rejects.toThrow(DecisionQuarantinedError);

      // Verify normal mutations are strictly blocked
      await expect(
        populateSyntheticDemo(decisionDoc._id.toString(), 75, 2, testActor)
      ).rejects.toThrow(DecisionQuarantinedError);

      await expect(
        updateDecision(decisionDoc._id.toString(), { title: 'Bypassed Title' }, testActor, 2)
      ).rejects.toThrow(DecisionQuarantinedError);
    });

    it('Subcase D2: Version desynchronization marks journal UNRECOVERABLE and quarantines decision', async () => {
      const decisionDoc = await DecisionModel.create({
        title: 'Desynchronized Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: {},
        version: 99, // Unexpected desynchronized version
        isAudited: false,
        auditIntegrityStatus: 'pending_reconciliation',
        pendingOperationId: 'op-desync-live',
      });

      await OperationJournalModel.create({
        operationId: 'op-desync-live',
        decisionId: decisionDoc._id,
        action: 'decision.synthetic_demo_populated',
        actor: testActor,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        auditDraft: {
          eventId: 'audit-desync-live',
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Desync live test',
        },
      });

      await expect(
        reconcileStandaloneAudit(decisionDoc._id.toString(), 'op-desync-live')
      ).rejects.toThrow(DecisionQuarantinedError);

      // Verify journal state is UNRECOVERABLE
      const journalAfter = await OperationJournalModel.findOne({ operationId: 'op-desync-live' });
      expect(journalAfter!.state).toBe('UNRECOVERABLE');
      expect(journalAfter!.errorDetails).toContain('Version mismatch');

      // Verify decision state is quarantined
      const quarantined = await DecisionModel.findById(decisionDoc._id);
      expect(quarantined!.auditIntegrityStatus).toBe('quarantined');
      expect(quarantined!.quarantineReason).toContain('Version desynchronization');

      // Authoritative analysis and mutations remain blocked
      await expect(
        analyzeDecision(decisionDoc._id.toString(), testActor)
      ).rejects.toThrow(DecisionQuarantinedError);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Crash Boundary E: Concurrent reconciliation
  // ══════════════════════════════════════════════════════════════════════════
  describe('6. Crash Boundary E — Concurrent reconciliation worker safety', () => {
    it('executes exactly-once completion without duplicate audit events or hash-chain corruption', async () => {
      const decisionDoc = await DecisionModel.create({
        title: 'Concurrent Reconciliation Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-x': { 'crit-speed': 85 } },
        scoreProvenance: {},
        version: 1,
        auditIntegrityStatus: 'healthy',
        isAudited: true,
      });

      const opId = `op-concurrent-${Date.now()}`;
      const deterministicEventId = `audit-deterministic-concurrent-${Date.now()}`;

      // 1. Persist operation journal
      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decisionDoc._id,
        action: 'decision.synthetic_demo_populated',
        actor: testActor,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        auditDraft: {
          eventId: deterministicEventId,
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Concurrent recovery test',
          diff: { populatedCount: 3, defaultValue: 75 },
        },
      });

      // 2. Decision committed at version 2 (pending_reconciliation)
      await DecisionModel.updateOne(
        { _id: decisionDoc._id },
        {
          $set: {
            scores: {
              'opt-x': { 'crit-speed': 85, 'crit-cost': 75 },
              'opt-y': { 'crit-speed': 75, 'crit-cost': 75 },
            },
            version: 2,
            isAudited: false,
            auditIntegrityStatus: 'pending_reconciliation',
            pendingOperationId: opId,
          },
        }
      );

      // 3. Launch two reconciliation workers simultaneously against the exact same pending operation
      const [worker1Result, worker2Result] = await Promise.all([
        reconcileStandaloneAudit(decisionDoc._id.toString(), opId),
        reconcileStandaloneAudit(decisionDoc._id.toString(), opId),
      ]);

      expect(worker1Result.version).toBe(2);
      expect(worker2Result.version).toBe(2);

      // 4. Verify audit event is persisted EXACTLY ONCE
      const auditEvents = await AuditEventModel.find({ decisionId: decisionDoc._id });
      expect(auditEvents.length).toBe(1);
      expect(auditEvents[0].eventId).toBe(deterministicEventId);
      expect(auditEvents[0].sequenceNumber).toBe(1);

      // 5. Verify decision finalized in MongoDB
      const freshDecision = await DecisionModel.findById(decisionDoc._id);
      expect(freshDecision!.auditIntegrityStatus).toBe('healthy');
      expect(freshDecision!.isAudited).toBe(true);
      expect(freshDecision!.pendingOperationId).toBeNull();
      expect(freshDecision!.version).toBe(2);

      // 6. Verify journal is COMPLETED
      const freshJournal = await OperationJournalModel.findOne({ operationId: opId });
      expect(freshJournal!.state).toBe('COMPLETED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Persistence and Index Verification
  // ══════════════════════════════════════════════════════════════════════════
  describe('7. Persistence and Index Verification on Standalone Database', () => {
    it('verifies unique and compound indexes exist on live MongoDB collections', async () => {
      const journalIndexes = await OperationJournalModel.collection.indexes();
      const auditIndexes = await AuditEventModel.collection.indexes();
      const decisionIndexes = await DecisionModel.collection.indexes();

      // OperationJournalModel: unique operationId
      const opIdIndex = journalIndexes.find((idx) => idx.key?.operationId === 1);
      expect(opIdIndex).toBeDefined();
      expect(opIdIndex!.unique).toBe(true);

      // AuditEventModel: unique eventId
      const eventIdIndex = auditIndexes.find((idx) => idx.key?.eventId === 1);
      expect(eventIdIndex).toBeDefined();
      expect(eventIdIndex!.unique).toBe(true);

      // AuditEventModel: unique { decisionId: 1, sequenceNumber: 1 }
      const seqIndex = auditIndexes.find(
        (idx) => idx.key?.decisionId === 1 && idx.key?.sequenceNumber === 1
      );
      expect(seqIndex).toBeDefined();
      expect(seqIndex!.unique).toBe(true);

      // AuditEventModel: unique { decisionId: 1, previousEventHash: 1 }
      const prevHashIndex = auditIndexes.find(
        (idx) => idx.key?.decisionId === 1 && idx.key?.previousEventHash === 1
      );
      expect(prevHashIndex).toBeDefined();
      expect(prevHashIndex!.unique).toBe(true);

      // DecisionModel: auditIntegrityStatus indexed
      const integrityIndex = decisionIndexes.find(
        (idx) => idx.key?.auditIntegrityStatus === 1
      );
      expect(integrityIndex).toBeDefined();
    });

    it('proves MongoDB rejects duplicate eventId and duplicate sequenceNumber', async () => {
      const decisionDoc = await DecisionModel.create({
        title: 'Index Constraint Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: {},
      });

      const fixedEventId = `unique-evt-${Date.now()}`;

      // Insert first audit event
      await AuditEventModel.collection.insertOne({
        eventId: fixedEventId,
        decisionId: decisionDoc._id,
        actorId: testActor.id,
        action: 'decision.created',
        entityType: 'decision',
        entityId: decisionDoc._id.toString(),
        summary: 'First event',
        sequenceNumber: 1,
        previousEventHash: GENESIS_PREVIOUS_HASH,
        eventHash: 'hash-1111111111111111111111111111111111111111111111111111111111111111',
        timestamp: new Date(),
        originalTimestamp: new Date(),
        schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Attempt to insert duplicate eventId -> must reject with code 11000
      await expect(
        AuditEventModel.collection.insertOne({
          eventId: fixedEventId, // Duplicate!
          decisionId: decisionDoc._id,
          actorId: testActor.id,
          action: 'decision.updated',
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Duplicate eventId',
          sequenceNumber: 2,
          previousEventHash: 'hash-1111111111111111111111111111111111111111111111111111111111111111',
          eventHash: 'hash-2222222222222222222222222222222222222222222222222222222222222222',
          timestamp: new Date(),
          originalTimestamp: new Date(),
          schemaVersion: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).rejects.toThrow(/E11000/);

      // Attempt to insert duplicate sequenceNumber -> must reject with code 11000
      await expect(
        AuditEventModel.collection.insertOne({
          eventId: `another-evt-${Date.now()}`,
          decisionId: decisionDoc._id,
          actorId: testActor.id,
          action: 'decision.updated',
          entityType: 'decision',
          entityId: decisionDoc._id.toString(),
          summary: 'Duplicate sequenceNumber',
          sequenceNumber: 1, // Duplicate sequence for this decision!
          previousEventHash: 'hash-3333333333333333333333333333333333333333333333333333333333333333',
          eventHash: 'hash-4444444444444444444444444444444444444444444444444444444444444444',
          timestamp: new Date(),
          originalTimestamp: new Date(),
          schemaVersion: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).rejects.toThrow(/E11000/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. End-to-End Live Hash-Chain Verification
  // ══════════════════════════════════════════════════════════════════════════
  describe('8. Live Audit Hash-Chain Verification across lifecycle operations', () => {
    it('preserves unbroken SHA-256 hash chaining across populate and replacement on standalone MongoDB', async () => {
      // 1. Create decision doc
      const decisionDoc = await DecisionModel.create({
        title: 'Hash-Chain Lifecycle Decision',
        ownerId: new mongoose.Types.ObjectId(testActor.id),
        criteria: baseCriteria,
        options: baseOptions,
        scores: {},
        scoreProvenance: {},
        version: 1,
        auditIntegrityStatus: 'healthy',
        isAudited: true,
      });

      // 2. Populate synthetic demo scores
      const populated = await populateSyntheticDemo(decisionDoc._id.toString(), 75, 1, testActor);
      expect(populated.version).toBe(2);

      // 3. Replace one synthetic coordinate with a real score
      const replaced = await replaceSyntheticScore(
        decisionDoc._id.toString(),
        {
          optionId: 'opt-x',
          criterionId: 'crit-speed',
          score: 88,
          comment: 'Verified real lab measurement',
          expectedVersion: 2,
        },
        testActor
      );
      expect(replaced.version).toBe(3);

      // 4. Retrieve all audit events from MongoDB in sequence order
      const events = await AuditEventModel.find({ decisionId: decisionDoc._id })
        .sort({ sequenceNumber: 1 })
        .exec();

      expect(events.length).toBe(2);

      // Event 1 verification
      expect(events[0].sequenceNumber).toBe(1);
      expect(events[0].previousEventHash).toBe(GENESIS_PREVIOUS_HASH);
      expect(events[0].action).toBe('decision.synthetic_demo_populated');

      const expectedHash0 = computeCanonicalEventHash({
        eventId: events[0].eventId,
        decisionId: events[0].decisionId.toString(),
        actorId: events[0].actorId,
        action: events[0].action,
        entityType: events[0].entityType,
        entityId: events[0].entityId,
        summary: events[0].summary,
        diff: events[0].diff,
        originalTimestamp: events[0].originalTimestamp,
        timestamp: events[0].timestamp,
        previousEventHash: events[0].previousEventHash,
        schemaVersion: events[0].schemaVersion,
        sequenceNumber: events[0].sequenceNumber,
      });
      expect(events[0].eventHash).toBe(expectedHash0);

      // Event 2 verification: previousEventHash MUST strictly match Event 1's eventHash
      expect(events[1].sequenceNumber).toBe(2);
      expect(events[1].previousEventHash).toBe(events[0].eventHash);
      expect(events[1].action).toBe('decision.synthetic_score_replaced');

      const expectedHash1 = computeCanonicalEventHash({
        eventId: events[1].eventId,
        decisionId: events[1].decisionId.toString(),
        actorId: events[1].actorId,
        action: events[1].action,
        entityType: events[1].entityType,
        entityId: events[1].entityId,
        summary: events[1].summary,
        diff: events[1].diff,
        originalTimestamp: events[1].originalTimestamp,
        timestamp: events[1].timestamp,
        previousEventHash: events[1].previousEventHash,
        schemaVersion: events[1].schemaVersion,
        sequenceNumber: events[1].sequenceNumber,
      });
      expect(events[1].eventHash).toBe(expectedHash1);
    });
  });
});
