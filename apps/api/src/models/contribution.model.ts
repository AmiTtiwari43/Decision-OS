import mongoose, { Schema, type Model } from 'mongoose';
import type {
  DecisionContributionDocument,
  IDecisionContribution,
} from './contribution.types.js';

const RevisionSnapshotSchema = new Schema(
  {
    revision: { type: Number, required: true },
    submittedAt: { type: Date, required: true },
    recommendation: {
      preferredOptionId: { type: String, required: true },
      rationale: { type: String, default: '' },
    },
    criterionScores: { type: Schema.Types.Mixed, default: {} },
    criterionReasoning: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: Number, min: 0, max: 1 },
    prediction: {
      statement: { type: String },
      targetDate: { type: Date },
      probability: { type: Number, min: 0, max: 1 },
    },
  },
  { _id: false }
);

export const DecisionContributionSchema = new Schema<
  IDecisionContribution,
  Model<DecisionContributionDocument>
>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: [true, 'decisionId is required'],
      index: true,
    },
    contributorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'contributorId is required'],
      index: true,
    },
    recommendation: {
      preferredOptionId: {
        type: String,
        required: [true, 'preferredOptionId is required'],
      },
      rationale: {
        type: String,
        default: '',
      },
    },
    criterionScores: {
      type: Schema.Types.Mixed,
      default: {},
    },
    criterionReasoning: {
      type: Schema.Types.Mixed,
      default: {},
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 1,
    },
    prediction: {
      statement: { type: String },
      targetDate: { type: Date },
      probability: { type: Number, min: 0, max: 1 },
    },
    evidenceReferences: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'withdrawn', 'adopted', 'rejected'],
      default: 'draft',
      index: true,
    },
    revision: {
      type: Number,
      default: 1,
    },
    history: {
      type: [RevisionSnapshotSchema],
      default: [],
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    withdrawnAt: {
      type: Date,
      default: null,
    },
    adoptedAt: {
      type: Date,
      default: null,
    },
    adoptedBy: {
      type: String,
      default: null,
    },
    adoptedOptionId: {
      type: String,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound Unique Index: Only 1 contribution record per contributor per decision
DecisionContributionSchema.index({ decisionId: 1, contributorId: 1 }, { unique: true });

// Scoped listing index
DecisionContributionSchema.index({ decisionId: 1, status: 1 });
DecisionContributionSchema.index({ decisionId: 1, createdAt: -1 });
DecisionContributionSchema.index({ contributorId: 1, createdAt: -1 });

export const DecisionContributionModel: Model<DecisionContributionDocument> =
  mongoose.models.DecisionContribution ||
  mongoose.model<DecisionContributionDocument>('DecisionContribution', DecisionContributionSchema);
