import mongoose, { Schema, type Model } from 'mongoose';
import type { CommentDocument, IComment } from './comment.types.js';

export const CommentSchema = new Schema<IComment, Model<CommentDocument>>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: true,
      index: true,
    },
    authorId: {
      type: String,
      required: true,
      index: true,
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
    },
    authorRole: {
      type: String,
      enum: ['owner', 'editor', 'contributor', 'viewer'],
      required: true,
    },
    targetType: {
      type: String,
      enum: ['decision', 'option', 'criterion', 'cell', 'contribution'],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    cellCoordinates: {
      type: {
        optionId: { type: String, trim: true },
        criterionId: { type: String, trim: true },
      },
      default: null,
      _id: false,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 2000,
    },
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
      index: true,
    },
    isResolved: {
      type: Boolean,
      default: false,
      index: true,
    },
    resolvedBy: {
      type: {
        id: { type: String },
        name: { type: String },
      },
      default: null,
      _id: false,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    replyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
        delete ret._id;
        delete ret.__v;
        delete (ret as Record<string, unknown>).authorEmail;
        if (ret.decisionId && typeof ret.decisionId === 'object') {
          ret.decisionId = (ret.decisionId as mongoose.Types.ObjectId).toString();
        }
        if (ret.parentCommentId && typeof ret.parentCommentId === 'object') {
          ret.parentCommentId = (ret.parentCommentId as mongoose.Types.ObjectId).toString();
        }
        return ret;
      },
    },
  }
);

// Indexes
CommentSchema.index({ decisionId: 1, createdAt: -1 });
CommentSchema.index({ decisionId: 1, targetType: 1, targetId: 1, createdAt: -1 });
CommentSchema.index({ decisionId: 1, isResolved: 1 });

export const CommentModel =
  (mongoose.models.Comment as Model<CommentDocument>) ||
  mongoose.model<CommentDocument>('Comment', CommentSchema);
