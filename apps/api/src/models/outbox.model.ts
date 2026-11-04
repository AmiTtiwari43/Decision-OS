import mongoose, { Schema, type Model } from 'mongoose';
import type { NotificationOutboxDocument, INotificationOutbox } from './outbox.types.js';

export const NotificationOutboxSchema = new Schema<INotificationOutbox, Model<NotificationOutboxDocument>>(
  {
    notificationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'CLAIMED', 'DELIVERED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    dispatchOwner: {
      type: String,
      default: null,
      index: true,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    claimGeneration: {
      type: Number,
      default: 0,
      min: 0,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastError: {
      type: String,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.__v;
        if (ret.decisionId && typeof ret.decisionId === 'object') {
          ret.decisionId = (ret.decisionId as mongoose.Types.ObjectId).toString();
        }
        return ret;
      },
    },
  }
);

NotificationOutboxSchema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });

export const NotificationOutboxModel =
  (mongoose.models.NotificationOutbox as Model<NotificationOutboxDocument>) ||
  mongoose.model<NotificationOutboxDocument>('NotificationOutbox', NotificationOutboxSchema);

export const NotificationConsumerRecordSchema = new Schema(
  {
    consumerId: {
      type: String,
      required: true,
      index: true,
    },
    notificationId: {
      type: String,
      required: true,
      index: true,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

// Unique compound index guarantees durable consumer idempotency across restarts & concurrent deliveries
NotificationConsumerRecordSchema.index({ consumerId: 1, notificationId: 1 }, { unique: true });

export const NotificationConsumerRecordModel =
  mongoose.models.NotificationConsumerRecord ||
  mongoose.model('NotificationConsumerRecord', NotificationConsumerRecordSchema);
