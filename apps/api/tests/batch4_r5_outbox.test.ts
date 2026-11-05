import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {
  connectToDatabase,
  disconnectFromDatabase,
  runInTransaction,
  assertReplicaSetSupported,
} from '../src/db/connection.js';
import { getTestDatabaseUri, assertTestDatabase } from '../src/db/guard.js';
import {
  DecisionModel,
  NotificationOutboxModel,
  NotificationConsumerRecordModel,
} from '../src/models/index.js';
import { outboxRepository } from '../src/repositories/outbox.repository.js';
import { outboxService } from '../src/services/outbox.service.js';

const TEST_MONGODB_URI = getTestDatabaseUri();
assertTestDatabase(TEST_MONGODB_URI);

const ownerId = new mongoose.Types.ObjectId().toString();

describe('Batch 4 Phase 5 — Durable Notification Outbox & Consumer Deduplication', () => {
  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    assertReplicaSetSupported();
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
    await NotificationOutboxModel.deleteMany({});
    await NotificationConsumerRecordModel.deleteMany({});
  });

  async function createTestDecision() {
    return DecisionModel.create({
      title: 'Outbox Test Decision',
      ownerId,
      criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1, direction: 'benefit' }],
      options: [{ id: 'o1', name: 'Option 1' }],
      scores: { o1: { c1: 50 } },
      version: 1,
      auditIntegrityStatus: 'healthy',
    });
  }

  it('1-6. Dispatcher A stale ack is rejected after Dispatcher B takeover and delivery', async () => {
    const decision = await createTestDecision();
    const notification = await outboxRepository.createNotification({
      decisionId: decision._id,
      eventType: 'decision.updated',
      payload: { version: 1 },
    });

    const notifId = notification.notificationId;

    // 1. Dispatcher A claims notification at generation 1
    const workerA = 'dispatcher-A';
    const claimedByA = await outboxRepository.claimPending(workerA, 10);
    expect(claimedByA).toHaveLength(1);
    expect(claimedByA[0].notificationId).toBe(notifId);
    expect(claimedByA[0].claimGeneration).toBe(1);
    expect(claimedByA[0].dispatchOwner).toBe(workerA);

    // 2-3. Lease expires for Dispatcher A
    await NotificationOutboxModel.updateOne(
      { notificationId: notifId },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
    );

    // 4. Dispatcher B claims at generation 2
    const workerB = 'dispatcher-B';
    const claimedByB = await outboxRepository.claimPending(workerB, 10);
    expect(claimedByB).toHaveLength(1);
    expect(claimedByB[0].claimGeneration).toBe(2);
    expect(claimedByB[0].dispatchOwner).toBe(workerB);

    // 5. Dispatcher B dispatches and marks delivered
    const deliveredB = await outboxRepository.markDelivered(
      notifId,
      workerB,
      claimedByB[0].claimGeneration
    );
    expect(deliveredB).toBe(true);

    const docAfterB = await NotificationOutboxModel.findOne({ notificationId: notifId });
    expect(docAfterB?.status).toBe('DELIVERED');

    // 6. Stale Dispatcher A resumes and attempts to mark delivered
    const staleDeliveredA = await outboxRepository.markDelivered(
      notifId,
      workerA,
      claimedByA[0].claimGeneration
    );
    expect(staleDeliveredA).toBe(false);

    // State remains DELIVERED by B
    const docFinal = await NotificationOutboxModel.findOne({ notificationId: notifId });
    expect(docFinal?.status).toBe('DELIVERED');
  });

  it('7. Stale Dispatcher A cannot record failure or reset retry count after losing claim', async () => {
    const decision = await createTestDecision();
    const notification = await outboxRepository.createNotification({
      decisionId: decision._id,
      eventType: 'decision.updated',
      payload: { version: 1 },
    });

    const notifId = notification.notificationId;

    // Worker A claims at gen 1
    const workerA = 'dispatcher-A';
    const claimedA = await outboxRepository.claimPending(workerA, 10);

    // Worker A lease expires
    await NotificationOutboxModel.updateOne(
      { notificationId: notifId },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
    );

    // Worker B claims at gen 2
    const workerB = 'dispatcher-B';
    const claimedB = await outboxRepository.claimPending(workerB, 10);
    expect(claimedB[0].claimGeneration).toBe(2);

    // Worker A attempts markFailed
    const staleFailedA = await outboxRepository.markFailed(
      notifId,
      'Worker A timeout failure',
      workerA,
      claimedA[0].claimGeneration
    );
    expect(staleFailedA).toBe(false);

    // Status is still CLAIMED by B
    const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
    expect(doc?.status).toBe('CLAIMED');
    expect(doc?.dispatchOwner).toBe(workerB);
    expect(doc?.claimGeneration).toBe(2);
  });

  it('8. Consumer receives event -> processes -> crashes before ack: durable deduplication prevents re-execution', async () => {
    const consumerId = 'email-notifier-consumer';
    const notificationId = crypto.randomUUID();

    let sideEffectExecutionCount = 0;
    const processNotification = async (notifId: string) => {
      await outboxService.deduplicateConsumerEvent(consumerId, notifId, async () => {
        sideEffectExecutionCount++;
        return 'processed';
      });
    };

    // First attempt: processes successfully
    await processNotification(notificationId);
    expect(sideEffectExecutionCount).toBe(1);

    // Simulated consumer crash & redelivery of exact same notificationId
    await processNotification(notificationId);
    expect(sideEffectExecutionCount).toBe(1); // Not executed again!

    // Ensure record is persisted in MongoDB
    const record = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
    expect(record).not.toBeNull();
  });

  it('9. Concurrent consumers race to process the same delivered notification: exactly 1 executes side effect', async () => {
    const consumerId = 'webhook-fanout-consumer';
    const notificationId = crypto.randomUUID();

    let executions = 0;
    const executeFanout = async () => {
      const isNew = await outboxService.deduplicateConsumerEvent(consumerId, notificationId, async () => {
        executions++;
        return 'executed';
      });
      if (isNew) {
        return 'executed';
      }
      return 'deduplicated';
    };

    // 5 concurrent attempts to process the exact same notification
    const results = await Promise.all([
      executeFanout(),
      executeFanout(),
      executeFanout(),
      executeFanout(),
      executeFanout(),
    ]);

    expect(executions).toBe(1);
    expect(results.filter((r) => r === 'executed')).toHaveLength(1);
    expect(results.filter((r) => r === 'deduplicated')).toHaveLength(4);
  });

  it('10. Outbox transaction abort leaves 0 pending notifications', async () => {
    const decision = await createTestDecision();

    await expect(
      runInTransaction(async (session) => {
        await outboxService.createNotification(
          {
            decisionId: decision._id,
            eventType: 'decision.deleted',
            payload: { reason: 'Cancelled' },
          },
          session
        );

        // Simulated business validation abort
        throw new Error('Transaction abort triggered intentionally');
      })
    ).rejects.toThrow('Transaction abort triggered intentionally');

    const count = await NotificationOutboxModel.countDocuments();
    expect(count).toBe(0);
  });

  it('11. Atomic commit creates business entity AND outbox entry in single transaction', async () => {
    let createdDecisionId = '';

    await runInTransaction(async (session) => {
      const dec = await DecisionModel.create(
        [
          {
            title: 'Atomic Business Decision',
            ownerId,
            criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
            options: [{ id: 'o1', name: 'O1' }],
            scores: { o1: { c1: 90 } },
            version: 1,
            auditIntegrityStatus: 'healthy',
          },
        ],
        { session }
      );
      createdDecisionId = dec[0]._id.toString();

      await outboxService.createNotification(
        {
          decisionId: dec[0]._id,
          eventType: 'decision.created',
          payload: { title: dec[0].title },
        },
        session
      );
    });

    const decDoc = await DecisionModel.findById(createdDecisionId);
    expect(decDoc).not.toBeNull();

    const notifDoc = await NotificationOutboxModel.findOne({ decisionId: createdDecisionId });
    expect(notifDoc).not.toBeNull();
    expect(notifDoc?.status).toBe('PENDING');
  });

  it('12. Max retry exhaustion marks notification as failed without runaway retry loops', async () => {
    const decision = await createTestDecision();
    const notification = await outboxRepository.createNotification({
      decisionId: decision._id,
      eventType: 'webhook.send',
      payload: { url: 'https://invalid-destination.internal' },
    });

    const notifId = notification.notificationId;

    // Simulate 5 failed claim/dispatch attempts
    for (let i = 0; i < 5; i++) {
      const claimed = await outboxRepository.claimPending(`worker-${i}`, 10);
      expect(claimed).toHaveLength(1);
      await NotificationOutboxModel.updateOne(
        { notificationId: notifId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );
    }

    const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
    expect(doc?.retryCount).toBe(5);

    // Next claim must return empty because retryCount >= 5 is excluded from candidates
    const claimedAfterMax = await outboxRepository.claimPending('worker-final', 10);
    expect(claimedAfterMax).toHaveLength(0);
  });
});
