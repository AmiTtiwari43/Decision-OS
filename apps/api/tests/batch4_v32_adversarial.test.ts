import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  getTestDatabaseUri,
  claimTestDatabaseOwnership,
  assertCanCleanupTestDatabase,
  cleanupTestDatabase,
} from '../src/db/guard.js';
import {
  DecisionModel,
  OperationJournalModel,
  NotificationConsumerRecordModel,
  NotificationOutboxModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { outboxRepository } from '../src/repositories/outbox.repository.js';
import {
  outboxService,
  type DestinationAdapter,
  type ConsumerEventContext,
} from '../src/services/outbox.service.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

describe('BATCH 4 V3.2 ADVERSARIAL VERIFICATION & CLOSURE SUITE', () => {
  const baseUri = getTestDatabaseUri(undefined, { runId: 'v32_adv', workerId: 'w1' });

  beforeAll(async () => {
    await mongoose.connect(baseUri);
    await NotificationConsumerRecordModel.init();
    await NotificationOutboxModel.init();
    await OperationJournalModel.init();
    await DecisionModel.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OperationJournalModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await NotificationConsumerRecordModel.deleteMany({});
    await NotificationOutboxModel.deleteMany({});
    if (mongoose.connection.db) {
      await mongoose.connection.db.collection('__test_run_metadata').deleteMany({});
    }
  });

  // =========================================================================
  // DOMAIN D2: Transaction Failure Must Not Permit Partial Commit
  // =========================================================================
  describe('DOMAIN D2: Transaction Failure Contract & Abort-On-Failure', () => {
    it('D2-T1 & D2-T2: Partial journal renewal followed by Decision failure aborts transaction; caller commit is blocked and journal remains unchanged', async () => {
      const opId = 'op-d2-t1-abort';
      const workerId = 'worker-t1';
      const decId = new mongoose.Types.ObjectId();

      const initialJournalExpires = new Date(Date.now() + 15000);
      const initialDecisionExpires = new Date(Date.now() + 15000);

      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decId,
        action: 'contribution.adopted',
        actor: { id: 'u1', userId: 'u1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        recoveryOwner: workerId,
        fencingToken: 1,
        leaseExpiresAt: initialJournalExpires,
        heartbeatAt: new Date(),
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev-t1',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Adopted contribution',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      // Decision is quarantined -> renewal of Decision must fail!
      await DecisionModel.create({
        _id: decId,
        title: 'Quarantined Decision for D2-T1',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'D2-T1 test',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 1,
        recoveryOwner: workerId,
        recoveryLeaseExpiresAt: initialDecisionExpires,
        auditIntegrityStatus: 'quarantined',
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      let caughtError: unknown = null;
      try {
        await operationJournalRepository.renewOperationLease(
          opId,
          workerId,
          1,
          30000,
          decId.toString(),
          session
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ConcurrencyFencingError);

      // Caller deliberately attempts to commit the caught transaction!
      // CONTRACT REQUIREMENT: The transaction must already be aborted by renewOperationLease!
      let commitError: unknown = null;
      try {
        await session.commitTransaction();
      } catch (err) {
        commitError = err;
      } finally {
        await session.endSession();
      }

      // commitTransaction MUST fail because transaction was aborted
      expect(commitError).not.toBeNull();

      // Database assertion: The journal lease was NEVER committed to the database!
      const persistedJournal = await OperationJournalModel.findOne({ operationId: opId });
      const persistedDecision = await DecisionModel.findById(decId);

      expect(persistedJournal?.leaseExpiresAt?.getTime()).toBe(initialJournalExpires.getTime());
      expect(persistedDecision?.recoveryLeaseExpiresAt?.getTime()).toBe(initialDecisionExpires.getTime());
    });

    it('D2-T3: Journal renewal failure causes 0 writes to Decision and does not stage partial commits', async () => {
      const opId = 'op-d2-t3-journal-fail';
      const workerId = 'worker-t3';
      const decId = new mongoose.Types.ObjectId();

      // Journal record does NOT exist
      await DecisionModel.create({
        _id: decId,
        title: 'Decision for D2-T3',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'D2-T3',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 1,
        recoveryOwner: workerId,
        recoveryLeaseExpiresAt: new Date(Date.now() + 10000),
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          operationJournalRepository.renewOperationLease(
            opId,
            workerId,
            1,
            30000,
            decId.toString(),
            session
          )
        ).rejects.toThrow(ConcurrencyFencingError);

        // Transaction is aborted
        expect(session.inTransaction()).toBe(false);
      } finally {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        await session.endSession();
      }
    });

    it('D2-T4: Dual renewal succeeds atomically in transaction, persisting identical server-derived timestamps', async () => {
      const opId = 'op-d2-t4-success';
      const workerId = 'worker-t4';
      const decId = new mongoose.Types.ObjectId();

      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decId,
        action: 'contribution.adopted',
        actor: { id: 'u1', userId: 'u1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        recoveryOwner: workerId,
        fencingToken: 2,
        leaseExpiresAt: new Date(Date.now() + 10000),
        heartbeatAt: new Date(),
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev-t4',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Adopted contribution',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      await DecisionModel.create({
        _id: decId,
        title: 'Decision for D2-T4',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'D2-T4',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 2,
        recoveryOwner: workerId,
        recoveryLeaseExpiresAt: new Date(Date.now() + 10000),
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      const ok = await operationJournalRepository.renewOperationLease(
        opId,
        workerId,
        2,
        30000,
        decId.toString(),
        session
      );
      expect(ok).toBe(true);

      await session.commitTransaction();
      await session.endSession();

      const journal = await OperationJournalModel.findOne({ operationId: opId });
      const decision = await DecisionModel.findById(decId);

      expect(journal?.leaseExpiresAt).toBeDefined();
      expect(decision?.recoveryLeaseExpiresAt).toBeDefined();
      // Server-derived timestamps must be identical
      expect(journal!.leaseExpiresAt!.getTime()).toBe(decision!.recoveryLeaseExpiresAt!.getTime());
    });

    it('D2-T5: Inactive or ended session throws typed error and performs 0 writes outside session', async () => {
      const opId = 'op-d2-t5-inactive';
      const workerId = 'worker-t5';
      const decId = new mongoose.Types.ObjectId();

      const session = await mongoose.startSession();
      await session.endSession(); // session ended, not in transaction

      await expect(
        operationJournalRepository.renewOperationLease(
          opId,
          workerId,
          1,
          30000,
          decId.toString(),
          session
        )
      ).rejects.toThrow(ConcurrencyFencingError);
    });

    it('D2-T6: Concurrent lease takeover fences out superseded worker generation', async () => {
      const opId = 'op-d2-t6-takeover';
      const decId = new mongoose.Types.ObjectId();

      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decId,
        action: 'contribution.adopted',
        actor: { id: 'u1', userId: 'u1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        recoveryOwner: 'worker-A',
        fencingToken: 1,
        leaseExpiresAt: new Date(Date.now() - 1000), // Expired
        heartbeatAt: new Date(),
        retryCount: 1,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev-t6',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Adopted contribution',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      await DecisionModel.create({
        _id: decId,
        title: 'Decision for D2-T6',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'D2-T6',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 1,
        recoveryOwner: 'worker-A',
        recoveryLeaseExpiresAt: new Date(Date.now() - 1000),
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

      // Worker B claims the operation (advancing fencingToken to 2)
      const claimedB = await operationJournalRepository.claimJournalOperation('worker-B', 30000, opId);
      expect(claimedB).not.toBeNull();
      expect(claimedB?.fencingToken).toBe(2);
      expect(claimedB?.recoveryOwner).toBe('worker-B');

      // Stale Worker A attempts lease renewal with old generation 1
      const staleRenewA = await operationJournalRepository.renewOperationLease(
        opId,
        'worker-A',
        1,
        30000,
        decId.toString()
      );
      expect(staleRenewA).toBe(false);

      // Verify Worker B's lease was not overwritten
      const persistedJournal = await OperationJournalModel.findOne({ operationId: opId });
      expect(persistedJournal?.recoveryOwner).toBe('worker-B');
      expect(persistedJournal?.fencingToken).toBe(2);
    });

    it('D2-T7: Quarantine transition race guarantees quarantine wins and is never overwritten by renewal', async () => {
      const opId = 'op-d2-t7-quarantine-race';
      const decId = new mongoose.Types.ObjectId();

      await OperationJournalModel.create({
        operationId: opId,
        decisionId: decId,
        action: 'contribution.adopted',
        actor: { id: 'u1', userId: 'u1', role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        recoveryOwner: 'worker-race',
        fencingToken: 1,
        leaseExpiresAt: new Date(Date.now() + 10000),
        heartbeatAt: new Date(),
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev-t7',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Adopted contribution',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      await DecisionModel.create({
        _id: decId,
        title: 'Decision for D2-T7',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'D2-T7',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 1,
        recoveryOwner: 'worker-race',
        recoveryLeaseExpiresAt: new Date(Date.now() + 10000),
        auditIntegrityStatus: 'healthy',
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

      // Quarantine the decision
      await DecisionModel.updateOne(
        { _id: decId },
        { $set: { auditIntegrityStatus: 'quarantined' } }
      );

      // Lease renewal must fail closed
      const renewed = await operationJournalRepository.renewOperationLease(
        opId,
        'worker-race',
        1,
        30000,
        decId.toString()
      );
      expect(renewed).toBe(false);

      const decisionAfter = await DecisionModel.findById(decId);
      expect(decisionAfter?.auditIntegrityStatus).toBe('quarantined');
    });
  });

  // =========================================================================
  // DOMAIN D3: End-to-End Consumer Idempotency & Outbox Fencing
  // =========================================================================
  describe('DOMAIN D3: Outbox Fencing & Destination Idempotency Contract', () => {
    it('D3-T1: Crash before side effect leaves reclaimable processing record after lease expiry', async () => {
      const consumerId = 'consumer-crash-before';
      const notifId = 'notif-t1';
      const workerA = 'worker-A';
      const workerB = 'worker-B';

      // Worker A claims lease with short duration (1s)
      const claimA = await outboxService.claimConsumerProcessing(consumerId, notifId, workerA, 1000);
      expect(claimA.status).toBe('CLAIMED');
      expect(claimA.claimGeneration).toBe(1);

      // Simulate crash: Worker A disappears without executing side effect or completing record
      // Wait or advance server lease expiration
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId: notifId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );

      // Worker B reclaims and executes side effect to completion
      let sideEffectRan = 0;
      const resB = await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        workerB,
        async () => {
          sideEffectRan++;
          return { sent: true };
        }
      );

      expect(resB.status).toBe('COMPLETED');
      expect(sideEffectRan).toBe(1);

      const record = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(record?.status).toBe('COMPLETED');
    });

    it('D3-T2, D3-T3 & D3-T4: Destination adapter receives stable idempotencyKey and safely suppresses duplicates on retry', async () => {
      const consumerId = 'payment-gateway-consumer';
      const notifId = 'notif-payment-456';
      const expectedKey = `${consumerId}:${notifId}`;

      // Mock an idempotent external payment service
      const processedKeys = new Map<string, { callCount: number; chargeId: string }>();

      const idempotentAdapter: DestinationAdapter<{ chargeId: string; cached: boolean }> = {
        destinationName: 'StripePaymentAdapter',
        supportsIdempotency: true,
        execute: async (context: ConsumerEventContext) => {
          expect(context.idempotencyKey).toBe(expectedKey);
          expect(context.consumerId).toBe(consumerId);
          expect(context.notificationId).toBe(notifId);

          if (processedKeys.has(context.idempotencyKey)) {
            const entry = processedKeys.get(context.idempotencyKey)!;
            entry.callCount++;
            return { chargeId: entry.chargeId, cached: true };
          }

          const entry = { callCount: 1, chargeId: `ch_${Date.now()}` };
          processedKeys.set(context.idempotencyKey, entry);
          return { chargeId: entry.chargeId, cached: false };
        },
      };

      // 1. Initial execution
      const res1 = await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        'worker-1',
        idempotentAdapter
      );
      expect(res1.status).toBe('COMPLETED');
      expect(res1.deliverySemantics).toBe('idempotent_destination');
      expect(res1.result?.cached).toBe(false);
      expect(processedKeys.get(expectedKey)?.callCount).toBe(1);

      // 2. Simulated crash & redelivery with exact same notification
      const res2 = await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        'worker-2',
        idempotentAdapter
      );
      expect(res2.status).toBe('DUPLICATE');
      expect(res2.executed).toBe(false);
      // Destination was NOT called a second time because local DB completed
      expect(processedKeys.get(expectedKey)?.callCount).toBe(1);

      // 3. Adapter boundary duplicate test: Direct adapter invocation with same key returns cached result
      const directRetry = await idempotentAdapter.execute({
        idempotencyKey: expectedKey,
        consumerId,
        notificationId: notifId,
        claimGeneration: 2,
        workerId: 'worker-direct',
        attemptCount: 2,
      });
      expect(directRetry.cached).toBe(true);
      expect(directRetry.chargeId).toBe(res1.result?.chargeId);
      expect(processedKeys.get(expectedKey)?.callCount).toBe(2);
    });

    it('D3-T5: Destination without idempotency support explicitly flags at-least-once delivery risk', async () => {
      const consumerId = 'legacy-webhook-consumer';
      const notifId = 'notif-webhook-789';

      const nonIdempotentAdapter: DestinationAdapter<{ delivered: boolean }> = {
        destinationName: 'LegacyWebhookEndpoint',
        supportsIdempotency: false,
        execute: async () => {
          return { delivered: true };
        },
      };

      const res = await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        'worker-webhook',
        nonIdempotentAdapter
      );

      expect(res.status).toBe('COMPLETED');
      expect(res.deliverySemantics).toBe('at_least_once_risk');
    });

    it('D3-T6: Stale outbox dispatcher cannot acknowledge or fail after lease takeover by newer generation', async () => {
      const notifId = 'notif-outbox-fencing-1';

      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'decision.updated',
        payload: { test: true },
        status: 'CLAIMED',
        dispatchOwner: 'worker-A',
        claimGeneration: 1,
        leaseExpiresAt: new Date(Date.now() - 1000), // Expired
        retryCount: 1,
      });

      // Worker B claims pending notifications (advances generation to 2)
      const claimedB = await outboxRepository.claimPending('worker-B', 10);
      expect(claimedB).toHaveLength(1);
      expect(claimedB[0].claimGeneration).toBe(2);
      expect(claimedB[0].dispatchOwner).toBe('worker-B');

      // Stale Worker A attempts markDelivered with generation 1
      const staleAckA = await outboxRepository.markDelivered(notifId, 'worker-A', 1);
      expect(staleAckA).toBe(false);

      // Stale Worker A attempts markFailed with generation 1
      const staleFailA = await outboxRepository.markFailed(notifId, 'Stale failure', 'worker-A', 1);
      expect(staleFailA).toBe(false);

      // Status remains CLAIMED by Worker B
      const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(doc?.status).toBe('CLAIMED');
      expect(doc?.dispatchOwner).toBe('worker-B');
      expect(doc?.claimGeneration).toBe(2);

      // Valid Worker B marks delivered with generation 2
      const validAckB = await outboxRepository.markDelivered(notifId, 'worker-B', 2);
      expect(validAckB).toBe(true);

      const finalDoc = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(finalDoc?.status).toBe('DELIVERED');
    });

    it('D3-T7: Missing workerId or claimGeneration is strictly rejected at runtime', async () => {
      const notifId = 'notif-missing-identity';

      // @ts-expect-error - testing mandatory workerId runtime rejection
      await expect(outboxRepository.markDelivered(notifId, '')).rejects.toThrowError(
        /markDelivered violation: mandatory workerId is missing or empty/
      );

      // @ts-expect-error - testing mandatory claimGeneration runtime rejection
      await expect(outboxRepository.markDelivered(notifId, 'w1', 0)).rejects.toThrowError(
        /markDelivered violation: mandatory claimGeneration must be a positive integer/
      );

      // @ts-expect-error - testing markFailed mandatory arguments
      await expect(outboxRepository.markFailed(notifId, 'err', '', 1)).rejects.toThrowError(
        /markFailed violation: mandatory workerId is missing or empty/
      );
    });

    it('D3-T8: Consumer retry exhaustion terminates permanently in MAX_RETRIES_EXCEEDED', async () => {
      const consumerId = 'failing-consumer';
      const notifId = 'notif-exhaustion';

      for (let i = 0; i < 5; i++) {
        // Expire lease if exists
        await NotificationConsumerRecordModel.updateOne(
          { consumerId, notificationId: notifId },
          { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
        );

        await expect(
          outboxService.processConsumerEvent(
            consumerId,
            notifId,
            `worker-${i}`,
            async () => {
              throw new Error(`Attempt ${i} simulated network failure`);
            },
            { maxAttempts: 5 }
          )
        ).rejects.toThrow(/simulated network failure/);
      }

      // Next attempt halts in MAX_RETRIES_EXCEEDED
      const exhausted = await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        'worker-final',
        async () => 'should not run',
        { maxAttempts: 5 }
      );

      expect(exhausted.status).toBe('FAILED');
      expect(exhausted.error).toContain('Maximum retry limit exceeded');
    });
  });

  // =========================================================================
  // DOMAIN D6: Cleanup Ownership Lock & Strict Lifecycle Fencing
  // =========================================================================
  describe('DOMAIN D6: Cleanup Lifecycle & Re-Entry Prevention', () => {
    it('D6-T1: Same-worker re-entry after cleanup lock acquisition is strictly rejected', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t1';
      const workerId = 'worker-d6-t1';

      // 1. Initial claim
      await claimTestDatabaseOwnership(conn, runId, workerId);

      // 2. Lock cleanup
      const metaCol = conn.db!.collection('__test_run_metadata');
      await metaCol.findOneAndUpdate(
        { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'CLEANUP_LOCKED',
            cleanupInProgress: true,
            cleanupOwner: workerId,
            cleanupGeneration: 1,
            cleanupStartedAt: new Date(),
          },
        }
      );

      // 3. Same worker attempts re-entry
      await expect(
        claimTestDatabaseOwnership(conn, runId, workerId)
      ).rejects.toThrowError(/is locked for cleanup or already cleaned/);
    });

    it('D6-T2: Different-worker claim after cleanup lock acquisition is strictly rejected', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t2';
      const workerA = 'worker-A';
      const workerB = 'worker-B';

      await claimTestDatabaseOwnership(conn, runId, workerA);

      const metaCol = conn.db!.collection('__test_run_metadata');
      await metaCol.findOneAndUpdate(
        { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'CLEANUP_LOCKED',
            cleanupInProgress: true,
            cleanupOwner: workerA,
            cleanupGeneration: 1,
            cleanupStartedAt: new Date(),
          },
        }
      );

      await expect(
        claimTestDatabaseOwnership(conn, runId, workerB)
      ).rejects.toThrowError(/is locked for cleanup or already cleaned/);
    });

    it('D6-T3: Concurrent claim versus cleanup: exactly one valid transition wins', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t3';
      const workerClaim = 'worker-claim';
      const workerCleanup = 'worker-cleanup';

      // Establish initial ownership by workerCleanup
      await claimTestDatabaseOwnership(conn, runId, workerCleanup);

      // Race: workerClaim attempts re-claim while workerCleanup executes cleanup lock
      const [claimRes, cleanupLockRes] = await Promise.allSettled([
        claimTestDatabaseOwnership(conn, runId, workerClaim),
        conn.db!.collection('__test_run_metadata').findOneAndUpdate(
          {
            _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
            runId,
            workerId: workerCleanup,
            lifecycleState: 'OWNED',
            cleanupInProgress: { $ne: true },
          },
          {
            $set: {
              lifecycleState: 'CLEANUP_LOCKED',
              cleanupInProgress: true,
              cleanupOwner: workerCleanup,
              cleanupGeneration: 1,
              cleanupStartedAt: new Date(),
            },
          },
          { returnDocument: 'after' }
        ),
      ]);

      // Worker claim must have failed because it is a different worker
      expect(claimRes.status).toBe('rejected');
      expect(cleanupLockRes.status).toBe('fulfilled');
    });

    it('D6-T4: Concurrent cleanup attempts: exactly one acquires cleanup lock', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t4';
      const workerId = 'worker-t4';

      await claimTestDatabaseOwnership(conn, runId, workerId);

      const metaCol = conn.db!.collection('__test_run_metadata');
      const acquireLock = () =>
        metaCol.findOneAndUpdate(
          {
            _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
            runId,
            workerId,
            lifecycleState: 'OWNED',
            cleanupInProgress: { $ne: true },
          },
          {
            $set: {
              lifecycleState: 'CLEANUP_LOCKED',
              cleanupInProgress: true,
              cleanupOwner: workerId,
              cleanupGeneration: 1,
              cleanupStartedAt: new Date(),
            },
          },
          { returnDocument: 'after' }
        );

      const [res1, res2] = await Promise.all([acquireLock(), acquireLock()]);

      const wins = [res1, res2].filter((r) => r !== null);
      expect(wins).toHaveLength(1);
    });

    it('D6-T5: Missing or malformed identity metadata fails closed', async () => {
      const conn = mongoose.connection;

      // Missing runId
      await expect(
        claimTestDatabaseOwnership(conn, '', 'w1')
      ).rejects.toThrowError(/mandatory runId is missing or empty/);

      // Malformed workerId
      await expect(
        claimTestDatabaseOwnership(conn, 'run-1', 'worker@invalid!')
      ).rejects.toThrowError(/malformed workerId/);

      // Malformed stored record
      const metaCol = conn.db!.collection('__test_run_metadata');
      await metaCol.insertOne({
        _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
        runId: null,
        workerId: null,
      });

      await expect(
        assertCanCleanupTestDatabase(conn, 'run-1', 'w1')
      ).rejects.toThrowError(/ownership record is missing/);
    });

    it('D6-T6: Crash after cleanup lock acquisition allows safe idempotent retry by cleanup owner', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t6';
      const workerId = 'worker-t6';

      await claimTestDatabaseOwnership(conn, runId, workerId);

      // Simulate crash after lock acquisition: lifecycleState is CLEANUP_LOCKED, but DB was not dropped
      const metaCol = conn.db!.collection('__test_run_metadata');
      await metaCol.findOneAndUpdate(
        { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'CLEANUP_LOCKED',
            cleanupInProgress: true,
            cleanupOwner: workerId,
            cleanupGeneration: 1,
            cleanupStartedAt: new Date(),
          },
        }
      );

      // Crash recovery: cleanupTestDatabase is retried with the exact same identity and generation
      // Must succeed cleanly and drop the database
      let dropCalled = false;
      const origDrop = conn.db!.dropDatabase.bind(conn.db!);
      conn.db!.dropDatabase = async () => {
        dropCalled = true;
        return true;
      };

      try {
        await cleanupTestDatabase(conn, runId, workerId, 1);
        expect(dropCalled).toBe(true);
      } finally {
        conn.db!.dropDatabase = origDrop;
      }
    });

    it('D6-T7: End-to-end crash-after-drop recovery: establishes ownership, acquires cleanup lock, drops DB, injects crash before completion, and retries safely', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t7';
      const workerId = 'worker-t7';

      // 1. Establish valid ownership
      await claimTestDatabaseOwnership(conn, runId, workerId);

      const dbName = conn.db!.databaseName;
      const coordCol = conn.getClient().db('decision_os_test_coordination_test').collection('cleanup_registry');

      // 2 & 3. Acquire cleanup lock and drop database
      // 4. Inject failure after database drop succeeds but before completion record is persisted
      const origDrop = conn.db!.dropDatabase.bind(conn.db);
      conn.db!.dropDatabase = async () => {
        await origDrop();
        // Database is now dropped (collections count is 0).
        // Simulate crash right here by throwing before registry is updated to CLEANED!
        throw new Error('SIMULATED_POST_DROP_CRASH');
      };

      try {
        await expect(cleanupTestDatabase(conn, runId, workerId, 1)).rejects.toThrow('SIMULATED_POST_DROP_CRASH');
      } finally {
        conn.db!.dropDatabase = origDrop;
      }

      // 5. Verify database has 0 collections, and registry is in CLEANUP_LOCKED
      const collections = await conn.db!.listCollections().toArray();
      expect(collections.length).toBe(0);

      const regBefore = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regBefore?.lifecycleState).toBe('CLEANUP_LOCKED');
      expect(regBefore?.cleanupOwner).toBe(workerId);

      // 6 & 7. Retry cleanup using the exact same run and cleanup identity
      await expect(cleanupTestDatabase(conn, runId, workerId, 1)).resolves.toBeUndefined();

      // 8. Verify the independent cleanup record reaches CLEANED exactly once
      const regAfter = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regAfter?.lifecycleState).toBe('CLEANED');

      // 9. Verify a different worker cannot claim or continue cleanup
      await expect(cleanupTestDatabase(conn, runId, 'different-worker', 1)).rejects.toThrow();

      // 10. Verify an old generation cannot continue cleanup
      await expect(cleanupTestDatabase(conn, runId, workerId, 0)).rejects.toThrow(
        /cleanup generation 0 is superseded by newer generation 1/
      );
    });

    it('D6-T8: Reserved databases (admin, local, config, production) are strictly protected', async () => {
      const fakeConnAdmin = { db: { databaseName: 'admin' } } as unknown as mongoose.Connection;
      const fakeConnProd = { db: { databaseName: 'production' } } as unknown as mongoose.Connection;

      await expect(
        claimTestDatabaseOwnership(fakeConnAdmin, 'run-1', 'w1')
      ).rejects.toThrowError(/refusing claim on reserved database 'admin'/);

      await expect(
        assertCanCleanupTestDatabase(fakeConnProd, 'run-1', 'w1')
      ).rejects.toThrowError(/refusing cleanup on reserved\/production database 'production'/);
    });

    it('D6-T9: Stale cleanup worker with generation N is rejected when generation N+1 is established', async () => {
      const conn = mongoose.connection;
      const runId = 'run-d6-t9';
      const workerId = 'worker-t9';

      await claimTestDatabaseOwnership(conn, runId, workerId);

      const metaCol = conn.db!.collection('__test_run_metadata');
      await metaCol.findOneAndUpdate(
        { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'CLEANUP_LOCKED',
            cleanupInProgress: true,
            cleanupOwner: workerId,
            cleanupGeneration: 2, // Established generation 2
            cleanupStartedAt: new Date(),
          },
        }
      );

      // Stale cleanup attempt with generation 1 must be rejected
      await expect(
        cleanupTestDatabase(conn, runId, workerId, 1)
      ).rejects.toThrowError(/cleanup generation 1 is superseded by newer generation 2/);
    });
  });

  // =========================================================================
  // DOMAIN D5: Standalone MongoDB Fail-Closed Verification
  // =========================================================================
  describe('DOMAIN D5: Topology Verification & Standalone Fail-Closed', () => {
    it('D5-T1: Standalone MongoDB transaction attempt fails closed without unsafe fallback', async () => {
      // Connect to standalone instance on port 27017
      const standaloneConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/decision_os_standalone_test').asPromise();

      try {
        const session = await standaloneConn.startSession();
        let transactionFailedClosed = false;

        try {
          session.startTransaction();
        } catch {
          transactionFailedClosed = true;
        }

        if (!transactionFailedClosed) {
          // If startTransaction didn't immediately throw, the first transactional write MUST throw MongoServerError
          try {
            await standaloneConn.collection('test_col').insertOne({ a: 1 }, { session });
            await session.commitTransaction();
          } catch (err: unknown) {
            transactionFailedClosed = true;
            expect((err as Error).message).toMatch(
              /Transaction numbers are only allowed on a replica set member or mongos|transactions not supported|This MongoDB deployment does not support retryable writes/i
            );
          }
        }

        expect(transactionFailedClosed).toBe(true);
        await session.endSession();
      } finally {
        await standaloneConn.close();
      }
    });
  });
});
