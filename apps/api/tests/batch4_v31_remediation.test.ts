import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { getTestDatabaseUri } from '../src/db/guard.js';
import {
  OperationJournalModel,
  DecisionModel,
  NotificationConsumerRecordModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { outboxService } from '../src/services/outbox.service.js';
import {
  claimTestDatabaseOwnership,
  assertCanCleanupTestDatabase,
  cleanupTestDatabase,
} from '../src/db/guard.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

describe('BATCH 4 V3.1 COMPREHENSIVE ADVERSARIAL REMEDIATION SUITE', () => {
  const baseUri = getTestDatabaseUri(undefined, { runId: 'v31_rem', workerId: 'w1' });

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

  describe('PHASE B: D2 Database-Time Leases & Fencing Protocols', () => {
    it('B1: Claim uses server-derived time ($$NOW + duration) regardless of application clock skew', async () => {
      const opId = 'op-d2-server-time-claim';
      const workerId = 'worker-server-time';
      const decId = new mongoose.Types.ObjectId();

      await DecisionModel.create({
        _id: decId,
        title: 'Server Time Decision',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'Server time claim',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
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
        fencingToken: 0,
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
          summary: 'Claim test',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      // Intentionally skew application clock by +2 hours
      const realNow = Date.now;
      Date.now = () => realNow() + 7200000;

      try {
        const claimed = await operationJournalRepository.claimJournalOperation(workerId, 30000, opId);
        expect(claimed).not.toBeNull();

        const storedJournal = await OperationJournalModel.findOne({ operationId: opId });
        expect(storedJournal).not.toBeNull();

        // In V3.1: heartbeatAt and leaseExpiresAt are derived entirely by MongoDB server via $$NOW
        const diffMs = storedJournal!.leaseExpiresAt!.getTime() - storedJournal!.heartbeatAt!.getTime();
        expect(diffMs).toBe(30000);

        // Verify Decision also carries the exact same server-derived expiry down to the millisecond
        const storedDecision = await DecisionModel.findById(decId);
        expect(storedDecision?.recoveryLeaseExpiresAt?.getTime()).toBe(storedJournal!.leaseExpiresAt!.getTime());
        expect(storedDecision?.recoveryOwner).toBe(workerId);
        expect(storedDecision?.recoveryFencingToken).toBe(claimed!.fencingToken);
      } finally {
        Date.now = realNow;
      }
    });

    it('B2: Renewal uses server-derived time ($$NOW + duration) and rejects expired journal lease', async () => {
      const opId = 'op-d2-expired-journal';
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
        // Expired in past according to MongoDB server time
        leaseExpiresAt: new Date(Date.now() - 10000),
        heartbeatAt: new Date(Date.now() - 40000),
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
          summary: 'Expired renewal test',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      // An expired lease must NEVER be renewed
      const renewed = await operationJournalRepository.renewOperationLease(opId, workerId, 1, 30000);
      expect(renewed).toBe(false);
    });

    it('B3: Renewal strictly fails closed when Decision is quarantined', async () => {
      const opId = 'op-d2-quarantined';
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
          eventId: 'ev3',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Quarantine renewal test',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      await DecisionModel.create({
        _id: decId,
        title: 'Quarantined Decision',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'Quarantined',
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

      const renewed = await operationJournalRepository.renewOperationLease(
        opId,
        workerId,
        1,
        30000,
        decId.toString()
      );
      expect(renewed).toBe(false);
    });

    it('B4: Caller-supplied session throws ConcurrencyFencingError on renewal failure, guaranteeing transaction abort', async () => {
      const opId = 'op-d2-tx-contract';
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
          eventId: 'ev4',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Tx contract test',
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
        description: 'Quarantined',
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
        // Critical transaction contract: Must THROW ConcurrencyFencingError, preventing caller from committing partial renewal!
        await expect(
          operationJournalRepository.renewOperationLease(
            opId,
            workerId,
            1,
            30000,
            decId.toString(),
            session
          )
        ).rejects.toThrowError(ConcurrencyFencingError);
      } finally {
        await session.abortTransaction();
        await session.endSession();
      }
    });

    it('B5: Stale worker loses lease to Worker B (higher generation); Worker A cannot transition journal state', async () => {
      const opId = 'op-d2-stale-transition';
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
        leaseExpiresAt: new Date(Date.now() + 30000),
        heartbeatAt: new Date(),
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev5',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Stale transition test',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      // Worker B takes over with fencingToken 2
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { recoveryOwner: 'worker-B', fencingToken: 2 } }
      );

      // Stale Worker A attempts state transition with token 1 -> MUST throw ConcurrencyFencingError
      await expect(
        operationJournalRepository.transitionJournalState(
          opId,
          'worker-A',
          1,
          'PENDING',
          'DECISION_MUTATED'
        )
      ).rejects.toThrowError(ConcurrencyFencingError);
    });

    it('B6: Concurrent claim race resolves with exactly one winner', async () => {
      const opId = 'op-d2-claim-race';
      const decId = new mongoose.Types.ObjectId();

      await DecisionModel.create({
        _id: decId,
        title: 'Claim Race Decision',
        decisionModelVersion: '1.0.0',
        decisionType: 'single_choice',
        description: 'Claim race',
        status: 'draft',
        ownerId: new mongoose.Types.ObjectId(),
        collaborators: [],
        version: 1,
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
        fencingToken: 0,
        retryCount: 0,
        payload: {},
        previousSnapshot: {},
        auditDraft: {
          eventId: 'ev6',
          decisionId: decId.toString(),
          timestamp: new Date(),
          sequenceNumber: 1,
          eventType: 'contribution.adopted',
          entityType: 'decision',
          entityId: decId.toString(),
          summary: 'Claim race test',
          actor: { id: 'u1', userId: 'u1', role: 'owner' },
          payload: {},
          previousEventHash: '0',
          eventHash: 'hash',
        },
      });

      // 5 workers race concurrently
      const claims = await Promise.all([
        operationJournalRepository.claimJournalOperation('worker-1', 30000, opId),
        operationJournalRepository.claimJournalOperation('worker-2', 30000, opId),
        operationJournalRepository.claimJournalOperation('worker-3', 30000, opId),
        operationJournalRepository.claimJournalOperation('worker-4', 30000, opId),
        operationJournalRepository.claimJournalOperation('worker-5', 30000, opId),
      ]);

      const winners = claims.filter((c) => c !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.fencingToken).toBe(1);
    });
  });

  describe('PHASE C: D3 Durable Consumer Processing & Idempotency', () => {
    it('C1: Calling deduplicateConsumerEvent without sideEffectFn is strictly rejected', async () => {
      await expect(
        // @ts-expect-error testing legacy invocation without sideEffectFn
        outboxService.deduplicateConsumerEvent('consumer-1', 'notif-1')
      ).rejects.toThrowError(/Unsafe legacy deduplicateConsumerEvent invocation without side-effect execution is removed/);
    });

    it('C2: Crash before side effect allows safe retry after lease expiration without side effect drop', async () => {
      const consumerId = 'billing-service';
      const notificationId = 'notif-crash-recovery';
      let sideEffectInvocations = 0;

      // Worker 1 claims lease with 2-second duration, but "crashes" before completing side effect
      const claim1 = await outboxService.claimConsumerProcessing(consumerId, notificationId, 'worker-1', 2000);
      expect(claim1.status).toBe('CLAIMED');
      expect(sideEffectInvocations).toBe(0);

      // Attempting immediate claim by Worker 2 while lease is active returns LOCKED
      const claim2Locked = await outboxService.claimConsumerProcessing(consumerId, notificationId, 'worker-2', 2000);
      expect(claim2Locked.status).toBe('LOCKED');

      // Deterministically backdate lease in DB to simulate lease expiration
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // Worker 2 takes over expired lease and executes side effect to completion
      const result = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        'worker-2',
        async (idempotencyKey) => {
          expect(idempotencyKey).toBe(`${consumerId}:${notificationId}`);
          sideEffectInvocations++;
          return { invoiceId: 'inv-123' };
        }
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.executed).toBe(true);
      expect(sideEffectInvocations).toBe(1); // Successfully executed exactly once!
    });

    it('C3: Duplicate delivery after completion returns DUPLICATE and executes 0 side effects', async () => {
      const consumerId = 'email-service';
      const notificationId = 'notif-dedup';
      let sideEffectCalls = 0;

      const run = () =>
        outboxService.processConsumerEvent(consumerId, notificationId, 'worker-1', async () => {
          sideEffectCalls++;
          return 'sent';
        });

      const first = await run();
      expect(first.status).toBe('COMPLETED');
      expect(sideEffectCalls).toBe(1);

      const second = await run();
      expect(second.status).toBe('DUPLICATE');
      expect(second.executed).toBe(false);
      expect(sideEffectCalls).toBe(1); // Not called again!
    });

    it('C4: Two concurrent workers racing on same notification: exactly 1 wins claim, other gets LOCKED', async () => {
      const consumerId = 'webhook-fanout';
      const notificationId = 'notif-race';

      const [resA, resB] = await Promise.all([
        outboxService.claimConsumerProcessing(consumerId, notificationId, 'worker-A', 30000),
        outboxService.claimConsumerProcessing(consumerId, notificationId, 'worker-B', 30000),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain('CLAIMED');
      expect(statuses).toContain('LOCKED');
    });

    it('C5: Stale consumer completion rejected after lease takeover by newer worker generation', async () => {
      const consumerId = 'crm-sync';
      const notificationId = 'notif-takeover';

      // Worker A claims generation 1
      const claimA = await outboxService.claimConsumerProcessing(consumerId, notificationId, 'worker-A', 1000);
      expect(claimA.status).toBe('CLAIMED');
      expect(claimA.claimGeneration).toBe(1);

      // Expire Worker A's lease
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // Worker B reclaims with generation 2
      const claimB = await outboxService.claimConsumerProcessing(consumerId, notificationId, 'worker-B', 30000);
      expect(claimB.status).toBe('CLAIMED');
      expect(claimB.claimGeneration).toBe(2);

      // Worker A awakens and attempts to complete generation 1 -> REJECTED
      const staleCompleted = await outboxService.completeConsumerProcessing(
        consumerId,
        notificationId,
        'worker-A',
        1
      );
      expect(staleCompleted).toBe(false);

      // Worker B completes generation 2 -> SUCCEEDS
      const validCompleted = await outboxService.completeConsumerProcessing(
        consumerId,
        notificationId,
        'worker-B',
        2
      );
      expect(validCompleted).toBe(true);
    });

    it('C6: Reaches maximum retry limit and permanently halts in MAX_RETRIES_EXCEEDED', async () => {
      const consumerId = 'unstable-webhook';
      const notificationId = 'notif-poison';

      // 3 attempts fail
      for (let i = 0; i < 3; i++) {
        await expect(
          outboxService.processConsumerEvent(
            consumerId,
            notificationId,
            `worker-${i}`,
            async () => {
              throw new Error('Connection refused by downstream webhook');
            },
            { leaseDurationMs: 30000, maxAttempts: 3 }
          )
        ).rejects.toThrow('Connection refused by downstream webhook');
      }

      // 4th attempt: maxAttempts exceeded! Returns FAILED with MAX_RETRIES_EXCEEDED
      const exhausted = await outboxService.processConsumerEvent(
        consumerId,
        notificationId,
        'worker-retry',
        async () => 'never called',
        { leaseDurationMs: 30000, maxAttempts: 3 }
      );

      expect(exhausted.status).toBe('FAILED');
      expect(exhausted.error).toContain('Maximum retry limit exceeded');
      expect(exhausted.executed).toBe(false);
    });

    it('C7: Destination idempotency key remains stable across all attempts and retries', async () => {
      const consumerId = 'stripe-billing';
      const notificationId = 'notif-stable-key';
      const recordedKeys: string[] = [];

      try {
        await outboxService.processConsumerEvent(consumerId, notificationId, 'worker-1', async (key) => {
          recordedKeys.push(key);
          throw new Error('Transient 503');
        });
      } catch {
        // Expected transient failure
      }

      // Retry
      await outboxService.processConsumerEvent(consumerId, notificationId, 'worker-2', async (key) => {
        recordedKeys.push(key);
        return 'success';
      });

      expect(recordedKeys).toHaveLength(2);
      expect(recordedKeys[0]).toBe(`${consumerId}:${notificationId}`);
      expect(recordedKeys[1]).toBe(`${consumerId}:${notificationId}`);
      expect(recordedKeys[0]).toBe(recordedKeys[1]); // Completely stable key across attempts!
    });
  });

  describe('PHASE D: D6 Mandatory Identity & Safe Test Cleanup', () => {
    it('D1: Missing or empty runId or workerId is strictly rejected in all guard methods', async () => {
      // @ts-expect-error missing workerId
      await expect(claimTestDatabaseOwnership(mongoose.connection, 'run-1')).rejects.toThrowError(
        /mandatory workerId is missing or empty/
      );

      // @ts-expect-error missing workerId
      await expect(assertCanCleanupTestDatabase(mongoose.connection, 'run-1')).rejects.toThrowError(
        /mandatory workerId is missing or empty/
      );

      // @ts-expect-error missing workerId
      await expect(cleanupTestDatabase(mongoose.connection, 'run-1')).rejects.toThrowError(
        /mandatory workerId is missing or empty/
      );

      // Empty / whitespace
      await expect(claimTestDatabaseOwnership(mongoose.connection, '   ', 'w1')).rejects.toThrowError(
        /mandatory runId is missing or empty/
      );
      await expect(claimTestDatabaseOwnership(mongoose.connection, 'run-1', '   ')).rejects.toThrowError(
        /mandatory workerId is missing or empty/
      );

      // Malformed characters
      await expect(claimTestDatabaseOwnership(mongoose.connection, 'run$invalid', 'w1')).rejects.toThrowError(
        /malformed runId/
      );
    });

    it('D2: Missing stored workerId in DB ownership lock blocks cleanup', async () => {
      const metaCol = mongoose.connection.db!.collection('__test_run_metadata');
      await metaCol.insertOne({
        _id: 'ownership_lock' as any,
        runId: 'valid-run',
        // workerId is missing!
        claimedAt: new Date(),
      });

      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'valid-run', 'w1')
      ).rejects.toThrowError(/ownership record is missing workerId\. Refusing cleanup\./);
    });

    it('D3: Mismatched workerId or runId blocks cleanup', async () => {
      await claimTestDatabaseOwnership(mongoose.connection, 'run-alpha', 'worker-1');

      // Same run, wrong worker
      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'run-alpha', 'worker-2')
      ).rejects.toThrowError(/is owned by worker 'worker-1' \(expected 'worker-2'\)/);

      // Wrong run, same worker
      await expect(
        assertCanCleanupTestDatabase(mongoose.connection, 'run-beta', 'worker-1')
      ).rejects.toThrowError(/is owned by run 'run-alpha' \(expected 'run-beta'\)/);
    });

    it('D4: Reserved database names are strictly refused from claim and cleanup', async () => {
      const reservedNames = ['production', 'admin', 'local', 'config'];

      for (const name of reservedNames) {
        const fakeConn = {
          db: {
            databaseName: name,
            collection: () => ({ insertOne: async () => {}, findOne: async () => null }),
          },
        } as unknown as mongoose.Connection;

        await expect(claimTestDatabaseOwnership(fakeConn, 'run-1', 'w1')).rejects.toThrowError(
          /refusing claim on reserved database/
        );
        await expect(assertCanCleanupTestDatabase(fakeConn, 'run-1', 'w1')).rejects.toThrowError(
          /refusing cleanup on reserved\/production database/
        );
      }
    });

    it('D5: Atomic cleanup lock prevents concurrent cleanup race', async () => {
      await claimTestDatabaseOwnership(mongoose.connection, 'run-cleanup-race', 'w1');

      const metaCol = mongoose.connection.db!.collection('__test_run_metadata');

      // Worker 1 acquires cleanup lock
      const lockRes = await metaCol.findOneAndUpdate(
        {
          _id: 'ownership_lock' as any,
          runId: 'run-cleanup-race',
          workerId: 'w1',
          cleanupInProgress: { $ne: true },
        },
        { $set: { cleanupInProgress: true, cleanupOwner: 'w1' } },
        { returnDocument: 'after' }
      );
      expect(lockRes).not.toBeNull();

      // Competing cleanup attempt fails because cleanupInProgress is already true
      await expect(
        cleanupTestDatabase(mongoose.connection, 'run-cleanup-race', 'w1')
      ).rejects.toThrowError(/cleanup lock acquisition failed \(already in progress or ownership lost\)/);
    });
  });
});
