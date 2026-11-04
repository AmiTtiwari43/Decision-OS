import mongoose from 'mongoose';
import { outboxRepository } from '../repositories/outbox.repository.js';
import {
  NotificationConsumerRecordModel,
  type NotificationOutboxDocument,
} from '../models/index.js';

export interface DispatcherResult {
  processed: number;
  succeeded: number;
  failed: number;
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
   * Durable consumer idempotency verification utility backed by MongoDB unique compound index.
   * Returns true if the message has NOT been processed before by this consumer.
   * Returns false if it is a duplicate delivery.
   */
  async deduplicateConsumerEvent(consumerId: string, notificationId: string): Promise<boolean> {
    try {
      await NotificationConsumerRecordModel.create({
        consumerId,
        notificationId,
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

