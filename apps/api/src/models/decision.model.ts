import mongoose, { Schema, type Model } from 'mongoose';
import type { DecisionDocument, IDecision } from './decision.types.js';

const CriterionSchema = new Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, trim: true },
    weight: {
      type: Number,
      required: true,
      min: [0, 'Criterion weight cannot be negative'],
    },
    direction: {
      type: String,
      enum: {
        values: ['benefit', 'cost'],
        message: 'Criterion direction must be either benefit or cost',
      },
      default: 'benefit',
    },
    isLocked: { type: Boolean, default: false },
  },
  { _id: false }
);

const OptionSchema = new Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    tagline: { type: String, trim: true },
    description: { type: String, trim: true },
    color: { type: String, trim: true },
  },
  { _id: false }
);

export const DecisionSchema = new Schema<IDecision, Model<DecisionDocument>>(
  {
    title: {
      type: String,
      required: [true, 'Decision title is required'],
      trim: true,
      minlength: [1, 'Decision title cannot be empty'],
      maxlength: [200, 'Decision title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    criteria: {
      type: [CriterionSchema],
      default: [],
      validate: [
        {
          validator: (criteria: Array<{ id: string }>) => {
            const ids = new Set<string>();
            for (const c of criteria) {
              if (ids.has(c.id)) return false;
              ids.add(c.id);
            }
            return true;
          },
          message: 'Duplicate criterion ID detected',
        },
      ],
    },
    options: {
      type: [OptionSchema],
      default: [],
      validate: [
        {
          validator: (options: Array<{ id: string }>) => {
            const ids = new Set<string>();
            for (const o of options) {
              if (ids.has(o.id)) return false;
              ids.add(o.id);
            }
            return true;
          },
          message: 'Duplicate option ID detected',
        },
      ],
    },
    scores: {
      type: Schema.Types.Mixed,
      default: {},
      validate: [
        {
          validator: (scores: Record<string, Record<string, number>>) => {
            if (!scores || typeof scores !== 'object') return false;
            for (const optionScores of Object.values(scores)) {
              if (!optionScores || typeof optionScores !== 'object') return false;
              for (const score of Object.values(optionScores)) {
                if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
                  return false;
                }
              }
            }
            return true;
          },
          message: 'Scores must be numbers between 0 and 100',
        },
      ],
    },
    analysis: {
      type: Schema.Types.Mixed,
      default: null,
    },
    calculationVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
    isContributionRoundLocked: {
      type: Boolean,
      default: false,
    },
    contributionRoundLockedAt: {
      type: Date,
      default: null,
    },
    isAudited: {
      type: Boolean,
      default: true,
    },
    auditIntegrityStatus: {
      type: String,
      enum: ['healthy', 'pending_reconciliation', 'quarantined'],
      default: 'healthy',
      index: true,
    },
    pendingOperationId: {
      type: String,
      default: null,
    },
    quarantineReason: {
      type: String,
      default: null,
    },
    recoveryFencingToken: {
      type: Number,
      default: 0,
      index: true,
    },
    recoveryOwner: {
      type: String,
      default: null,
      index: true,
    },
    recoveryLeaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    auditHead: {
      type: {
        sequenceNumber: { type: Number, default: 0 },
        eventHash: { type: String, default: null },
        lastEventId: { type: String, default: null },
        updatedAt: { type: Date, default: null },
      },
      default: null,
      _id: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
        delete ret.__v;
        if ((doc as unknown as { currentUserRole?: string }).currentUserRole) {
          ret.currentUserRole = (doc as unknown as { currentUserRole?: string }).currentUserRole;
        }
        ret.isAudited = ret.isAudited !== undefined ? Boolean(ret.isAudited) : true;
        ret.auditIntegrityStatus = ret.auditIntegrityStatus || 'healthy';
        ret.pendingOperationId = ret.pendingOperationId || null;
        ret.quarantineReason = ret.quarantineReason || null;
        ret.auditHead = ret.auditHead || null;
        return ret;
      },
    },
  }
);

// Indexes: Bounded listings sorted by createdAt and scoped by owner
DecisionSchema.index({ createdAt: -1 });
DecisionSchema.index({ ownerId: 1, createdAt: -1 });

export const DecisionModel =
  (mongoose.models.Decision as Model<DecisionDocument>) ||
  mongoose.model<DecisionDocument>('Decision', DecisionSchema);
