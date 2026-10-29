import mongoose, { Schema, type Model } from 'mongoose';
import type {
  DecisionAccessGrantDocument,
  IDecisionAccessGrant,
} from './decisionAccess.types.js';

export const DecisionAccessGrantSchema = new Schema<
  IDecisionAccessGrant,
  Model<DecisionAccessGrantDocument>
>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: [true, 'decisionId is required'],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    role: {
      type: String,
      enum: {
        values: ['editor', 'viewer'],
        message: "Role must be either 'editor' or 'viewer'",
      },
      required: [true, 'Role is required'],
    },
    grantedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'grantedBy is required'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound unique index prevents duplicate active grants for the same decision and recipient
DecisionAccessGrantSchema.index({ decisionId: 1, userId: 1 }, { unique: true });
// Index for listing decisions shared with a user
DecisionAccessGrantSchema.index({ userId: 1, createdAt: -1 });

export const DecisionAccessGrantModel =
  (mongoose.models.DecisionAccessGrant as Model<DecisionAccessGrantDocument>) ||
  mongoose.model<DecisionAccessGrantDocument>(
    'DecisionAccessGrant',
    DecisionAccessGrantSchema
  );

