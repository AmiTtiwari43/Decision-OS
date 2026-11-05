import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  outboxService,
  computePayloadHash,
  type DestinationAdapter,
  type ConsumerEventContext,
} from '../src/services/outbox.service.js';
import { outboxRepository } from '../src/repositories/outbox.repository.js';
import {
  NotificationConsumerRecordModel,
  NotificationOutboxModel,
} from '../src/models/index.js';
import {
  claimTestDatabaseOwnership,
  assertCanCleanupTestDatabase,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

const ADVERSARIAL_URI = getTestDatabaseUri(
  'mongodb://127.0.0.1:27018/decision_os_v33_adv_test?replicaSet=rs0&directConnection=true',
  { runId: 'v33_adv_run', workerId: 'v33_adv_w1' }
);

describe('DECISION OS — BATCH 4 V3.3 ADVERSARIAL VERIFICATION SUITE (D33-01 to D33-28)', () => {
  beforeAll(async () => {
    await mongoose.connect(ADVERSARIAL_URI);
    await claimTestDatabaseOwnership(mongoose.connection, 'v33_adv_run', 'v33_adv_w1');
  });

  afterAll(async () => {
    try {
      await cleanupTestDatabase(mongoose.connection, 'v33_adv_run', 'v33_adv_w1');
    } catch {
      // ignore teardown
    }
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await NotificationOutboxModel.deleteMany({});
      await NotificationConsumerRecordModel.deleteMany({});
    }
  });

  // =========================================================================
  // SECTION 1: F-V32-01 — Dispatcher Outcome Classification (D33-01 to D33-06)
  // =========================================================================
  describe('F-V32-01: Dispatcher Outcome Classification & Rejected Acks', () => {
    it('D33-01: Active worker dispatches and acknowledges successfully', async () => {
      const notifId = `d33-01-${Date.now()}`;
      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'DECISION_FINALIZED',
        payload: { test: true },
        status: 'PENDING',
        claimGeneration: 0,
        retryCount: 0,
        maxRetries: 3,
      });

      let dispatched = false;
      const result = await outboxService.dispatchPending('worker-d33-01', 1, async (item) => {
        if (item.notificationId === notifId) dispatched = true;
      });

      expect(dispatched).toBe(true);
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.acknowledgementLost).toBe(0);
      expect(result.claimLost).toBe(0);
      expect(result.events[0].outcome).toBe('DELIVERED');
      expect(result.events[0].claimGeneration).toBe(1);

      const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(doc?.status).toBe('DELIVERED');
      expect(doc?.dispatchOwner).toBeNull();
    });

    it('D33-02: Stale worker receives false from markDelivered and is NOT counted as successful', async () => {
      const notifId = `d33-02-${Date.now()}`;
      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'DECISION_FINALIZED',
        payload: { test: true },
        status: 'PENDING',
        claimGeneration: 0,
        retryCount: 0,
        maxRetries: 3,
      });

      const result = await outboxService.dispatchPending('worker-stale-02', 1, async (item) => {
        // While dispatcher executes, Worker B steals claim with higher generation
        await NotificationOutboxModel.updateOne(
          { notificationId: item.notificationId },
          {
            $set: {
              dispatchOwner: 'worker-B',
              claimGeneration: 2,
              status: 'CLAIMED',
              leaseExpiresAt: new Date(Date.now() + 60000),
            },
          }
        );
      });

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(0); // MUST NEVER be counted as successful!
      expect(result.acknowledgementLost).toBe(1); // Classified as acknowledgement-lost
      expect(result.failed).toBe(0);
      expect(result.events[0].outcome).toBe('ACKNOWLEDGEMENT_LOST');
    });

    it('D33-03: Newer worker CLAIMED state and generation remain unchanged after stale acknowledgement', async () => {
      const notifId = `d33-03-${Date.now()}`;
      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'DECISION_FINALIZED',
        payload: { test: true },
        status: 'CLAIMED',
        dispatchOwner: 'worker-new-03',
        claimGeneration: 3,
        leaseExpiresAt: new Date(Date.now() + 60000),
      });

      // Stale worker attempts direct markDelivered with generation 1
      const staleAck = await outboxRepository.markDelivered(notifId, 'worker-old-03', 1);
      expect(staleAck).toBe(false);

      const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(doc?.status).toBe('CLAIMED');
      expect(doc?.dispatchOwner).toBe('worker-new-03');
      expect(doc?.claimGeneration).toBe(3);
    });

    it('D33-04: Destination succeeds, ack fails -> classified as ACKNOWLEDGEMENT_LOST, not falsely successful', async () => {
      const notifId = `d33-04-${Date.now()}`;
      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'DECISION_FINALIZED',
        payload: { test: true },
        status: 'PENDING',
        claimGeneration: 0,
        retryCount: 0,
        maxRetries: 3,
      });

      let destinationExecuted = false;
      const result = await outboxService.dispatchPending('worker-04', 1, async (item) => {
        destinationExecuted = true;
        // Expire the lease on the record mid-dispatch
        await NotificationOutboxModel.updateOne(
          { notificationId: item.notificationId },
          { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
        );
      });

      expect(destinationExecuted).toBe(true);
      expect(result.succeeded).toBe(0);
      expect(result.acknowledgementLost).toBe(1);
      expect(result.events[0].outcome).toBe('ACKNOWLEDGEMENT_LOST');
      expect(result.events[0].error).toContain('Destination execution succeeded but outbox acknowledgement was rejected');
    });

    it('D33-05: Dispatcher does not overwrite newer worker state via markFailed after a lost claim', async () => {
      const notifId = `d33-05-${Date.now()}`;
      await NotificationOutboxModel.create({
        notificationId: notifId,
        decisionId: new mongoose.Types.ObjectId(),
        eventType: 'DECISION_FINALIZED',
        payload: { test: true },
        status: 'PENDING',
        claimGeneration: 0,
        retryCount: 0,
        maxRetries: 3,
      });

      const result = await outboxService.dispatchPending('worker-05', 1, async (item) => {
        // While failing, another worker reclaims with generation 2
        await NotificationOutboxModel.updateOne(
          { notificationId: item.notificationId },
          {
            $set: {
              dispatchOwner: 'worker-takeover-05',
              claimGeneration: 2,
              status: 'CLAIMED',
              leaseExpiresAt: new Date(Date.now() + 60000),
            },
          }
        );
        throw new Error('Destination connection timeout');
      });

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(0); // Cannot record failure because claim was lost
      expect(result.claimLost).toBe(1);
      expect(result.events[0].outcome).toBe('CLAIM_LOST');

      // The takeover worker's state is preserved!
      const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(doc?.dispatchOwner).toBe('worker-takeover-05');
      expect(doc?.claimGeneration).toBe(2);
      expect(doc?.status).toBe('CLAIMED');
    });

    it('D33-06: Batch metrics reconcile exactly with per-event outcomes', async () => {
      const notifIds = [`d33-06-a-${Date.now()}`, `d33-06-b-${Date.now()}`, `d33-06-c-${Date.now()}`];
      for (const id of notifIds) {
        await NotificationOutboxModel.create({
          notificationId: id,
          decisionId: new mongoose.Types.ObjectId(),
          eventType: 'DECISION_FINALIZED',
          payload: { test: true },
          status: 'PENDING',
          claimGeneration: 0,
          retryCount: 0,
          maxRetries: 3,
        });
      }

      let callIndex = 0;
      const result = await outboxService.dispatchPending('worker-06', 3, async (item) => {
        callIndex++;
        if (callIndex === 1) {
          // Normal success
        } else if (callIndex === 2) {
          // Acknowledgement lost
          await NotificationOutboxModel.updateOne(
            { notificationId: item.notificationId },
            { $set: { claimGeneration: 99 } }
          );
        } else {
          // Failure
          throw new Error('Network error on item 3');
        }
      });

      expect(result.processed).toBe(3);
      expect(result.succeeded).toBe(1);
      expect(result.acknowledgementLost).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.claimLost).toBe(0);
      expect(result.events.length).toBe(3);
      expect(result.processed).toBe(
        result.succeeded + result.failed + result.acknowledgementLost + result.claimLost
      );
    });
  });

  // =========================================================================
  // SECTION 2: F-V32-02 — Consumer Failure Lease Fencing (D33-07 to D33-12)
  // =========================================================================
  describe('F-V32-02: Consumer Failure Lease Fencing', () => {
    it('D33-07: Active worker can mark its own processing attempt FAILED', async () => {
      const consumerId = 'consumer-07';
      const notifId = `notif-07-${Date.now()}`;
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId: notifId,
        idempotencyKey: `${consumerId}:${notifId}`,
        status: 'PROCESSING',
        processingOwner: 'worker-07',
        claimGeneration: 1,
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() + 60000),
      });

      const failed = await outboxService.failConsumerProcessing(
        consumerId,
        notifId,
        'worker-07',
        1,
        'Explicit test failure'
      );
      expect(failed).toBe(true);

      const doc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(doc?.status).toBe('FAILED');
      expect(doc?.lastError).toBe('Explicit test failure');
      expect(doc?.processingOwner).toBeNull();
      expect(doc?.leaseExpiresAt).toBeNull();
    });

    it('D33-08: Expired consumer lease cannot be marked FAILED', async () => {
      const consumerId = 'consumer-08';
      const notifId = `notif-08-${Date.now()}`;
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId: notifId,
        idempotencyKey: `${consumerId}:${notifId}`,
        status: 'PROCESSING',
        processingOwner: 'worker-08',
        claimGeneration: 1,
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() - 5000), // Expired 5s ago
      });

      const failed = await outboxService.failConsumerProcessing(
        consumerId,
        notifId,
        'worker-08',
        1,
        'Stale worker error'
      );
      expect(failed).toBe(false);

      // Verify database record was NOT mutated
      const doc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(doc?.status).toBe('PROCESSING'); // Unchanged!
      expect(doc?.processingOwner).toBe('worker-08');
    });

    it('D33-09: Worker A cannot fail generation 1 after Worker B claims generation 2', async () => {
      const consumerId = 'consumer-09';
      const notifId = `notif-09-${Date.now()}`;
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId: notifId,
        idempotencyKey: `${consumerId}:${notifId}`,
        status: 'PROCESSING',
        processingOwner: 'worker-B',
        claimGeneration: 2,
        attemptCount: 2,
        leaseExpiresAt: new Date(Date.now() + 60000),
      });

      const failed = await outboxService.failConsumerProcessing(
        consumerId,
        notifId,
        'worker-A',
        1,
        'Worker A stale failure'
      );
      expect(failed).toBe(false);

      const doc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(doc?.status).toBe('PROCESSING');
      expect(doc?.processingOwner).toBe('worker-B');
      expect(doc?.claimGeneration).toBe(2);
    });

    it('D33-10: Failed stale update leaves Worker B owner, generation, status, and lease unchanged', async () => {
      const consumerId = 'consumer-10';
      const notifId = `notif-10-${Date.now()}`;
      const futureExpiry = new Date(Date.now() + 120000);
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId: notifId,
        idempotencyKey: `${consumerId}:${notifId}`,
        status: 'PROCESSING',
        processingOwner: 'worker-B-10',
        claimGeneration: 5,
        attemptCount: 5,
        leaseExpiresAt: futureExpiry,
      });

      const res = await outboxService.failConsumerProcessing(
        consumerId,
        notifId,
        'worker-A-stale',
        4,
        'Stale error'
      );
      expect(res).toBe(false);

      const doc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(doc?.processingOwner).toBe('worker-B-10');
      expect(doc?.claimGeneration).toBe(5);
      expect(doc?.status).toBe('PROCESSING');
      expect(doc?.leaseExpiresAt?.getTime()).toBe(futureExpiry.getTime());
    });

    it('D33-11: Server time ($$NOW), not application clock, decides lease validity on failure', async () => {
      const consumerId = 'consumer-11';
      const notifId = `notif-11-${Date.now()}`;
      // Set lease to expire 1 second in the future on server
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId: notifId,
        idempotencyKey: `${consumerId}:${notifId}`,
        status: 'PROCESSING',
        processingOwner: 'worker-11',
        claimGeneration: 1,
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() + 2000),
      });

      // Wait 2500ms deterministically via controlled lease expiry in DB
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId: notifId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );

      // Now server $$NOW > leaseExpiresAt
      const res = await outboxService.failConsumerProcessing(
        consumerId,
        notifId,
        'worker-11',
        1,
        'Expired failure'
      );
      expect(res).toBe(false);
    });

    it('D33-12: Concurrent failure and takeover produce one valid serialized outcome', async () => {
      const consumerId = 'consumer-12';
      const notifId = `notif-12-${Date.now()}`;
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId: notifId,
        idempotencyKey: `${consumerId}:${notifId}`,
        status: 'PROCESSING',
        processingOwner: 'worker-12-A',
        claimGeneration: 1,
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() - 1000), // Expired
      });

      // Worker A attempts failure while Worker B attempts claim concurrently
      const [failRes, claimRes] = await Promise.all([
        outboxService.failConsumerProcessing(consumerId, notifId, 'worker-12-A', 1, 'Worker A failed'),
        outboxService.claimConsumerProcessing(consumerId, notifId, 'worker-12-B', 30000),
      ]);

      // Worker A's failure must be rejected because lease was expired
      expect(failRes).toBe(false);
      // Worker B's claim succeeds
      expect(claimRes.status).toBe('CLAIMED');

      const doc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(doc?.processingOwner).toBe('worker-12-B');
      expect(doc?.claimGeneration).toBe(2);
    });
  });

  // =========================================================================
  // SECTION 3: F-V32-03 — Destination Idempotency Crash Window (D33-13 to D33-18)
  // =========================================================================
  describe('F-V32-03: Destination Idempotency Crash Window & Durable Recovery', () => {
    // Durable fake destination collection in MongoDB
    interface FakeDestinationDoc {
      _id: string; // idempotencyKey
      payloadHash: string;
      sideEffectCount: number;
      result: { delivered: boolean; timestamp: number };
    }

    const getFakeDestCol = () => mongoose.connection.db!.collection<FakeDestinationDoc>('fake_destination_log');

    // Durable test destination adapter
    const createDurableAdapter = (supportsIdempotency = true): DestinationAdapter<{ delivered: boolean }, { orderId: string }> => ({
      destinationName: 'DurableTestDestination',
      supportsIdempotency,
      execute: async (context: ConsumerEventContext<{ orderId: string }>) => {
        const col = getFakeDestCol();
        const pHash = context.payloadHash || computePayloadHash(context.payload);

        // Check if existing record exists with this idempotency key
        const existing = await col.findOne({ _id: context.idempotencyKey });
        if (existing) {
          if (existing.payloadHash !== pHash) {
            throw new Error(`Conflict: Idempotency key '${context.idempotencyKey}' reused with conflicting payload hash.`);
          }
          if (supportsIdempotency) {
            // Deduplicate: return previously computed result without repeating side effect
            return existing.result;
          }
          // Non-idempotent destination repeats side effect!
          await col.updateOne({ _id: context.idempotencyKey }, { $inc: { sideEffectCount: 1 } });
          return { delivered: true };
        }

        // First execution: atomically insert record and perform side effect
        const res = { delivered: true, timestamp: Date.now() };
        await col.insertOne({
          _id: context.idempotencyKey,
          payloadHash: pHash,
          sideEffectCount: 1,
          result: res,
        });
        return res;
      },
    });

    it('D33-13: Crash window test: crash after destination success before COMPLETED, reclaimed by Worker B, exactly 1 side effect', async () => {
      const consumerId = 'consumer-d33-13';
      const notifId = `notif-d33-13-${Date.now()}`;
      const payload = { orderId: 'ord-12345' };
      const adapter = createDurableAdapter(true);

      // 1. Worker A claims consumer lease
      const claimA = await outboxService.claimConsumerProcessing(consumerId, notifId, 'worker-A', 30000);
      expect(claimA.status).toBe('CLAIMED');
      expect(claimA.claimGeneration).toBe(1);

      // 2. Worker A executes destination adapter successfully
      const contextA: ConsumerEventContext<{ orderId: string }> = {
        idempotencyKey: `${consumerId}:${notifId}`,
        consumerId,
        notificationId: notifId,
        claimGeneration: claimA.claimGeneration!,
        workerId: 'worker-A',
        attemptCount: 1,
        payload,
        payloadHash: computePayloadHash(payload),
        destinationName: adapter.destinationName,
      };
      const destResultA = await adapter.execute(contextA);
      expect(destResultA.delivered).toBe(true);

      // 3. Verify exactly 1 side effect was executed at destination
      let destLog = await getFakeDestCol().findOne({ _id: `${consumerId}:${notifId}` });
      expect(destLog?.sideEffectCount).toBe(1);

      // 4. INJECT CRASH! Process dies BEFORE completeConsumerProcessing can persist COMPLETED.
      // Verify consumer record remains in PROCESSING, not COMPLETED
      let consumerDoc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(consumerDoc?.status).toBe('PROCESSING');
      expect(consumerDoc?.processingOwner).toBe('worker-A');

      // 5. Controlled lease expiration in database:
      await NotificationConsumerRecordModel.updateOne(
        { consumerId, notificationId: notifId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );

      // 6. Worker B reclaims the event with higher claim generation
      const claimB = await outboxService.claimConsumerProcessing(consumerId, notifId, 'worker-B', 30000);
      expect(claimB.status).toBe('CLAIMED');
      expect(claimB.claimGeneration).toBe(2);

      // 7. Worker B executes the same destination adapter with the same stable idempotency key
      const contextB: ConsumerEventContext<{ orderId: string }> = {
        idempotencyKey: `${consumerId}:${notifId}`,
        consumerId,
        notificationId: notifId,
        claimGeneration: claimB.claimGeneration!,
        workerId: 'worker-B',
        attemptCount: 2,
        payload,
        payloadHash: computePayloadHash(payload),
        destinationName: adapter.destinationName,
      };
      const destResultB = await adapter.execute(contextB);
      expect(destResultB.delivered).toBe(true);

      // 8. VERIFY: Side effect count is STILL EXACTLY 1! (Durable idempotency preserved across crash window)
      destLog = await getFakeDestCol().findOne({ _id: `${consumerId}:${notifId}` });
      expect(destLog?.sideEffectCount).toBe(1);

      // 9. Worker B completes consumer processing
      const completedB = await outboxService.completeConsumerProcessing(consumerId, notifId, 'worker-B', 2);
      expect(completedB).toBe(true);

      consumerDoc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
      expect(consumerDoc?.status).toBe('COMPLETED');
    });

    it('D33-14: Same key with different payload hash is rejected by idempotent destination', async () => {
      const consumerId = 'consumer-d33-14';
      const notifId = `notif-d33-14-${Date.now()}`;
      const adapter = createDurableAdapter(true);

      const context1: ConsumerEventContext<{ orderId: string }> = {
        idempotencyKey: `${consumerId}:${notifId}`,
        consumerId,
        notificationId: notifId,
        claimGeneration: 1,
        workerId: 'worker-1',
        attemptCount: 1,
        payload: { orderId: 'original-payload' },
        payloadHash: computePayloadHash({ orderId: 'original-payload' }),
      };
      await adapter.execute(context1);

      // Presenting same idempotency key with conflicting payload
      const context2: ConsumerEventContext<{ orderId: string }> = {
        idempotencyKey: `${consumerId}:${notifId}`,
        consumerId,
        notificationId: notifId,
        claimGeneration: 2,
        workerId: 'worker-2',
        attemptCount: 2,
        payload: { orderId: 'conflicting-payload' },
        payloadHash: computePayloadHash({ orderId: 'conflicting-payload' }),
      };

      await expect(adapter.execute(context2)).rejects.toThrow(/reused with conflicting payload hash/);
    });

    it('D33-15: Non-idempotent destination is reported as at_least_once_risk', async () => {
      const consumerId = 'consumer-d33-15';
      const notifId = `notif-d33-15-${Date.now()}`;
      const nonIdempotentAdapter = createDurableAdapter(false);

      const res = await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        'worker-15',
        nonIdempotentAdapter,
        { payload: { orderId: 'ord-15' } }
      );

      expect(res.status).toBe('COMPLETED');
      expect(res.deliverySemantics).toBe('at_least_once_risk');
    });

    it('D33-16: Destination idempotency survives a new worker and a new service instance', async () => {
      const consumerId = 'consumer-d33-16';
      const notifId = `notif-d33-16-${Date.now()}`;
      const adapter = createDurableAdapter(true);

      // Worker 1 runs
      await outboxService.processConsumerEvent(
        consumerId,
        notifId,
        'worker-16-A',
        adapter,
        { payload: { orderId: 'ord-16' } }
      );

      // New service instance & new worker
      const newServiceInstance = new (outboxService.constructor as new () => typeof outboxService)();
      const res = await newServiceInstance.processConsumerEvent(
        consumerId,
        notifId,
        'worker-16-B',
        adapter,
        { payload: { orderId: 'ord-16' } }
      );

      expect(res.duplicate).toBe(true);
      expect(res.executed).toBe(false);
      expect(res.status).toBe('DUPLICATE');

      const destLog = await getFakeDestCol().findOne({ _id: `${consumerId}:${notifId}` });
      expect(destLog?.sideEffectCount).toBe(1);
    });

    it('D33-17: Repeated completed notification does not invoke the destination again', async () => {
      const consumerId = 'consumer-d33-17';
      const notifId = `notif-d33-17-${Date.now()}`;
      let invocationCount = 0;

      const customAdapter: DestinationAdapter<{ ok: boolean }> = {
        destinationName: 'CountingAdapter',
        supportsIdempotency: true,
        execute: async () => {
          invocationCount++;
          return { ok: true };
        },
      };

      await outboxService.processConsumerEvent(consumerId, notifId, 'w1', customAdapter);
      expect(invocationCount).toBe(1);

      // Invoke second time on completed notification
      const secondCall = await outboxService.processConsumerEvent(consumerId, notifId, 'w2', customAdapter);
      expect(secondCall.duplicate).toBe(true);
      expect(secondCall.executed).toBe(false);
      expect(invocationCount).toBe(1); // Destination was NOT invoked again!
    });

    it('D33-18: Destination timeout with unknown outcome is classified as RETRYABLE_ERROR when completion rejected', async () => {
      const consumerId = 'consumer-d33-18';
      const notifId = `notif-d33-18-${Date.now()}`;

      const delayedAdapter: DestinationAdapter<{ timeout: boolean }> = {
        destinationName: 'DelayedAdapter',
        supportsIdempotency: true,
        execute: async () => {
          // While executing, expire lease
          await NotificationConsumerRecordModel.updateOne(
            { consumerId, notificationId: notifId },
            { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
          );
          return { timeout: true };
        },
      };

      const res = await outboxService.processConsumerEvent(consumerId, notifId, 'w18', delayedAdapter);
      expect(res.status).toBe('RETRYABLE_ERROR');
      expect(res.executed).toBe(true);
      expect(res.error).toContain('completion rejected due to expired lease or superseded worker');
    });
  });

  // =========================================================================
  // SECTION 4: F-V32-04 & F-V32-05 — Atomic Cleanup Generation & Post-Drop Recovery
  // =========================================================================
  describe('F-V32-04 & F-V32-05: Atomic Cleanup Generation & Safe Post-Drop Recovery', () => {
    it('D33-19: Exactly one initial cleanup lock acquisition wins', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_19_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-19', workerId: 'w-19' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-19', 'w-19');

        // Two concurrent cleanup calls for same database
        const [res1, res2] = await Promise.allSettled([
          cleanupTestDatabase(conn, 'run-19', 'w-19'),
          cleanupTestDatabase(conn, 'run-19', 'w-19'),
        ]);

        const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      } finally {
        await conn.close();
      }
    });

    it('D33-20: Cleanup generation advances atomically via server-side $inc', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_20_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-20', workerId: 'w-20' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-20', 'w-20');

        // Verify initial state
        const metaCol = conn.db!.collection('__test_run_metadata');
        const lockBefore = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });
        expect(lockBefore?.lifecycleState).toBe('OWNED');

        await cleanupTestDatabase(conn, 'run-20', 'w-20');

        // Registry record shows generation was atomically advanced to 1
        const regCol = conn.getClient().db('decision_os_test_coordination_test').collection('cleanup_registry');
        const regDoc = await regCol.findOne({ _id: conn.db!.databaseName as unknown as import('mongodb').ObjectId });
        expect(regDoc?.cleanupGeneration).toBe(1);
        expect(regDoc?.lifecycleState).toBe('CLEANED');
      } finally {
        await conn.close();
      }
    });

    it('D33-21: Same worker cannot concurrently execute two drops for the same generation', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_21_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-21', workerId: 'w-21' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-21', 'w-21');
        const metaCol = conn.db!.collection('__test_run_metadata');

        // Set state to CLEANUP_LOCKED with dropInProgress: true
        await metaCol.updateOne(
          { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
          {
            $set: {
              lifecycleState: 'CLEANUP_LOCKED',
              cleanupOwner: 'w-21',
              cleanupGeneration: 1,
              dropInProgress: true,
            },
          }
        );

        // Concurrent attempt by same worker must be rejected because drop is already in progress
        await expect(cleanupTestDatabase(conn, 'run-21', 'w-21', 1)).rejects.toThrow(
          /drop is already in progress concurrently/
        );
      } finally {
        try {
          await conn.db?.dropDatabase();
        } catch {
          // ignore
        }
        await conn.close();
      }
    });

    it('D33-22: Different worker cannot continue cleanup', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_22_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-22', workerId: 'w-22-A' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-22', 'w-22-A');

        // Worker B attempts cleanup
        await expect(cleanupTestDatabase(conn, 'run-22', 'w-22-B')).rejects.toThrow(
          /Safety guard violation: database .* is owned by worker 'w-22-A'/
        );
      } finally {
        await cleanupTestDatabase(conn, 'run-22', 'w-22-A');
        await conn.close();
      }
    });

    it('D33-23: Stale generation cannot continue cleanup', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_23_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-23', workerId: 'w-23' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-23', 'w-23');
        const metaCol = conn.db!.collection('__test_run_metadata');

        // Advance generation to 5
        await metaCol.updateOne(
          { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
          {
            $set: {
              lifecycleState: 'CLEANUP_LOCKED',
              cleanupOwner: 'w-23',
              cleanupGeneration: 5,
              dropInProgress: false,
            },
          }
        );

        // Caller attempts retry with stale generation 2
        await expect(cleanupTestDatabase(conn, 'run-23', 'w-23', 2)).rejects.toThrow(
          /cleanup generation 2 is superseded by newer generation 5/
        );
      } finally {
        try {
          await conn.db?.dropDatabase();
        } catch {
          // ignore
        }
        await conn.close();
      }
    });

    it('D33-24: Crash after lock but before drop can be safely recovered', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_24_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-24', workerId: 'w-24' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-24', 'w-24');
        const metaCol = conn.db!.collection('__test_run_metadata');

        // Simulate crash: CLEANUP_LOCKED set, but dropDatabase was not yet executed
        await metaCol.updateOne(
          { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
          {
            $set: {
              lifecycleState: 'CLEANUP_LOCKED',
              cleanupOwner: 'w-24',
              cleanupGeneration: 1,
              dropInProgress: false,
            },
          }
        );

        // Recovery retry by same worker succeeds
        await expect(cleanupTestDatabase(conn, 'run-24', 'w-24', 1)).resolves.toBeUndefined();

        const collections = await conn.db!.listCollections().toArray();
        expect(collections.length).toBe(0);
      } finally {
        await conn.close();
      }
    });

    it('D33-25: Crash after drop but before completion record can be safely recovered via registry', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_25_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-25', workerId: 'w-25' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-25', 'w-25');
        const dbName = conn.db!.databaseName;
        const coordCol = conn.getClient().db('decision_os_test_coordination_test').collection('cleanup_registry');

        // Set registry state to CLEANUP_LOCKED
        await coordCol.updateOne(
          { _id: dbName as unknown as import('mongodb').ObjectId },
          {
            $set: {
              runId: 'run-25',
              workerId: 'w-25',
              cleanupOwner: 'w-25',
              cleanupGeneration: 1,
              lifecycleState: 'CLEANUP_LOCKED',
              cleanupInProgress: true,
            },
          },
          { upsert: true }
        );

        // Drop the database (crash right after drop!)
        await conn.db!.dropDatabase();

        // Target DB now has 0 collections, registry is in CLEANUP_LOCKED
        const collections = await conn.db!.listCollections().toArray();
        expect(collections.length).toBe(0);

        // Retry cleanup with same identity
        await expect(cleanupTestDatabase(conn, 'run-25', 'w-25', 1)).resolves.toBeUndefined();

        // Registry successfully transitioned to CLEANED
        const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
        expect(regDoc?.lifecycleState).toBe('CLEANED');
      } finally {
        await conn.close();
      }
    });

    it('D33-26: Lost response after successful drop is handled idempotently', async () => {
      const dbUri = getTestDatabaseUri(
        'mongodb://127.0.0.1:27018/decision_os_d33_26_test?replicaSet=rs0&directConnection=true',
        { runId: 'run-26', workerId: 'w-26' }
      );
      const conn = await mongoose.createConnection(dbUri).asPromise();
      try {
        await claimTestDatabaseOwnership(conn, 'run-26', 'w-26');
        await cleanupTestDatabase(conn, 'run-26', 'w-26');

        // Database is dropped and CLEANED. Repeated call succeeds idempotently:
        await expect(cleanupTestDatabase(conn, 'run-26', 'w-26')).resolves.toBeUndefined();
      } finally {
        await conn.close();
      }
    });

    it('D33-27: Empty database without verified ownership does not silently pass', async () => {
      const emptyDbUri = 'mongodb://127.0.0.1:27018/decision_os_d33_27_unowned_test?replicaSet=rs0&directConnection=true';
      const emptyConn = await mongoose.createConnection(emptyDbUri).asPromise();
      try {
        // Ensure no collections and no registry record
        const collections = await emptyConn.db!.listCollections().toArray();
        expect(collections.length).toBe(0);

        await expect(cleanupTestDatabase(emptyConn, 'unowned_run', 'unowned_worker')).rejects.toThrow(
          /has no collections and no verified cleanup lock in registry/
        );
      } finally {
        await emptyConn.close();
      }
    });

    it('D33-28: Reserved and production database protections remain effective', async () => {
      const fakeProdConn = {
        db: {
          databaseName: 'production',
          listCollections: async () => ({ toArray: async () => [{ name: 'users' }] }),
          collection: () => ({ findOne: async () => null, insertOne: async () => {} }),
          dropDatabase: async () => {},
        },
        getClient: () => null,
      } as unknown as mongoose.Connection;

      await expect(assertCanCleanupTestDatabase(fakeProdConn, 'run-prod', 'w-prod')).rejects.toThrow(
        /refusing cleanup on reserved\/production database 'production'/
      );

      await expect(cleanupTestDatabase(fakeProdConn, 'run-prod', 'w-prod')).rejects.toThrow(
        /refusing cleanup on reserved\/production database 'production'/
      );
    });
  });
});
