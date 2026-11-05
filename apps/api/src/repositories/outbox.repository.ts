import mongoose from 'mongoose';
import {
  NotificationOutboxModel,
  type NotificationOutboxDocument,
} from '../models/index.js';

export class OutboxRepository {
  /**
   * Persists a notification event in the outbox collection.
   * Can be executed within a multi-document MongoDB transaction.
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
    const doc = new NotificationOutboxModel({
      notificationId: data.notificationId || crypto.randomUUID(),
      decisionId: new mongoose.Types.ObjectId(data.decisionId),
      eventType: data.eventType,
      payload: data.payload,
      status: 'PENDING',
      retryCount: 0,
    });
    return doc.save(session ? { session } : undefined);
  }

  /**
   * Finds a notification by its stable ID.
   */
  async findByNotificationId(
    notificationId: string,
    session?: mongoose.ClientSession
  ): Promise<NotificationOutboxDocument | null> {
    const q = NotificationOutboxModel.findOne({ notificationId });
    if (session) q.session(session);
    return q.exec();
  }

  /**
   * Atomically claims unleased or expired pending notifications for dispatch using database server-time.
   */
  async claimPending(
    workerId: string,
    limit: number = 10,
    leaseDurationMs: number = 30000
  ): Promise<NotificationOutboxDocument[]> {
    const validDuration = Math.min(Math.max(1000, leaseDurationMs || 30000), 300000);

    const candidates = await NotificationOutboxModel.find({
      status: { $in: ['PENDING', 'CLAIMED'] },
      $or: [
        { status: 'PENDING' },
        { leaseExpiresAt: null },
        { $expr: { $lt: ['$leaseExpiresAt', '$$NOW'] } },
      ],
      retryCount: { $lt: 5 },
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .exec();

    const claimed: NotificationOutboxDocument[] = [];
    for (const item of candidates) {
      const updated = await NotificationOutboxModel.findOneAndUpdate(
        {
          _id: item._id,
          $or: [
            { status: 'PENDING' },
            { leaseExpiresAt: null },
            { $expr: { $lt: ['$leaseExpiresAt', '$$NOW'] } },
          ],
        },
        [
          {
            $set: {
              status: 'CLAIMED',
              dispatchOwner: workerId,
              leaseExpiresAt: {
                $dateAdd: {
                  startDate: '$$NOW',
                  unit: 'millisecond',
                  amount: validDuration,
                },
              },
              retryCount: { $add: [{ $ifNull: ['$retryCount', 0] }, 1] },
              claimGeneration: { $add: [{ $ifNull: ['$claimGeneration', 0] }, 1] },
            },
          },
        ],
        {
          returnDocument: 'after',
          updatePipeline: true,
        }
      ).exec();

      if (updated) {
        claimed.push(updated);
      }
    }
    return claimed;
  }

  /**
   * Marks a notification as successfully delivered with claim generation fencing.
   * Both workerId and claimGeneration are strictly mandatory.
   * A stale dispatcher whose lease expired or whose generation was superseded will be rejected.
   */
  async markDelivered(
    notificationId: string,
    workerId: string,
    claimGeneration: number,
    expectedState: string = 'CLAIMED'
  ): Promise<boolean> {
    if (!workerId || typeof workerId !== 'string' || !workerId.trim()) {
      throw new Error('markDelivered violation: mandatory workerId is missing or empty.');
    }
    if (typeof claimGeneration !== 'number' || !Number.isFinite(claimGeneration) || claimGeneration <= 0) {
      throw new Error('markDelivered violation: mandatory claimGeneration must be a positive integer.');
    }

    const filter: Record<string, unknown> = {
      notificationId,
      status: expectedState,
      dispatchOwner: workerId,
      claimGeneration,
      $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
    };

    const res = await NotificationOutboxModel.updateOne(
      filter,
      [
        {
          $set: {
            status: 'DELIVERED',
            deliveredAt: '$$NOW',
            leaseExpiresAt: null,
            dispatchOwner: null,
          },
        },
      ],
      { updatePipeline: true }
    ).exec();

    return res.matchedCount === 1;
  }

  /**
   * Records a dispatch failure and resets state to PENDING for exponential backoff retry.
   * Both workerId and claimGeneration are strictly mandatory.
   * Rejects stale dispatchers with mismatched owner, generation, or expired lease.
   */
  async markFailed(
    notificationId: string,
    error: string,
    workerId: string,
    claimGeneration: number,
    expectedState: string = 'CLAIMED'
  ): Promise<boolean> {
    if (!workerId || typeof workerId !== 'string' || !workerId.trim()) {
      throw new Error('markFailed violation: mandatory workerId is missing or empty.');
    }
    if (typeof claimGeneration !== 'number' || !Number.isFinite(claimGeneration) || claimGeneration <= 0) {
      throw new Error('markFailed violation: mandatory claimGeneration must be a positive integer.');
    }

    const filter: Record<string, unknown> = {
      notificationId,
      status: expectedState,
      dispatchOwner: workerId,
      claimGeneration,
      $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
    };

    const res = await NotificationOutboxModel.updateOne(
      filter,
      {
        $set: {
          status: 'PENDING',
          lastError: error,
          leaseExpiresAt: null,
          dispatchOwner: null,
        },
      }
    ).exec();

    return res.matchedCount === 1;
  }
}

export const outboxRepository = new OutboxRepository();

