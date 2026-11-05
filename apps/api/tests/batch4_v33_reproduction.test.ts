import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  outboxService,
  computePayloadHash,
  type DestinationAdapter,
  type ConsumerEventContext,
} from '../src/services/outbox.service.js';
import {
  NotificationConsumerRecordModel,
  NotificationOutboxModel,
} from '../src/models/index.js';
import {
  cleanupTestDatabase,
  claimTestDatabaseOwnership,
  getTestDatabaseUri,
} from '../src/db/guard.js';

const REPRO_URI = getTestDatabaseUri(
  'mongodb://127.0.0.1:27018/decision_os_v33_repro_test?replicaSet=rs0&directConnection=true',
  { runId: 'v33_repro_run', workerId: 'v33_repro_w1' }
);

describe('Batch 4 V3.3 Defect Remediation & Verification Suite (F-V32-01 through F-V32-05)', () => {
  beforeAll(async () => {
    await mongoose.connect(REPRO_URI);
    await claimTestDatabaseOwnership(mongoose.connection, 'v33_repro_run', 'v33_repro_w1');
  });

  afterAll(async () => {
    try {
      await cleanupTestDatabase(mongoose.connection, 'v33_repro_run', 'v33_repro_w1');
    } catch {
      // ignore teardown errors
    }
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await NotificationOutboxModel.deleteMany({});
      await NotificationConsumerRecordModel.deleteMany({});
    }
  });

  // F-V32-01: Dispatcher ignores rejected acknowledgement and increments succeeded count
  it('REPRO-F-V32-01: dispatchPending correctly classifies lost acknowledgement and does not increment succeeded count', async () => {
    const notifId = `repro-notif-${Date.now()}`;
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

    // Worker A runs dispatchPending. In dispatcherFn, Worker B takes over the claim
    const dispatchResult = await outboxService.dispatchPending(
      'worker-A',
      1,
      async (item) => {
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
      }
    );

    // In V3.3: succeeded MUST be 0, acknowledgementLost MUST be 1
    expect(dispatchResult.processed).toBe(1);
    expect(dispatchResult.succeeded).toBe(0);
    expect(dispatchResult.acknowledgementLost).toBe(1);
    expect(dispatchResult.events[0].outcome).toBe('ACKNOWLEDGEMENT_LOST');

    // Persisted state in DB is still owned by Worker B with generation 2
    const doc = await NotificationOutboxModel.findOne({ notificationId: notifId });
    expect(doc?.dispatchOwner).toBe('worker-B');
    expect(doc?.claimGeneration).toBe(2);
    expect(doc?.status).toBe('CLAIMED');
  });

  // F-V32-02: failConsumerProcessing does not verify lease expiration
  it('REPRO-F-V32-02: failConsumerProcessing fails closed on expired lease in V3.3', async () => {
    const consumerId = 'consumer-repro-1';
    const notifId = `repro-consumer-${Date.now()}`;

    // Create consumer record with EXPIRED lease
    await NotificationConsumerRecordModel.create({
      consumerId,
      notificationId: notifId,
      idempotencyKey: `${consumerId}:${notifId}`,
      status: 'PROCESSING',
      processingOwner: 'worker-stale',
      claimGeneration: 1,
      attemptCount: 1,
      leaseExpiresAt: new Date(Date.now() - 10000), // Expired 10s ago
    });

    // Stale worker whose lease expired calls failConsumerProcessing
    const failedResult = await outboxService.failConsumerProcessing(
      consumerId,
      notifId,
      'worker-stale',
      1,
      'Stale worker failure message'
    );

    // In V3.3: this returns FALSE because the lease is expired ($$NOW check)
    expect(failedResult).toBe(false);

    // In DB, status remains PROCESSING and lease was NOT cleared by the stale worker
    const doc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
    expect(doc?.status).toBe('PROCESSING');
    expect(doc?.processingOwner).toBe('worker-stale');
  });

  // F-V32-03: Destination idempotency crash window
  it('REPRO-F-V32-03: with durable destination idempotency, crash before COMPLETED does not duplicate side effect', async () => {
    interface DestLog {
      _id: string;
      sideEffectCount: number;
    }
    const destCol = mongoose.connection.db!.collection<DestLog>('repro_dest_log');
    await destCol.deleteMany({});

    const durableAdapter: DestinationAdapter<{ status: string }, { orderId: string }> = {
      destinationName: 'ReproDurableDestination',
      supportsIdempotency: true,
      execute: async (context: ConsumerEventContext<{ orderId: string }>) => {
        const existing = await destCol.findOne({ _id: context.idempotencyKey });
        if (existing) {
          return { status: 'deduplicated' };
        }
        await destCol.insertOne({ _id: context.idempotencyKey, sideEffectCount: 1 });
        return { status: 'executed' };
      },
    };

    const consumerId = 'consumer-repro-crash';
    const notifId = `repro-notif-${Date.now()}`;

    // Worker 1 claims and executes side effect, but crash happens before completeConsumerProcessing
    const claim1 = await outboxService.claimConsumerProcessing(consumerId, notifId, 'worker-1', 1000);
    expect(claim1.status).toBe('CLAIMED');

    const ctx1: ConsumerEventContext<{ orderId: string }> = {
      idempotencyKey: `${consumerId}:${notifId}`,
      consumerId,
      notificationId: notifId,
      claimGeneration: 1,
      workerId: 'worker-1',
      attemptCount: 1,
      payload: { orderId: 'ord-1' },
      payloadHash: computePayloadHash({ orderId: 'ord-1' }),
      destinationName: durableAdapter.destinationName,
    };
    await durableAdapter.execute(ctx1);

    // Simulated crash! Record remains in PROCESSING. Lease expires:
    await NotificationConsumerRecordModel.updateOne(
      { consumerId, notificationId: notifId },
      { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
    );

    // Worker 2 reclaims event:
    const claim2 = await outboxService.claimConsumerProcessing(consumerId, notifId, 'worker-2', 30000);
    expect(claim2.status).toBe('CLAIMED');
    expect(claim2.claimGeneration).toBe(2);

    const ctx2: ConsumerEventContext<{ orderId: string }> = {
      idempotencyKey: `${consumerId}:${notifId}`,
      consumerId,
      notificationId: notifId,
      claimGeneration: 2,
      workerId: 'worker-2',
      attemptCount: 2,
      payload: { orderId: 'ord-1' },
      payloadHash: computePayloadHash({ orderId: 'ord-1' }),
      destinationName: durableAdapter.destinationName,
    };
    await durableAdapter.execute(ctx2);

    // Side effect count remains exactly 1!
    const log = await destCol.findOne({ _id: `${consumerId}:${notifId}` });
    expect(log?.sideEffectCount).toBe(1);

    // Complete processing
    await outboxService.completeConsumerProcessing(consumerId, notifId, 'worker-2', 2);
    const consumerDoc = await NotificationConsumerRecordModel.findOne({ consumerId, notificationId: notifId });
    expect(consumerDoc?.status).toBe('COMPLETED');
  });

  // F-V32-04: Cleanup generation atomic advancement
  it('REPRO-F-V32-04: cleanupTestDatabase atomically advances generation and rejects stale generation', async () => {
    const testDbUri = 'mongodb://127.0.0.1:27018/decision_os_v33_repro_gen_test?replicaSet=rs0&directConnection=true';
    const tempConn = await mongoose.createConnection(testDbUri).asPromise();

    try {
      await claimTestDatabaseOwnership(tempConn, 'run_gen', 'worker_gen');
      const metaCol = tempConn.db!.collection('__test_run_metadata');

      // Set lock in CLEANUP_LOCKED with cleanupGeneration 3
      await metaCol.updateOne(
        { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'CLEANUP_LOCKED',
            cleanupOwner: 'worker_gen',
            cleanupGeneration: 3,
            dropInProgress: false,
          },
        }
      );

      // Caller attempts retry with stale expectedGeneration: 1
      await expect(
        cleanupTestDatabase(tempConn, 'run_gen', 'worker_gen', 1)
      ).rejects.toThrow(/cleanup generation 1 is superseded by newer generation 3/);
    } finally {
      try {
        await tempConn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await tempConn.close();
    }
  });

  // F-V32-05: Empty database returns early in cleanupTestDatabase without ownership verification
  it('REPRO-F-V32-05: empty database without ownership record strictly throws in V3.3', async () => {
    const emptyDbUri = 'mongodb://127.0.0.1:27018/decision_os_v33_empty_repro_test?replicaSet=rs0&directConnection=true';
    const emptyConn = await mongoose.createConnection(emptyDbUri).asPromise();

    try {
      // Database has 0 collections and NO ownership record in registry
      const collections = await emptyConn.db!.listCollections().toArray();
      expect(collections.length).toBe(0);

      // In V3.3, unverified empty database strictly throws
      await expect(
        cleanupTestDatabase(emptyConn, 'unowned_run', 'unowned_worker')
      ).rejects.toThrow(/has no collections and no verified cleanup lock in registry/);
    } finally {
      await emptyConn.close();
    }
  });
});
