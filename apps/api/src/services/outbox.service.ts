import mongoose from 'mongoose';
import { outboxRepository } from '../repositories/outbox.repository.js';
import {
  NotificationConsumerRecordModel,
  type NotificationOutboxDocument,
  type NotificationConsumerRecordDocument,
} from '../models/index.js';

export interface DispatcherResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export interface ConsumerProcessingResult<T = unknown> {
  executed: boolean;
  duplicate: boolean;
  result?: T;
  error?: string;
  status: 'COMPLETED' | 'DUPLICATE' | 'LOCKED' | 'FAILED' | 'RETRYABLE_ERROR';
}

export interface ConsumerClaimResult {
  status: 'CLAIMED' | 'ALREADY_COMPLETED' | 'LOCKED' | 'MAX_RETRIES_EXCEEDED';
  record?: NotificationConsumerRecordDocument;
  claimGeneration?: number;
}

export class OutboxService {
  /**
   * Persists an outbox notification event within a caller-provided MongoDB session.
   */
  async createNotification(
    data: {
      notificationId?: string;
      decisionId: string | mongoose.Types.ObjectId;
      eventType: string;
      payload: Record<string, unknown>;
    },
    session?: mongoose.ClientSession
  ): Promise<NotificationOutboxDocument> {
    return outboxRepository.createNotification(data, session);
  }

  /**
   * Dispatches pending outbox records using the provided sender function.
   * Guarantees at-least-once delivery with automatic retry handling and claim generation fencing.
   */
  async dispatchPending(
    workerId: string,
    limit: number = 10,
    dispatcherFn: (event: NotificationOutboxDocument) => Promise<void>
  ): Promise<DispatcherResult> {
    const claimed = await outboxRepository.claimPending(workerId, limit);
    let succeeded = 0;
    let failed = 0;

    for (const item of claimed) {
      try {
        await dispatcherFn(item);
        await outboxRepository.markDelivered(item.notificationId, workerId, item.claimGeneration);
        succeeded++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await outboxRepository.markFailed(item.notificationId, message, workerId, item.claimGeneration);
        failed++;
      }
    }

    return {
      processed: claimed.length,
      succeeded,
      failed,
    };
  }

  /**
   * Atomically claims or reclaims a consumer notification processing lease.
   * Guards against race conditions, reclaims expired leases, and rejects already-completed notifications.
   */
  async claimConsumerProcessing(
    consumerId: string,
    notificationId: string,
    workerId: string,
    leaseDurationMs: number = 30000,
    maxAttempts: number = 5,
    session?: mongoose.ClientSession
  ): Promise<ConsumerClaimResult> {
    const idempotencyKey = `${consumerId}:${notificationId}`;
    const leaseExpiration = new Date(Date.now() + leaseDurationMs);

    // 1. Check existing record
    const query = NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
    if (session) query.session(session);
    let record = await query.exec();

    if (!record) {
      try {
        const created = new NotificationConsumerRecordModel({
          consumerId,
          notificationId,
          idempotencyKey,
          status: 'PROCESSING',
          processingOwner: workerId,
          leaseExpiresAt: leaseExpiration,
          claimGeneration: 1,
          attemptCount: 1,
          createdAt: new Date(),
        });
        record = await created.save(session ? { session } : undefined);
        return {
          status: 'CLAIMED',
          record,
          claimGeneration: record.claimGeneration,
        };
      } catch (err: unknown) {
        const isDuplicateKey =
          err && typeof err === 'object' && ('code' in err) && (err as { code?: number }).code === 11000;
        if (!isDuplicateKey) {
          throw err;
        }
        // Concurrent insert lost race; reload existing record
        const reloadQ = NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
        if (session) reloadQ.session(session);
        record = await reloadQ.exec();
      }
    }

    if (!record) {
      return { status: 'LOCKED' };
    }

    if (record.status === 'COMPLETED') {
      return { status: 'ALREADY_COMPLETED', record };
    }

    if (record.attemptCount >= maxAttempts && record.status === 'FAILED') {
      return { status: 'MAX_RETRIES_EXCEEDED', record };
    }

    // Atomic conditional claim/reclaim
    const claimedDoc = await NotificationConsumerRecordModel.findOneAndUpdate(
      {
        _id: record._id,
        status: { $in: ['PENDING', 'FAILED', 'PROCESSING'] },
        $or: [
          { status: { $in: ['PENDING', 'FAILED'] } },
          { leaseExpiresAt: null },
          { $expr: { $lt: ['$leaseExpiresAt', '$$NOW'] } },
        ],
        attemptCount: { $lt: maxAttempts },
      },
      {
        $set: {
          status: 'PROCESSING',
          processingOwner: workerId,
          leaseExpiresAt: leaseExpiration,
        },
        $inc: {
          claimGeneration: 1,
          attemptCount: 1,
        },
      },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      }
    ).exec();

