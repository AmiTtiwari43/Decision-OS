import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { getTestDatabaseUri } from '../src/db/guard.js';
import {
  DecisionModel,
  OperationJournalModel,
  NotificationConsumerRecordModel,
  NotificationOutboxModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { outboxRepository } from '../src/repositories/outbox.repository.js';
import { outboxService } from '../src/services/outbox.service.js';
import {
  claimTestDatabaseOwnership,
} from '../src/db/guard.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

describe('BATCH 4 V3.2 DEFECT REPRODUCTION SUITE', () => {
  const baseUri = getTestDatabaseUri(undefined, { runId: 'v32_repro', workerId: 'w1' });

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

  describe('DEFECT D2 REPRODUCTION: Partial commit when caller catches ConcurrencyFencingError', () => {
    it('REPRO D2-1: Caller catches renewal error and commits transaction, persisting partial journal renewal', async () => {
      const opId = 'op-d2-repro-partial';
      const workerId = 'worker-repro-d2';
      const decId = new mongoose.Types.ObjectId();

      const initialJournalExpires = new Date(Date.now() + 10000);
      const initialDecisionExpires = new Date(Date.now() + 10000);

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
          eventId: 'ev-repro',
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

      // Decision is quarantined, so DecisionModel.updateOne will match 0 documents!
      await DecisionModel.create({
        _id: decId,
        title: 'Quarantined Decision for D2 Repro',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'D2 repro',
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

      // Verify that ConcurrencyFencingError was indeed thrown
      expect(caughtError).toBeInstanceOf(ConcurrencyFencingError);

      // IN DEFECTIVE V3.1 CODE:
      // renewOperationLease did NOT abort the transaction!
      // Caller can call commitTransaction() and MongoDB will persist the staged journal update!
      let commitSucceeded = false;
      try {
        await session.commitTransaction();
        commitSucceeded = true;
      } catch {
        commitSucceeded = false;
      } finally {
        await session.endSession();
      }

      // Check database state
      const persistedJournal = await OperationJournalModel.findOne({ operationId: opId });
      const persistedDecision = await DecisionModel.findById(decId);

      console.log('REPRO D2-1 Result:', {
        commitSucceeded,
        journalPersistedExpires: persistedJournal?.leaseExpiresAt?.getTime(),
        initialJournalExpires: initialJournalExpires.getTime(),
        decisionExpires: persistedDecision?.recoveryLeaseExpiresAt?.getTime(),
      });

      // V3.2 VERIFICATION:
      // renewOperationLease aborted the transaction on failure.
      // Caller calling commitTransaction() must fail, and no partial journal renewal is persisted!
      expect(commitSucceeded).toBe(false);
      expect(persistedJournal!.leaseExpiresAt!.getTime()).toBe(initialJournalExpires.getTime());
      expect(persistedDecision!.recoveryLeaseExpiresAt!.getTime()).toBe(initialDecisionExpires.getTime());
    });
  });

  describe('DEFECT D3 REPRODUCTION: Permissive outbox acknowledgement and unsafe deduplication', () => {
    it('REPRO D3-1: Permissive markDelivered without workerId or claimGeneration is strictly rejected', async () => {
      const notifId = 'notif-repro-permissive-1';
      const workerA = 'worker-A';

      // Worker A claims the notification
      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'decision.updated',
        payload: { test: true },
        status: 'CLAIMED',
        dispatchOwner: workerA,
        claimGeneration: 1,
        leaseExpiresAt: new Date(Date.now() + 30000),
        retryCount: 1,
      });

      // Calling markDelivered without workerId or claimGeneration is strictly rejected!
      // @ts-expect-error - testing permissive signature rejection
      await expect(outboxRepository.markDelivered(notifId)).rejects.toThrowError(
        /markDelivered violation: mandatory workerId is missing or empty/
      );
    });

    it('REPRO D3-2: Unsafe deduplicateConsumerEvent without explicit worker identity is strictly rejected', async () => {
      const consumerId = 'consumer-repro-legacy';
      const notifId = 'notif-legacy-worker';

      // Calling deduplicateConsumerEvent without worker identity is rejected!
      // @ts-expect-error - testing unsafe legacy invocation rejection
      await expect(outboxService.deduplicateConsumerEvent(consumerId, notifId, async () => {
        return { success: true };
      })).rejects.toThrowError(
        /Unsafe legacy deduplicateConsumerEvent invocation without side-effect execution is removed/
      );
    });
  });

  describe('DEFECT D6 REPRODUCTION: Same-worker re-entry after cleanup lock acquisition', () => {
    it('REPRO D6-1: claimTestDatabaseOwnership strictly blocks same-worker re-entry after cleanup lock is active', async () => {
      const conn = mongoose.connection;
      const db = conn.db;
      expect(db).toBeDefined();

      const runId = 'run-d6-repro';
      const workerId = 'worker-d6';

      // 1. Initial claim
      await claimTestDatabaseOwnership(conn, runId, workerId);

      // Verify ownership record exists
      const metaCol = db!.collection('__test_run_metadata');
      const lockBefore = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });
      expect(lockBefore).not.toBeNull();
      expect(lockBefore?.runId).toBe(runId);
      expect(lockBefore?.workerId).toBe(workerId);

      // 2. Cleanup starts and acquires cleanup lock
      const acquiredLock = await metaCol.findOneAndUpdate(
        {
          _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
          runId,
          workerId,
          cleanupInProgress: { $ne: true },
        },
        {
          $set: {
            cleanupInProgress: true,
            cleanupOwner: workerId,
            cleanupStartedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );
      expect(acquiredLock).not.toBeNull();
      expect(acquiredLock?.cleanupInProgress).toBe(true);

      // 3. Same worker calls claimTestDatabaseOwnership again
      // V3.2 VERIFICATION: Must throw re-entry prohibited error!
      await expect(
        claimTestDatabaseOwnership(conn, runId, workerId)
      ).rejects.toThrowError(/is locked for cleanup or already cleaned.*Re-entry prohibited/);
    });
  });
});
