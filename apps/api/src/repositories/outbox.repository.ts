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
   * Atomically claims unleased or expired pending notifications for dispatch.
   */
  async claimPending(
    workerId: string,
    limit: number = 10,
    leaseDurationMs: number = 30000
  ): Promise<NotificationOutboxDocument[]> {
    const now = new Date();
    const leaseExpiration = new Date(now.getTime() + leaseDurationMs);

    const candidates = await NotificationOutboxModel.find({
      status: { $in: ['PENDING', 'CLAIMED'] },
      $or: [
        { status: 'PENDING' },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $lt: now } },
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
            { leaseExpiresAt: { $lt: now } },
          ],
        },
        {
          $set: {
            status: 'CLAIMED',
            dispatchOwner: workerId,
            leaseExpiresAt: leaseExpiration,
          },
          $inc: { retryCount: 1 },
        },
        { new: true }
      ).exec();

      if (updated) {
        claimed.push(updated);
      }
    }
    return claimed;
  }

  /**
   * Marks a notification as successfully delivered.
   */
  async markDelivered(notificationId: string, workerId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { notificationId };
    if (workerId) filter.dispatchOwner = workerId;

    const res = await NotificationOutboxModel.updateOne(
      filter,
      {
        $set: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          leaseExpiresAt: null,
          dispatchOwner: null,
        },
      }
    ).exec();

    return res.matchedCount === 1;
  }

  /**
   * Records a dispatch failure and resets state to PENDING for exponential backoff retry.
   */
  async markFailed(notificationId: string, error: string, workerId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { notificationId };
    if (workerId) filter.dispatchOwner = workerId;

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