    if (!claimedDoc) {
      const currQ = NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
      if (session) currQ.session(session);
      const current = await currQ.exec();
      if (current?.status === 'COMPLETED') {
        return { status: 'ALREADY_COMPLETED', record: current };
      }
      if (current && current.attemptCount >= maxAttempts) {
        return { status: 'MAX_RETRIES_EXCEEDED', record: current };
      }
      return { status: 'LOCKED', record: current || undefined };
    }

    return {
      status: 'CLAIMED',
      record: claimedDoc,
      claimGeneration: claimedDoc.claimGeneration,
    };
  }

  /**
   * Conditionally marks consumer processing as COMPLETED.
   * Enforces exact worker ownership, active claimGeneration, and unexpired database lease.
   */
  async completeConsumerProcessing(
    consumerId: string,
    notificationId: string,
    workerId: string,
    claimGeneration: number,
    session?: mongoose.ClientSession
  ): Promise<boolean> {
    const res = await NotificationConsumerRecordModel.updateOne(
      {
        consumerId,
        notificationId,
        processingOwner: workerId,
        claimGeneration,
        status: 'PROCESSING',
        $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
      },
      {
        $set: {
          status: 'COMPLETED',
          completedAt: new Date(),
          processedAt: new Date(),
          processingOwner: null,
          leaseExpiresAt: null,
        },
      },
      session ? { session } : undefined
    ).exec();

    return res.matchedCount === 1;
  }

  /**
   * Records a processing failure, resetting ownership to permit bounded retries.
   */
  async failConsumerProcessing(
    consumerId: string,
    notificationId: string,
    workerId: string,
    claimGeneration: number,
    error: string,
    session?: mongoose.ClientSession
  ): Promise<boolean> {
    const res = await NotificationConsumerRecordModel.updateOne(
      {
        consumerId,
        notificationId,
        processingOwner: workerId,
        claimGeneration,
        status: 'PROCESSING',
      },
      {
        $set: {
          status: 'FAILED',
          lastError: error,
          processingOwner: null,
          leaseExpiresAt: null,
        },
      },
      session ? { session } : undefined
    ).exec();

    return res.matchedCount === 1;
  }

  /**
   * End-to-end durable consumer execution lifecycle.
   * Atomically claims lease -> executes side effect -> conditionally marks COMPLETED.
   * If a crash occurs before side effect, subsequent deliveries safely reclaim the lease.
   */
  async processConsumerEvent<T>(
    consumerId: string,
    notificationId: string,
    workerId: string,
    sideEffectFn: () => Promise<T>,
    options?: { leaseDurationMs?: number; maxAttempts?: number }
  ): Promise<ConsumerProcessingResult<T>> {
    const claim = await this.claimConsumerProcessing(
      consumerId,
      notificationId,
      workerId,
      options?.leaseDurationMs,
      options?.maxAttempts
    );

    if (claim.status === 'ALREADY_COMPLETED') {
      return { executed: false, duplicate: true, status: 'DUPLICATE' };
    }

    if (claim.status === 'LOCKED') {
      return {
        executed: false,
        duplicate: false,
        status: 'LOCKED',
        error: 'Notification currently locked by another worker',
      };
    }

    if (claim.status === 'MAX_RETRIES_EXCEEDED') {
      return {
        executed: false,
        duplicate: false,
        status: 'FAILED',
        error: 'Maximum retry limit exceeded for notification',
      };
    }

    try {
      const result = await sideEffectFn();
      const completed = await this.completeConsumerProcessing(
        consumerId,
        notificationId,
        workerId,
        claim.claimGeneration!
      );

      if (!completed) {
        return {
          executed: true,
          duplicate: false,
          result,
          status: 'RETRYABLE_ERROR',
          error: 'Side effect executed but completion rejected due to expired lease or superseded worker',
        };
      }

      return { executed: true, duplicate: false, result, status: 'COMPLETED' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.failConsumerProcessing(
        consumerId,
        notificationId,
        workerId,
        claim.claimGeneration!,
        message
      );
      throw err;
    }
  }

  /**
   * Durable consumer idempotency verification utility backed by MongoDB unique compound index.
   * Marks status COMPLETED immediately on record creation.
   * Returns true if the message has NOT been processed before by this consumer.
   * Returns false if it is a duplicate delivery.
   */
  async deduplicateConsumerEvent(consumerId: string, notificationId: string): Promise<boolean> {
    try {
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId,
        idempotencyKey: `${consumerId}:${notificationId}`,
        status: 'COMPLETED',
        completedAt: new Date(),
        processedAt: new Date(),
      });
      return true; // First-time delivery
    } catch (err: unknown) {
      const isDuplicateKey =
        err &&
        typeof err === 'object' &&
        ('code' in err) &&
        (err as { code?: number }).code === 11000;
      if (isDuplicateKey) {
        return false; // Duplicate
      }
      throw err;
    }
  }

  async resetConsumerRegistry(consumerId?: string): Promise<void> {
    const filter = consumerId ? { consumerId } : {};
    await NotificationConsumerRecordModel.deleteMany(filter).exec();
  }
}

export const outboxService = new OutboxService();

