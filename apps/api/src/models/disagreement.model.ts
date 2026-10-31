import mongoose, { Schema, type Model } from 'mongoose';
import type { IDisagreementResolution, DisagreementResolutionDocument } from './disagreement.types.js';

export const DisagreementResolutionSchema = new Schema<
  IDisagreementResolution,
  Model<DisagreementResolutionDocument>
>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: [true, 'decisionId is required'],
      index: true,
    },
    disagreementId: {
      type: String,
      required: [true, 'disagreementId is required'],
      trim: true,
    },
    category: {
      type: String,
      enum: ['score', 'priority', 'evidence', 'assumption', 'interpretation'],
      default: 'score',
    },
    criterionId: {
      type: String,
      trim: true,
    },
    optionId: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['open', 'acknowledged', 'resolved'],
      default: 'open',
      required: true,
      index: true,
    },
    resolutionExplanation: {
      type: String,
      trim: true,
      maxlength: 5000,
      default: '',
    },
    resolvedById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedByName: {
      type: String,
      trim: true,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'decision_disagreements',
  }
);

// Compound unique index so each disagreementId on a decision has at most one resolution record
DisagreementResolutionSchema.index({ decisionId: 1, disagreementId: 1 }, { unique: true });

export const DisagreementResolutionModel: Model<DisagreementResolutionDocument> =
  mongoose.models.DecisionDisagreement ||
  mongoose.model<DisagreementResolutionDocument>('DecisionDisagreement', DisagreementResolutionSchema);

