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
  claimGeneration?: number;
  retryCount: number;
  lastError?: string | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationOutboxDocument extends INotificationOutbox {
  _id: Types.ObjectId;
}

export type ConsumerProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface INotificationConsumerRecord {
  consumerId: string;
  notificationId: string;
  idempotencyKey?: string;
  status: ConsumerProcessingStatus;
  processingOwner?: string | null;
  leaseExpiresAt?: Date | null;
  claimGeneration: number;
  attemptCount: number;
  lastError?: string | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
}

export interface NotificationConsumerRecordDocument extends INotificationConsumerRecord {
  _id: Types.ObjectId;
}
