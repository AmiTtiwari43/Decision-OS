import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { outboxRepository } from '../repositories/outbox.repository.js';
import {
  NotificationConsumerRecordModel,
  type NotificationOutboxDocument,
  type NotificationConsumerRecordDocument,
} from '../models/index.js';

export function computePayloadHash(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export type DispatchOutcome = 'DELIVERED' | 'ACKNOWLEDGEMENT_LOST' | 'DESTINATION_FAILED' | 'CLAIM_LOST';

export interface DispatchEventDetail {
  notificationId: string;
  outcome: DispatchOutcome;
  claimGeneration: number;
  error?: string;
}

export interface DispatcherResult {
  processed: number;
  succeeded: number;
  failed: number;
  acknowledgementLost: number;
  claimLost: number;
  events: DispatchEventDetail[];
}

export interface ConsumerEventContext<TPayload = Record<string, unknown>> {
  idempotencyKey: string;
  consumerId: string;
  notificationId: string;
  claimGeneration: number;
  workerId: string;
  attemptCount: number;
  payload?: TPayload;
  payloadHash?: string;
  destinationName?: string;
}

export interface DestinationAdapter<TResult = unknown, TPayload = Record<string, unknown>> {
  readonly destinationName: string;
  readonly supportsIdempotency: boolean;
  execute: (context: ConsumerEventContext<TPayload>) => Promise<TResult>;
}

export interface ConsumerProcessingResult<T = unknown> {
  executed: boolean;
  duplicate: boolean;
  result?: T;
  error?: string;
  status: 'COMPLETED' | 'DUPLICATE' | 'LOCKED' | 'FAILED' | 'RETRYABLE_ERROR';
  deliverySemantics: 'idempotent_destination' | 'at_least_once_risk';
  idempotencyKey: string;
  claimGeneration?: number;
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
    if (!workerId || typeof workerId !== 'string' || !workerId.trim()) {
      throw new Error('dispatchPending requires a valid, non-empty workerId');
    }

    const claimed = await outboxRepository.claimPending(workerId, limit);
    let succeeded = 0;
    let failed = 0;
    let acknowledgementLost = 0;
    let claimLost = 0;
    const events: DispatchEventDetail[] = [];

    for (const item of claimed) {
      const claimGen = typeof item.claimGeneration === 'number' ? item.claimGeneration : 1;
      try {
        await dispatcherFn(item);
        const acked = await outboxRepository.markDelivered(item.notificationId, workerId, claimGen);
        if (acked) {
          succeeded++;
          events.push({
            notificationId: item.notificationId,
            outcome: 'DELIVERED',
            claimGeneration: claimGen,
          });
        } else {
          acknowledgementLost++;
          events.push({
            notificationId: item.notificationId,
            outcome: 'ACKNOWLEDGEMENT_LOST',
            claimGeneration: claimGen,
            error: 'Destination execution succeeded but outbox acknowledgement was rejected (claim lost or expired)',
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const failRecorded = await outboxRepository.markFailed(item.notificationId, message, workerId, claimGen);
        if (failRecorded) {
          failed++;
          events.push({
            notificationId: item.notificationId,
            outcome: 'DESTINATION_FAILED',
            claimGeneration: claimGen,
            error: message,
          });
        } else {
          claimLost++;
          events.push({
            notificationId: item.notificationId,
            outcome: 'CLAIM_LOST',
            claimGeneration: claimGen,
            error: `Destination execution failed (${message}) and failure could not be recorded (claim lost or expired)`,
          });
        }
      }
    }

    return {
      processed: claimed.length,
      succeeded,
      failed,
      acknowledgementLost,
      claimLost,
      events,
    };
  }

  /**
   * Atomically claims or reclaims a consumer notification processing lease using MongoDB server-derived time ($$NOW + $dateAdd).
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
    const validDuration = Math.min(Math.max(1000, leaseDurationMs || 30000), 300000);
    const idempotencyKey = `${consumerId}:${notificationId}`;

    // 1. Ensure record exists in PENDING state atomically
    try {
      const created = new NotificationConsumerRecordModel({
        consumerId,
        notificationId,
        idempotencyKey,
        status: 'PENDING',
        claimGeneration: 0,
        attemptCount: 0,
      });
      await created.save(session ? { session } : undefined);
    } catch (err: unknown) {
      const isDuplicateKey =
        err && typeof err === 'object' && ('code' in err) && (err as { code?: number }).code === 11000;
      if (!isDuplicateKey) {
        throw err;
      }
    }

    // 2. Check if already completed or exceeded retries
    const existingQ = NotificationConsumerRecordModel.findOne({ consumerId, notificationId });
    if (session) existingQ.session(session);
    const existing = await existingQ.exec();

    if (existing?.status === 'COMPLETED') {
      return { status: 'ALREADY_COMPLETED', record: existing };
    }

    if (existing && existing.attemptCount >= maxAttempts && existing.status === 'FAILED') {
      return { status: 'MAX_RETRIES_EXCEEDED', record: existing };
    }

    // 3. Atomically claim/reclaim using database server time ($$NOW + $dateAdd)
    const claimedDoc = await NotificationConsumerRecordModel.findOneAndUpdate(
      {
        consumerId,
        notificationId,
        status: { $in: ['PENDING', 'FAILED', 'PROCESSING'] },
        $or: [
          { status: { $in: ['PENDING', 'FAILED'] } },
          { leaseExpiresAt: null },
          { $expr: { $lt: ['$leaseExpiresAt', '$$NOW'] } },
        ],
        attemptCount: { $lt: maxAttempts },
      },
      [
        {
          $set: {
            status: 'PROCESSING',
            processingOwner: workerId,
            leaseExpiresAt: {
              $dateAdd: {
                startDate: '$$NOW',
                unit: 'millisecond',
                amount: validDuration,
              },
            },
            claimGeneration: { $add: [{ $ifNull: ['$claimGeneration', 0] }, 1] },
            attemptCount: { $add: [{ $ifNull: ['$attemptCount', 0] }, 1] },
          },
        },
      ],
      {
        returnDocument: 'after',
        updatePipeline: true,
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
   * Conditionally marks consumer processing as COMPLETED using database server time.
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
      [
        {
          $set: {
            status: 'COMPLETED',
            completedAt: '$$NOW',
            processedAt: '$$NOW',
            processingOwner: null,
            leaseExpiresAt: null,
          },
        },
      ],
      {
        session,
        updatePipeline: true,
      }
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
    if (!workerId || typeof workerId !== 'string' || !workerId.trim()) {
      throw new Error('failConsumerProcessing requires a valid, non-empty workerId');
    }
    if (typeof claimGeneration !== 'number' || !Number.isFinite(claimGeneration)) {
      throw new Error('failConsumerProcessing requires a valid numeric claimGeneration');
    }

    const res = await NotificationConsumerRecordModel.updateOne(
      {
        consumerId,
        notificationId,
        processingOwner: workerId,
        claimGeneration,
        status: 'PROCESSING',
        $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
      },
      [
        {
          $set: {
            status: 'FAILED',
            lastError: error,
            failedAt: '$$NOW',
            processingOwner: null,
            leaseExpiresAt: null,
          },
        },
      ],
      {
        session,
        updatePipeline: true,
      }
    ).exec();

    return res.matchedCount === 1;
  }

  /**
   * End-to-end durable consumer execution lifecycle.
   * Supports DestinationAdapter interface or direct side-effect execution.
   * Atomically claims lease -> executes side effect with stable idempotency key -> conditionally marks COMPLETED.
   * If a crash occurs before side effect, subsequent deliveries safely reclaim the lease.
   */
  async processConsumerEvent<T = unknown, P = Record<string, unknown>>(
    consumerId: string,
    notificationId: string,
    workerId: string,
    adapterOrFn: DestinationAdapter<T, P> | ((idempotencyKey: string, context?: ConsumerEventContext<P>) => Promise<T>),
    options?: {
      leaseDurationMs?: number;
      maxAttempts?: number;
      payload?: P;
      supportsIdempotency?: boolean;
    }
  ): Promise<ConsumerProcessingResult<T>> {
    if (!workerId || typeof workerId !== 'string' || !workerId.trim()) {
      throw new Error('processConsumerEvent violation: mandatory workerId is missing or empty.');
    }

    const idempotencyKey = `${consumerId}:${notificationId}`;

    const isAdapter = typeof adapterOrFn === 'object' && adapterOrFn !== null && 'execute' in adapterOrFn;
    const supportsIdempotency = isAdapter
      ? Boolean(adapterOrFn.supportsIdempotency)
      : Boolean(options?.supportsIdempotency ?? false);

    const deliverySemantics = supportsIdempotency ? 'idempotent_destination' : 'at_least_once_risk';

    const claim = await this.claimConsumerProcessing(
      consumerId,
      notificationId,
      workerId,
      options?.leaseDurationMs,
      options?.maxAttempts
    );

    if (claim.status === 'ALREADY_COMPLETED') {
      return {
        executed: false,
        duplicate: true,
        status: 'DUPLICATE',
        deliverySemantics,
        idempotencyKey,
        claimGeneration: claim.record?.claimGeneration,
      };
    }

    if (claim.status === 'LOCKED') {
      return {
        executed: false,
        duplicate: false,
        status: 'LOCKED',
        deliverySemantics,
        idempotencyKey,
        error: 'Notification currently locked by another worker',
      };
    }

    if (claim.status === 'MAX_RETRIES_EXCEEDED') {
      return {
        executed: false,
        duplicate: false,
        status: 'FAILED',
        deliverySemantics,
        idempotencyKey,
        error: 'Maximum retry limit exceeded for notification',
      };
    }

    const context: ConsumerEventContext<P> = {
      idempotencyKey,
      consumerId,
      notificationId,
      claimGeneration: claim.claimGeneration!,
      workerId,
      attemptCount: claim.record?.attemptCount ?? 1,
      payload: options?.payload,
      payloadHash: computePayloadHash(options?.payload),
      destinationName: isAdapter ? adapterOrFn.destinationName : undefined,
    };

    try {
      const result = isAdapter
        ? await adapterOrFn.execute(context)
        : await adapterOrFn(idempotencyKey, context);

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
          deliverySemantics,
          idempotencyKey,
          claimGeneration: claim.claimGeneration,
          error: 'Side effect executed but completion rejected due to expired lease or superseded worker',
        };
      }

      return {
        executed: true,
        duplicate: false,
        result,
        status: 'COMPLETED',
        deliverySemantics,
        idempotencyKey,
        claimGeneration: claim.claimGeneration,
      };
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
   * Safe consumer deduplication wrapper.
   * Requires explicit workerId and sideEffect execution to prevent default identity inference.
   * Rejects unsafe legacy invocation without worker identity or side effect execution.
   */
  async deduplicateConsumerEvent<T = unknown>(
    consumerId: string,
    notificationId: string,
    workerOrSideEffect?: string | ((key: string, ctx?: ConsumerEventContext) => Promise<T>),
    sideEffectFn?: (key: string, ctx?: ConsumerEventContext) => Promise<T>
  ): Promise<boolean> {
    if (typeof workerOrSideEffect === 'string' && (typeof sideEffectFn === 'function' || typeof sideEffectFn === 'object')) {
      const res = await this.processConsumerEvent(
        consumerId,
        notificationId,
        workerOrSideEffect,
        sideEffectFn
      );
      return res.status === 'COMPLETED';
    }

    throw new Error(
      'Unsafe legacy deduplicateConsumerEvent invocation without side-effect execution is removed. Use processConsumerEvent(consumerId, notificationId, workerId, destinationAdapter) or supply explicit workerId and sideEffectFn.'
    );
  }

  async resetConsumerRegistry(consumerId?: string): Promise<void> {
    const filter = consumerId ? { consumerId } : {};
    await NotificationConsumerRecordModel.deleteMany(filter).exec();
  }
}

export const outboxService = new OutboxService();

