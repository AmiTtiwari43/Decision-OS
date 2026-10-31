import mongoose, { Schema, type Model } from 'mongoose';
import type {
  ExpertPredictionDocument,
  IExpertPrediction,
  IPredictionOutcome,
} from './prediction.types.js';

const PredictionOutcomeSchema = new Schema<IPredictionOutcome>(
  {
    outcomeId: { type: String, required: true },
    observedOutcome: { type: Number, required: true, enum: [0, 1] },
    verificationStatus: {
      type: String,
      required: true,
      enum: ['unverified', 'verified', 'disputed'],
      default: 'unverified',
    },
    verificationSource: { type: String, required: true, trim: true },
    outcomeDate: { type: Date, required: true },
    verifiedById: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedByName: { type: String },
    verifiedAt: { type: Date },
    disputeReason: { type: String },
    disputedById: { type: Schema.Types.ObjectId, ref: 'User' },
    disputedAt: { type: Date },
  },
  { _id: false }
);

export const ExpertPredictionSchema = new Schema<
  IExpertPrediction,
  Model<ExpertPredictionDocument>
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
    contributorName: {
      type: String,
      required: [true, 'contributorName is required'],
    },
    predictionId: {
      type: String,
      required: [true, 'predictionId is required'],
      trim: true,
    },
    statement: {
      type: String,
      required: [true, 'statement is required'],
      trim: true,
      maxlength: 2000,
    },
    probability: {
      type: Number,
      required: [true, 'probability is required'],
      min: 0,
      max: 1,
    },
    domain: {
      type: String,
      required: true,
      trim: true,
      default: 'general',
    },
    targetDate: {
      type: Date,
      required: [true, 'targetDate is required'],
    },
    evidenceReferences: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: [
        'submitted',
        'awaiting_outcome',
        'outcome_recorded',
        'verified',
        'disputed',
        'invalidated',
      ],
      default: 'awaiting_outcome',
      index: true,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    outcome: {
      type: PredictionOutcomeSchema,
      required: false,
    },
  },
  {
    timestamps: true,
    collection: 'expert_predictions',
  }
);

ExpertPredictionSchema.index({ decisionId: 1, predictionId: 1 }, { unique: true });
ExpertPredictionSchema.index({ contributorId: 1, status: 1 });
ExpertPredictionSchema.index({ decisionId: 1, status: 1 });

export const ExpertPredictionModel: Model<ExpertPredictionDocument> =
  mongoose.models.ExpertPrediction ||
  mongoose.model<ExpertPredictionDocument>('ExpertPrediction', ExpertPredictionSchema);

