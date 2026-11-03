import mongoose, { type Types } from 'mongoose';
import {
  CommentModel,
  type CommentDocument,
  type IComment,
} from '../models/index.js';

export interface ListCommentsFilter {
  targetType?: string;
  targetId?: string;
  isResolved?: boolean;
}

export class CommentRepository {
  /**
   * Creates a new comment or reply.
   */
  async create(data: {
    decisionId: Types.ObjectId | string;
    authorId: string;
    authorName: string;
    authorRole: 'owner' | 'editor' | 'contributor' | 'viewer';
    targetType: IComment['targetType'];
    targetId: string;
    cellCoordinates?: IComment['cellCoordinates'];
    content: string;
    parentCommentId?: Types.ObjectId | string | null;
  }): Promise<CommentDocument> {
    const doc = new CommentModel({
      ...data,
      decisionId: new mongoose.Types.ObjectId(data.decisionId),
      parentCommentId: data.parentCommentId
        ? new mongoose.Types.ObjectId(data.parentCommentId)
        : null,
      isResolved: false,
      isDeleted: false,
      replyCount: 0,
    });
    return doc.save();
  }

  /**
   * Finds a comment by ID.
   */
  async findById(id: string): Promise<CommentDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return CommentModel.findById(id).exec();
  }

  /**
   * Lists comments for a decision with optional filters.
   */
  async listByDecision(
    decisionId: string,
    filter?: ListCommentsFilter
  ): Promise<CommentDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return [];
    }

    const query: Record<string, unknown> = {
      decisionId: new mongoose.Types.ObjectId(decisionId),
    };

    if (filter?.targetType) {
      query.targetType = filter.targetType;
    }
    if (filter?.targetId) {
      query.targetId = filter.targetId;
    }
    if (filter?.isResolved !== undefined) {
      query.isResolved = filter.isResolved;
    }

    return CommentModel.find(query)
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Updates comment content and edited timestamp.
   */
  async updateContent(id: string, content: string): Promise<CommentDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return CommentModel.findByIdAndUpdate(
      id,
      {
        $set: {
          content,
          editedAt: new Date(),
        },
      },
      { new: true }
    ).exec();
  }

  /**
   * Toggles resolution status on a root comment.
   */
  async resolveThread(
    rootCommentId: string,
    isResolved: boolean,
    resolvedBy: { id: string; name: string } | null
  ): Promise<CommentDocument | null> {
    if (!mongoose.isValidObjectId(rootCommentId)) {
      return null;
    }
    return CommentModel.findByIdAndUpdate(
      rootCommentId,
      {
        $set: {
          isResolved,
          resolvedBy: isResolved ? resolvedBy : null,
          resolvedAt: isResolved ? new Date() : null,
        },
      },
      { new: true }
    ).exec();
  }

  /**
   * Atomically increments or decrements replyCount on a comment.
   */
  async incrementReplyCount(commentId: string, amount: number): Promise<void> {
    if (!mongoose.isValidObjectId(commentId)) {
      return;
    }
    await CommentModel.findByIdAndUpdate(commentId, {
      $inc: { replyCount: amount },
    }).exec();
  }

  /**
   * Handles comment deletion:
   * - If replyCount === 0: permanently delete (or hard delete record).
   * - If replyCount > 0: tombstone the comment to preserve thread tree structure.
   */
  async deleteOrTombstone(
    id: string,
    isModeratorDelete: boolean
  ): Promise<{ action: 'deleted' | 'tombstoned'; comment: CommentDocument | null }> {
    if (!mongoose.isValidObjectId(id)) {
      return { action: 'deleted', comment: null };
    }

    const comment = await CommentModel.findById(id);
    if (!comment) {
      return { action: 'deleted', comment: null };
    }

    if (comment.replyCount > 0) {
      // Tombstone
      comment.isDeleted = true;
      comment.deletedAt = new Date();
      comment.content = isModeratorDelete
        ? '[This comment was removed by moderator]'
        : '[This comment was deleted by its author]';
      comment.authorName = '[Deleted]';
      await comment.save();
      return { action: 'tombstoned', comment };
    }

    // Hard delete
    await CommentModel.findByIdAndDelete(id).exec();

    // If this was a reply to a parent, decrement parent's replyCount
    if (comment.parentCommentId) {
      await this.incrementReplyCount(comment.parentCommentId.toString(), -1);
    }

    return { action: 'deleted', comment };
  }

  /**
   * Deletes all comments for a decision (cascade cleanup).
   */
  async deleteByDecisionId(decisionId: string): Promise<number> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return 0;
    }
    const res = await CommentModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount || 0;
  }
}

export const commentRepository = new CommentRepository();
