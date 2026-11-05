import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  connectToDatabase,
  disconnectFromDatabase,
} from '../src/db/connection.js';
import {
  getTestDatabaseUri,
  assertTestDatabase,
  claimTestDatabaseOwnership,
  assertCanCleanupTestDatabase,
} from '../src/db/guard.js';
import {
  DecisionModel,
  OperationJournalModel,
  DecisionContributionModel,
  NotificationConsumerRecordModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { recoveryWorkerService } from '../src/services/recoveryWorker.service.js';
import { outboxService } from '../src/services/outbox.service.js';
import { contributionRepository } from '../src/repositories/contribution.repository.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

const TEST_URI = getTestDatabaseUri(undefined, { runId: 'v3_remediation', workerId: '0' });
assertTestDatabase(TEST_URI);

describe('Batch 4 Remediation V3 — Adversarial Verification Suite', () => {
  beforeAll(async () => {
    await connectToDatabase(TEST_URI);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE B: CONTRIBUTION RECOVERY FENCING ADVERSARIAL TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe('Phase B — Contribution Recovery Fencing Invariants', () => {
    it('Scenario 1: Worker A (gen 1) paused -> Worker B takes over (gen 2) -> Worker A projection aborts, Worker B completes', async () => {
      const decisionId = new mongoose.Types.ObjectId();
      const opId = `op-b1-${Date.now()}`;

      await DecisionModel.create({
        _id: decisionId,
        title: 'Phase B Scenario 1 Decision',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: 'healthy',
      });

      const contrib = await DecisionContributionModel.create({
        decisionId,
        contributorId: new mongoose.Types.ObjectId(),
        recommendation: { preferredOptionId: 'o1', rationale: 'Phase B' },
        criterionScores: { c1: 90 },
        status: 'submitted',
        revision: 1,
      });

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: { preferredOptionId: 'o1', revision: 1 },
        previousSnapshot: { version: 1, scores: { o1: { c1: 50 } } },
        auditDraft: {
          eventId: 'ev-b1',
          entityType: 'contribution',
          entityId: contrib._id.toString(),
          summary: 'Adopt contribution',
        },
      });

      // Advance journal to EVALUATED state
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { state: 'EVALUATED' } }
      );

      // 1. Worker A claims generation 1
      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 30000, opId);
      expect(claimA?.fencingToken).toBe(1);
      expect(claimA?.recoveryOwner).toBe('worker-A');

      // 2. Worker A pauses before projection; deterministically expire A's lease in database
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );
      await DecisionModel.updateOne(
        { _id: decisionId },
        { $set: { recoveryLeaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // 3. Worker B takes over with generation 2
      const claimB = await operationJournalRepository.claimJournalOperation('worker-B', 30000, opId);
      expect(claimB?.fencingToken).toBe(2);
      expect(claimB?.recoveryOwner).toBe('worker-B');

      // 4. Worker A resumes and attempts to reconcile with stale token 1 -> MUST throw ConcurrencyFencingError
      await expect(
        recoveryWorkerService.reconcileOperation(
          { ...claimA!.toObject(), fencingToken: 1 } as any,
          'worker-A'
        )
      ).rejects.toThrow(ConcurrencyFencingError);

      // Verify contribution was NOT adopted by Worker A
      const contribCheck = await DecisionContributionModel.findById(contrib._id);
      expect(contribCheck?.status).toBe('submitted');
      expect(contribCheck?.adoptedFencingToken).toBeNull();

      // 5. Worker B completes the operation cleanly
      const resultB = await recoveryWorkerService.reconcileOperation(claimB!, 'worker-B');
      expect(['completed', 'reverted']).toContain(resultB);

      // Verify contribution is now adopted with Worker B's token 2
      const contribFinal = await DecisionContributionModel.findById(contrib._id);
      expect(contribFinal?.status).toBe('adopted');
      expect(contribFinal?.adoptedFencingToken).toBe(2);
      expect(contribFinal?.adoptedOperationId).toBe(opId);
    });

    it('Scenario 2: Contribution rejection between Worker A pause and resume causes projection write to abort', async () => {
      const decisionId = new mongoose.Types.ObjectId();
      const opId = `op-b2-${Date.now()}`;

      await DecisionModel.create({
        _id: decisionId,
        title: 'Phase B Scenario 2 Decision',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: 'healthy',
      });

      const contrib = await DecisionContributionModel.create({
        decisionId,
        contributorId: new mongoose.Types.ObjectId(),
        recommendation: { preferredOptionId: 'o1', rationale: 'Phase B' },
        criterionScores: { c1: 90 },
        status: 'submitted',
        revision: 1,
      });

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: { preferredOptionId: 'o1', revision: 1 },
        previousSnapshot: { version: 1, scores: { o1: { c1: 50 } } },
        auditDraft: {
          eventId: 'ev-b2',
          entityType: 'contribution',
          entityId: contrib._id.toString(),
          summary: 'Adopt contribution',
        },
      });

      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { state: 'EVALUATED' } }
      );

      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 30000, opId);
      expect(claimA).not.toBeNull();

      // Interleaving: Owner rejects contribution while Worker A is paused
      await contributionRepository.reject(
        contrib._id.toString(),
        'Rejected during audit',
        { id: 'owner-1', role: 'owner' }
      );

      // Worker A resumes -> projection must fail closed because status is 'rejected' (not 'submitted')
      await expect(
        recoveryWorkerService.reconcileOperation(claimA!, 'worker-A')
      ).rejects.toThrow();

      const contribCheck = await DecisionContributionModel.findById(contrib._id);
      expect(contribCheck?.status).toBe('rejected');
    });

    it('Scenario 3: Contributor withdrawal and resubmission (revision 2) invalidates stale revision 1 adoption', async () => {
      const decisionId = new mongoose.Types.ObjectId();
      const opId = `op-b3-${Date.now()}`;
      const contributorId = new mongoose.Types.ObjectId();

      await DecisionModel.create({
        _id: decisionId,
        title: 'Phase B Scenario 3 Decision',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: 'healthy',
      });

      const contrib = await DecisionContributionModel.create({
        decisionId,
        contributorId,
        recommendation: { preferredOptionId: 'o1', rationale: 'Phase B' },
        criterionScores: { c1: 90 },
        status: 'submitted',
        revision: 1,
      });

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: { preferredOptionId: 'o1', revision: 1 },
        previousSnapshot: { version: 1, scores: { o1: { c1: 50 } } },
        auditDraft: {
          eventId: 'ev-b3',
          entityType: 'contribution',
          entityId: contrib._id.toString(),
          summary: 'Adopt contribution',
        },
      });

      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { state: 'EVALUATED' } }
      );

      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 30000, opId);
      expect(claimA).not.toBeNull();

      // Interleaving: Contributor withdraws, modifies to revision 2, and resubmits
      await DecisionContributionModel.updateOne(
        { _id: contrib._id },
        {
          $set: {
            revision: 2,
            status: 'submitted',
            'criterionScores.c1': 95,
          },
        }
      );

      // Worker A attempts adoption expecting revision 1 -> Rejection
      await expect(
        recoveryWorkerService.reconcileOperation(claimA!, 'worker-A')
      ).rejects.toThrow();

      const contribCheck = await DecisionContributionModel.findById(contrib._id);
      expect(contribCheck?.revision).toBe(2);
      expect(contribCheck?.status).toBe('submitted');
    });

    it('Scenario 4: Quarantine occurring before projection immediately aborts recovery write', async () => {
      const decisionId = new mongoose.Types.ObjectId();
      const opId = `op-b4-${Date.now()}`;

      await DecisionModel.create({
        _id: decisionId,
        title: 'Phase B Scenario 4 Decision',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: 'healthy',
      });

      const contrib = await DecisionContributionModel.create({
        decisionId,
        contributorId: new mongoose.Types.ObjectId(),
        recommendation: { preferredOptionId: 'o1', rationale: 'Phase B' },
        criterionScores: { c1: 90 },
        status: 'submitted',
        revision: 1,
      });

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: { preferredOptionId: 'o1', revision: 1 },
        previousSnapshot: { version: 1, scores: { o1: { c1: 50 } } },
        auditDraft: {
          eventId: 'ev-b4',
          entityType: 'contribution',
          entityId: contrib._id.toString(),
          summary: 'Adopt contribution',
        },
      });

      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { state: 'EVALUATED' } }
      );

      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 30000, opId);
      expect(claimA).not.toBeNull();

      // Interleaving: Decision is quarantined by an integrity watchdog
      await DecisionModel.updateOne(
        { _id: decisionId },
        { $set: { auditIntegrityStatus: 'quarantined', quarantineReason: 'Integrity alert' } }
      );

      // Worker A resumes -> Must throw ConcurrencyFencingError
      await expect(
        recoveryWorkerService.reconcileOperation(claimA!, 'worker-A')
      ).rejects.toThrow(ConcurrencyFencingError);

      const contribCheck = await DecisionContributionModel.findById(contrib._id);
      expect(contribCheck?.status).toBe('submitted');
    });

    it('Scenario 5: Idempotent recovery when contribution was already adopted by the exact same operation', async () => {
      const decisionId = new mongoose.Types.ObjectId();
      const opId = `op-b5-${Date.now()}`;

      await DecisionModel.create({
        _id: decisionId,
        title: 'Phase B Scenario 5 Decision',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: 'healthy',
      });

      // Contribution already marked adopted by THIS operation
      const contrib = await DecisionContributionModel.create({
        decisionId,
        contributorId: new mongoose.Types.ObjectId(),
        recommendation: { preferredOptionId: 'o1', rationale: 'Phase B' },
        criterionScores: { c1: 90 },
        status: 'adopted',
        revision: 1,
        adoptedOperationId: opId,
        adoptedDecisionVersion: 2,
        adoptedFencingToken: 1,
      });

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: { preferredOptionId: 'o1', revision: 1 },
        previousSnapshot: { version: 1, scores: { o1: { c1: 50 } } },
        auditDraft: {
          eventId: 'ev-b5',
          entityType: 'contribution',
          entityId: contrib._id.toString(),
          summary: 'Adopt contribution',
        },
      });

      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { state: 'EVALUATED' } }
      );

      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 30000, opId);
      expect(claimA).not.toBeNull();

      // Worker A reconciles: must recognize idempotent adoption and complete cleanly
      const result = await recoveryWorkerService.reconcileOperation(claimA!, 'worker-A');
      expect(['completed', 'reverted']).toContain(result);

      const contribFinal = await DecisionContributionModel.findById(contrib._id);
      expect(contribFinal?.status).toBe('adopted');
      expect(contribFinal?.adoptedOperationId).toBe(opId);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE C: CONSISTENT RECOVERY LEASE VALIDATION & QUARANTINE
  // ───────────────────────────────────────────────────────────────────────────
  describe('Phase C — Recovery Lease Validation & Quarantine Consistency', () => {
    it('rejects lease renewal on quarantined decisions', async () => {
      const decisionId = new mongoose.Types.ObjectId();
      const opId = `op-c1-${Date.now()}`;

      await DecisionModel.create({
        _id: decisionId,
        title: 'Phase C Decision',
        criteria: [],
        options: [],
        scores: {},
        version: 1,
        pendingOperationId: opId,
        auditIntegrityStatus: 'quarantined',
        quarantineReason: 'Audit corruption detected',
        recoveryFencingToken: 1,
        recoveryOwner: 'worker-C1',
        recoveryLeaseExpiresAt: new Date(Date.now() + 30000),
      });

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: {},
        auditDraft: { eventId: 'ev-c1', entityType: 'decision', entityId: decisionId.toString(), summary: 'Test' },
      });

      await OperationJournalModel.updateOne(
        { operationId: opId },
        {
          $set: {
            recoveryOwner: 'worker-C1',
            fencingToken: 1,
            leaseExpiresAt: new Date(Date.now() + 30000),
          },
        }
      );

      // Attempt lease renewal with decisionId
      const renewed = await operationJournalRepository.renewOperationLease(
        opId,
        'worker-C1',
        1,
        30000,
        decisionId.toString()
      );

      // Invariant: Quarantined decision lease cannot be renewed
      expect(renewed).toBe(false);
    });

    it('expired lease cannot be renewed by its former owner', async () => {
      const opId = `op-c2-${Date.now()}`;
      const decisionId = new mongoose.Types.ObjectId();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: 'admin-1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: {},
        auditDraft: { eventId: 'ev-c2', entityType: 'decision', entityId: decisionId.toString(), summary: 'Test' },
      });

      // Claim and then deterministically expire
      await operationJournalRepository.claimJournalOperation('worker-C2', 30000, opId);
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // Renewal must return false
      const renewed = await operationJournalRepository.renewOperationLease(opId, 'worker-C2', 1, 30000);
      expect(renewed).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE D: DURABLE CONSUMER PROCESSING LIFECYCLE
  // ───────────────────────────────────────────────────────────────────────────
  describe('Phase D — Durable Consumer Processing Lifecycle', () => {
    it('survives crash before side effect: retry reclaims processing lease and executes side effect', async () => {
      const consumerId = 'billing-sync-consumer';
      const notificationId = `notif-d1-${Date.now()}`;

      let sideEffectCount = 0;
      const doSideEffect = async () => {
        sideEffectCount++;
        return { billed: true };
      };

      // 1. Worker 1 claims processing
      const claim1 = await outboxService.claimConsumerProcessing(
        consumerId,
        notificationId,
        'worker-1',
        5000 // 5-second lease
      );
      expect(claim1.status).toBe('CLAIMED');
      expect(claim1.claimGeneration).toBe(1);

      // 2. SIMULATE CRASH: Worker 1 crashes before calling doSideEffect()
      expect(sideEffectCount).toBe(0);

      // Deterministically expire Worker 1's processing lease in database
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );

      // 3. Worker 2 (retry delivery) claims the expired processing lease
      const result = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        'worker-2',
        doSideEffect
      );

      // At-least-once delivery preserved! Side effect executed exactly once.
      expect(result.executed).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.status).toBe('COMPLETED');
      expect(sideEffectCount).toBe(1);

      // Verify database record state
      const record = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
      expect(record?.status).toBe('COMPLETED');
      expect(record?.attemptCount).toBe(2);
      expect(record?.claimGeneration).toBe(2);
    });

    it('duplicate delivery after completion returns duplicate: true without re-executing side effect', async () => {
      const consumerId = 'email-digest-consumer';
      const notificationId = `notif-d2-${Date.now()}`;

      let sideEffectCount = 0;
      const sendEmail = async () => {
        sideEffectCount++;
        return 'sent';
      };

      // First execution
      const first = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        'worker-1',
        sendEmail
      );
      expect(first.executed).toBe(true);
      expect(sideEffectCount).toBe(1);

      // Redelivery
      const second = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        'worker-2',
        sendEmail
      );
      expect(second.executed).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(second.status).toBe('DUPLICATE');
      expect(sideEffectCount).toBe(1); // NEVER executed a second time!
    });

    it('two concurrent consumers racing for the same notification: exactly 1 wins, other receives LOCKED', async () => {
      const consumerId = 'crm-lead-consumer';
      const notificationId = `notif-d3-${Date.now()}`;

      let executionCount = 0;
      const syncLead = async () => {
        executionCount++;
        return 'synced';
      };

      const [resA, resB] = await Promise.all([
        outboxService.processConsumerEvent(consumerId, notificationId, 'worker-A', syncLead),
        outboxService.processConsumerEvent(consumerId, notificationId, 'worker-B', syncLead),
      ]);

      const executedCount = [resA, resB].filter((r) => r.executed).length;
      expect(executedCount).toBe(1);
      expect(executionCount).toBe(1);
    });

    it('rejects stale consumer completion when lease expired and was claimed by another worker', async () => {
      const consumerId = 'analytics-export-consumer';
      const notificationId = `notif-d4-${Date.now()}`;

      // Worker 1 claims generation 1
      const claim1 = await outboxService.claimConsumerProcessing(
        consumerId,
        notificationId,
        'worker-1',
        30000
      );
      expect(claim1.status).toBe('CLAIMED');
      expect(claim1.claimGeneration).toBe(1);

      // Deterministically expire Worker 1's lease
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );

      // Worker 2 takes over with generation 2
      const claim2 = await outboxService.claimConsumerProcessing(
        consumerId,
        notificationId,
        'worker-2',
        30000
      );
      expect(claim2.status).toBe('CLAIMED');
      expect(claim2.claimGeneration).toBe(2);

      // Worker 1 attempts completion with stale token 1 -> MUST be rejected!
      const staleCompleted = await outboxService.completeConsumerProcessing(
        consumerId,
        notificationId,
        'worker-1',
        1
      );
      expect(staleCompleted).toBe(false);

      // Worker 2 completes with valid token 2 -> SUCCEEDS
      const validCompleted = await outboxService.completeConsumerProcessing(
        consumerId,
        notificationId,
        'worker-2',
        2
      );
      expect(validCompleted).toBe(true);

      const record = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
      expect(record?.status).toBe('COMPLETED');
    });

    it('enforces bounded retries and marks MAX_RETRIES_EXCEEDED when retry limit is exceeded', async () => {
      const consumerId = 'failing-webhook-consumer';
      const notificationId = `notif-d5-${Date.now()}`;

      // Simulate 5 consecutive failed attempts
      for (let i = 1; i <= 5; i++) {
        const claim = await outboxService.claimConsumerProcessing(
          consumerId,
          notificationId,
          `worker-${i}`,
          30000,
          5 // maxAttempts: 5
        );
        expect(claim.status).toBe('CLAIMED');
        expect(claim.claimGeneration).toBe(i);

        await outboxService.failConsumerProcessing(
          consumerId,
          notificationId,
          `worker-${i}`,
          i,
          `Error attempt ${i}`
        );

        // Expire lease so next attempt can claim
        await NotificationConsumerRecordModel.updateOne(
          { consumerId, notificationId },
          { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
        );
      }

      // 6th attempt: retry limit exceeded!
      const claim6 = await outboxService.claimConsumerProcessing(
        consumerId,
        notificationId,
        'worker-6',
        30000,
        5
      );
      expect(claim6.status).toBe('MAX_RETRIES_EXCEEDED');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE E & F: ATOMIC TEST DATABASE OWNERSHIP & CLEANUP
  // ───────────────────────────────────────────────────────────────────────────
  describe('Phase E & F — Atomic Test Database Ownership & Safe Cleanup', () => {
    it('two concurrent claims on the same test database result in exactly 1 winner; loser throws and preserves winner record', async () => {
      const db = mongoose.connection.db;
      expect(db).toBeDefined();
      if (!db) return;

      const metaCol = db.collection('__test_run_metadata');
      await metaCol.deleteMany({});

      const [res1, res2] = await Promise.allSettled([
        claimTestDatabaseOwnership(mongoose.connection, 'run-alpha', 'worker-1'),
        claimTestDatabaseOwnership(mongoose.connection, 'run-beta', 'worker-2'),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify the winning record is strictly intact and was not corrupted
      const currentLock = await metaCol.findOne({ _id: 'ownership_lock' as any });
      expect(['run-alpha', 'run-beta']).toContain(currentLock?.runId);
    });

    it('enforces worker-level isolation during cleanup: Worker 2 cannot clean Worker 1 database', async () => {
      const db = mongoose.connection.db;
      expect(db).toBeDefined();
      if (!db) return;

      const metaCol = db.collection('__test_run_metadata');
      await metaCol.deleteMany({});

      // Worker 1 establishes ownership
      await claimTestDatabaseOwnership(mongoose.connection, 'shared-run-id', 'worker-1');

      // Worker 1 can verify cleanup safety
      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'shared-run-id', 'worker-1')
      ).resolves.not.toThrow();

      // Worker 2 in the same run is strictly blocked from cleaning Worker 1 database
      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'shared-run-id', 'worker-2')
      ).rejects.toThrowError(/Safety guard violation: database .* is owned by worker 'worker-1' \(expected 'worker-2'\)/);
    });

    it('missing ownership lock prevents cleanup (fail closed)', async () => {
      const db = mongoose.connection.db;
      expect(db).toBeDefined();
      if (!db) return;

      const metaCol = db.collection('__test_run_metadata');
      await metaCol.deleteMany({});

      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'any-run-id', 'worker-1')
      ).rejects.toThrowError(/has no ownership lock metadata\. Refusing cleanup\./);
    });

    it('refuses cleanup on non-test or reserved database names', async () => {
      const fakeConnection = {
        db: {
          databaseName: 'production',
          collection: () => ({ findOne: async () => ({ runId: 'run-prod', workerId: 'worker-1' }) }),
        },
      } as unknown as mongoose.Connection;

      await expect(
        assertCanCleanupTestDatabase(fakeConnection, 'run-prod', 'worker-1')
      ).rejects.toThrowError(/Safety guard violation/);
    });
  });
});
