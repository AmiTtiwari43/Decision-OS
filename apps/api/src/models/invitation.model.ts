import mongoose, { Schema, type Model } from 'mongoose';
import type {
  DecisionInvitationDocument,
  IDecisionInvitation,
} from './invitation.types.js';

export const DecisionInvitationSchema = new Schema<
  IDecisionInvitation,
  Model<DecisionInvitationDocument>
>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: [true, 'decisionId is required'],
      index: true,
    },
    inviterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'inviterId is required'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: [255, 'Email cannot exceed 255 characters'],
    },
    role: {
      type: String,
      enum: {
        values: ['editor', 'viewer', 'contributor'],
        message: "Role must be either 'editor' or 'viewer' or 'contributor'",
      },
      required: [true, 'Role is required'],
    },
    tokenHash: {
      type: String,
      required: [true, 'Token hash is required'],
      unique: true,
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'accepted', 'revoked', 'expired'],
        message: 'Invalid invitation status',
      },
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: [true, 'Expiration date is required'],
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    acceptedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.tokenHash; // Never expose tokenHash in serialization
        return ret;
      },
    },
  }
);

// Prevent duplicate active pending invitations for the same decision and recipient
DecisionInvitationSchema.index(
  { decisionId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

// Query optimization index
DecisionInvitationSchema.index({ decisionId: 1, status: 1, createdAt: -1 });
DecisionInvitationSchema.index({ email: 1, status: 1 });

export const DecisionInvitationModel =
  (mongoose.models.DecisionInvitation as Model<DecisionInvitationDocument>) ||
  mongoose.model<DecisionInvitationDocument>(
    'DecisionInvitation',
    DecisionInvitationSchema
  );

