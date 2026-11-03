import mongoose, { Schema, type Model } from 'mongoose';
import type {
  OperationJournalDocument,
  IOperationJournal,
} from './operationJournal.types.js';

export const OperationJournalSchema = new Schema<
  IOperationJournal,
  Model<OperationJournalDocument>
>(
  {
    operationId: {
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
    action: {
      type: String,
      required: true,
      index: true,
    },
    actor: {
      id: { type: String, required: true },
      role: { type: String, required: true },
      name: { type: String },
      email: { type: String },
    },
    expectedVersion: {
      type: Number,
      required: true,
    },
    targetVersion: {
      type: Number,
      required: true,
    },
    compensatingVersion: {
      type: Number,
      default: null,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    previousSnapshot: {
      type: Schema.Types.Mixed,
      default: {},
    },
    auditDraft: {
      eventId: { type: String, required: true },
      entityType: { type: String, required: true },
      entityId: { type: String, required: true },
      summary: { type: String, required: true },
      diff: { type: Schema.Types.Mixed, default: {} },
    },
    state: {
      type: String,
      enum: [
        'PENDING',
        'DECISION_MUTATED',
        'EVALUATED',
        'ENTITIES_UPDATED',
        'AUDITED',
        'COMPENSATING',
        'COMPLETED',
        'REVERTED',
        'UNRECOVERABLE',
      ],
      default: 'PENDING',
      index: true,
    },
    recoveryOwner: {
      type: String,
      default: null,
      index: true,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    fencingToken: {
      type: Number,
      default: 0,
    },
    heartbeatAt: {
      type: Date,
      default: Date.now,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    errorDetails: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'operation_journal',
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
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

// Indexes
OperationJournalSchema.index({ state: 1, leaseExpiresAt: 1 });
OperationJournalSchema.index({ decisionId: 1, state: 1 });

export const OperationJournalModel =
  (mongoose.models.OperationJournal as Model<OperationJournalDocument>) ||
  mongoose.model<OperationJournalDocument>(
    'OperationJournal',
    OperationJournalSchema
  );
