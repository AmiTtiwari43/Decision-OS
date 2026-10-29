import mongoose, { Schema, type Model } from 'mongoose';
import type { IDecisionEvidence, DecisionEvidenceDocument } from './evidence.types.js';

export const DecisionEvidenceSchema = new Schema<IDecisionEvidence, Model<DecisionEvidenceDocument>>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: [true, 'decisionId is required'],
      index: true,
    },
    targetType: {
      type: String,
      enum: {
        values: ['decision', 'option', 'criterion', 'contribution'],
        message: "targetType must be 'decision', 'option', 'criterion', or 'contribution'",
      },
      required: [true, 'targetType is required'],
    },
    targetId: {
      type: String,
      required: [true, 'targetId is required'],
      trim: true,
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'createdById is required'],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ['url', 'document', 'excerpt'],
        message: "type must be 'url', 'document', or 'excerpt'",
      },
      required: [true, 'type is required'],
    },
    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
      maxlength: 255,
    },
    sourceUrl: {
      type: String,
      default: null,
      trim: true,
    },
    documentReference: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    sourceExcerpt: {
      type: String,
      default: null,
      trim: true,
      maxlength: 5000,
    },
    userSummary: {
      type: String,
      default: null,
      trim: true,
      maxlength: 5000,
    },
    publicationDate: {
      type: Date,
      default: null,
    },
    provenance: {
      createdByName: {
        type: String,
        required: true,
        trim: true,
      },
      createdByEmail: {
        type: String,
        required: true,
        trim: true,
      },
      capturedVia: {
        type: String,
        enum: ['manual_entry', 'web_link', 'document_citation'],
        required: true,
      },
    },
  },
  {
    timestamps: true,
    collection: 'decision_evidence',
  }
);

// Indexes for query performance
DecisionEvidenceSchema.index({ decisionId: 1, targetType: 1, targetId: 1 });
DecisionEvidenceSchema.index({ decisionId: 1, createdAt: -1 });

export const DecisionEvidenceModel: Model<DecisionEvidenceDocument> =
  mongoose.models.DecisionEvidence ||
  mongoose.model<DecisionEvidenceDocument>('DecisionEvidence', DecisionEvidenceSchema);

