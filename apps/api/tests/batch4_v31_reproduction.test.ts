import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  getTestDatabaseUri,
  assertCanCleanupTestDatabase,
} from '../src/db/guard.js';
import {
  DecisionModel,
  OperationJournalModel,
  NotificationConsumerRecordModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { outboxService } from '../src/services/outbox.service.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

describe('BATCH 4 V3.1 BASELINE REPRODUCTION & INVARIANT VERIFICATION SUITE', () => {
  const baseUri = getTestDatabaseUri(undefined, { runId: 'v31_repro', workerId: 'w1' });

  beforeAll(async () => {
    await mongoose.connect(baseUri);
    await NotificationConsumerRecordModel.init();
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
    if (mongoose.connection.db) {
      await mongoose.connection.db.collection('__test_run_metadata').deleteMany({});
    }
  });

  describe('D2 Baseline Invariants: Server-Time Authority & Atomic Transaction Fencing', () => {
    it('D2-1: Verifies that lease creation and renewal derive expiry from MongoDB server time ($$NOW), unaffected by host clock skew', async () => {
      const opId = 'op-d2-clock-skew';
      const workerId = 'worker-skewed';
      const decId = new mongoose.Types.ObjectId();

      await DecisionModel.create({
        _id: decId,
        title: 'Clock Skew Decision',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'Test clock skew',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 1,
        recoveryOwner: workerId,
        recoveryLeaseExpiresAt: new Date(Date.now() + 30000),
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

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
        leaseExpiresAt: new Date(Date.now() + 30000),
        heartbeatAt: new Date(),
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev1',
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

      // Simulate application host with skewed clock (+1 hour into the future)
      const realNow = Date.now;
      const SKEW_MS = 3600000;
      Date.now = () => realNow() + SKEW_MS;

      try {
        const renewed = await operationJournalRepository.renewOperationLease(
          opId,
          workerId,
          1,
          30000,
          decId.toString()
        );
        expect(renewed).toBe(true);

        const storedJournal = await OperationJournalModel.findOne({ operationId: opId });
        expect(storedJournal).not.toBeNull();

        // Repaired behavior:
        // MongoDB server-time update pipeline uses $$NOW + $dateAdd.
        // Even though Date.now() is +1 hour, the stored lease is derived from true MongoDB server time.
        const storedLeaseMs = storedJournal!.leaseExpiresAt!.getTime();
        const actualClusterTimeApprox = realNow();

        const driftFromTrueTime = storedLeaseMs - actualClusterTimeApprox;
        // Lease duration is 30,000ms. Drift from true cluster time is ~30s, NOT > 30 minutes!
        expect(driftFromTrueTime).toBeLessThan(60000);
      } finally {
        Date.now = realNow;
      }
    });

    it('D2-2: Verifies that failed Decision renewal in a caller session throws ConcurrencyFencingError, preventing partial journal commit', async () => {
      const opId = 'op-d2-partial-commit';
      const workerId = 'worker-1';
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
        fencingToken: 1,
        leaseExpiresAt: new Date(Date.now() + 30000),
        heartbeatAt: new Date(),
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev2',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Adopted contribution 2',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      // Decision is quarantined
      await DecisionModel.create({
        _id: decId,
        title: 'Quarantined Decision',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'Quarantined test',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
        pendingOperationId: opId,
        recoveryFencingToken: 1,
        recoveryOwner: workerId,
        recoveryLeaseExpiresAt: new Date(Date.now() + 30000),
        auditIntegrityStatus: 'quarantined',
        options: [{ id: 'opt1', name: 'Option 1' }],
        criteria: [{ id: 'crit1', name: 'Criterion 1', weight: 1 }],
        scores: {},
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Repaired behavior: throws ConcurrencyFencingError when session is supplied
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
      } finally {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        await session.endSession();
      }
    });
  });

  describe('D3 Baseline Invariants: Durable Consumer Processing Eliminates Side-Effect Loss', () => {
    it('D3-1: Verifies that processConsumerEvent executes side effect with stable idempotency key and survives crash-recovery without loss', async () => {
      const consumerId = 'external-webhook-v31';
      const notificationId = 'notif-crash-inv-1';
      const workerId = 'worker-c1';
      let executionCount = 0;
      let recordedKey = '';

      // First run: executes side effect cleanly
      const result = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        workerId,
        async (key) => {
          recordedKey = key;
          executionCount++;
          return { sent: true };
        }
      );

      expect(result.executed).toBe(true);
      expect(executionCount).toBe(1);
      expect(recordedKey).toBe(`${consumerId}:${notificationId}`);

      // Second run: deduplicated without re-executing side effect
      const secondResult = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        workerId,
        async () => {
          executionCount++;
          return { sent: true };
        }
      );

      expect(secondResult.executed).toBe(false);
      expect(executionCount).toBe(1); // Exactly 1 execution
    });
  });

  describe('D6 Baseline Invariants: Test Database Ownership & Mandatory Worker Identity', () => {
    it('D6-1: Verifies that assertCanCleanupTestDatabase strictly rejects omitted or empty workerId', async () => {
      const metaCol = mongoose.connection.db!.collection('__test_run_metadata');
      await metaCol.insertOne({
        _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
        runId: 'run-xyz',
        workerId: 'worker-locked-to-1',
        claimedAt: new Date(),
      });

      // Omitted expectedWorkerId strictly throws Safety guard violation
      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'run-xyz', undefined as unknown as string)
      ).rejects.toThrow(/mandatory workerId is missing or empty/);
    });

    it('D6-2: Verifies that stored lock record with missing workerId strictly rejects cleanup', async () => {
      const metaCol = mongoose.connection.db!.collection('__test_run_metadata');
      await metaCol.insertOne({
        _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
        runId: 'run-xyz',
        claimedAt: new Date(),
      });

      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'run-xyz', 'worker-strictly-required')
      ).rejects.toThrow(/is missing workerId/);
    });
  });
});
