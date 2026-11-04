import mongoose from 'mongoose';
import { outboxRepository } from '../repositories/outbox.repository.js';
import type { NotificationOutboxDocument } from '../models/index.js';

export interface DispatcherResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export class OutboxService {
  private processedConsumerEvents = new Set<string>();

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
   * Guarantees at-least-once delivery with automatic retry handling.
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
        await outboxRepository.markDelivered(item.notificationId, workerId);
        succeeded++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await outboxRepository.markFailed(item.notificationId, message, workerId);
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
   * Consumer idempotency verification utility:
   * Returns true if the message has NOT been processed before by this consumer.
   * Returns false if it is a duplicate delivery.
   */
  deduplicateConsumerEvent(consumerId: string, notificationId: string): boolean {
    const key = `${consumerId}:${notificationId}`;
    if (this.processedConsumerEvents.has(key)) {
      return false; // Duplicate
    }
    this.processedConsumerEvents.add(key);
    return true; // First-time delivery
  }

  resetConsumerRegistry(): void {
    this.processedConsumerEvents.clear();
  }
}

export const outboxService = new OutboxService();

