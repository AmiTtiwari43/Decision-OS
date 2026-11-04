import type { Types } from 'mongoose';

export type OutboxStatus = 'PENDING' | 'CLAIMED' | 'DELIVERED' | 'FAILED';

export interface INotificationOutbox {
  notificationId: string;
  decisionId: Types.ObjectId | string;
  eventType: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  dispatchOwner?: string | null;
  leaseExpiresAt?: Date | null;
  retryCount: number;
  lastError?: string | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationOutboxDocument extends INotificationOutbox {
  _id: Types.ObjectId;
}
