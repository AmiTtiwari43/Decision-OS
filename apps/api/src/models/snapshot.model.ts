import mongoose, { Schema, type Model } from 'mongoose';
import type { DecisionSnapshotDocument, IDecisionSnapshot } from './snapshot.types.js';

export const DecisionSnapshotSchema = new Schema<IDecisionSnapshot, Model<DecisionSnapshotDocument>>(
  {
    snapshotId: {
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
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    criteria: {
      type: [Schema.Types.Mixed] as any,
      default: [],
    },
    options: {
      type: [Schema.Types.Mixed] as any,
      default: [],
    },
    scores: {
      type: Schema.Types.Mixed,
      default: {},
    },
    analysis: {
      type: Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      evidenceCount: { type: Number, default: 0 },
      contributionCount: { type: Number, default: 0 },
      predictionCount: { type: Number, default: 0 },
      disagreementCount: { type: Number, default: 0 },
    },
    snapshotReason: {
      type: String,
      required: true,
      enum: ['calculation', 'milestone', 'manual', 'round_lock'],
      default: 'milestone',
    },
    snapshotNote: {
      type: String,
      default: undefined,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    createdById: {
      type: String,
      required: true,
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

DecisionSnapshotSchema.index({ decisionId: 1, version: -1 });
DecisionSnapshotSchema.index({ decisionId: 1, createdAt: -1 });

// Append-only protection
DecisionSnapshotSchema.pre('updateOne', function () {
  throw new Error('Decision snapshots are strictly append-only. Updates are prohibited.');
});
DecisionSnapshotSchema.pre('updateMany', function () {
  throw new Error('Decision snapshots are strictly append-only. Updates are prohibited.');
});
DecisionSnapshotSchema.pre('findOneAndUpdate', function () {
  throw new Error('Decision snapshots are strictly append-only. Updates are prohibited.');
});

DecisionSnapshotSchema.pre('deleteOne', function () {
  throw new Error('Decision snapshots are strictly append-only. Deletions are prohibited.');
});
DecisionSnapshotSchema.pre('deleteMany', function () {
  throw new Error('Decision snapshots are strictly append-only. Deletions are prohibited.');
});
DecisionSnapshotSchema.pre('findOneAndDelete', function () {
  throw new Error('Decision snapshots are strictly append-only. Deletions are prohibited.');
});

export const DecisionSnapshotModel =
  (mongoose.models.DecisionSnapshot as Model<DecisionSnapshotDocument>) ||
  mongoose.model<DecisionSnapshotDocument>('DecisionSnapshot', DecisionSnapshotSchema);

