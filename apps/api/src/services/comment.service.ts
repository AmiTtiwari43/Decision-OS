import mongoose from 'mongoose';
import {
  commentRepository,
  decisionRepository,
  contributionRepository,
  type ListCommentsFilter,
} from '../repositories/index.js';
import {
  authorizeDecisionAction,
  getDecisionRole,
} from './authorization.service.js';
import { auditService } from './audit.service.js';
import { collaborationService } from './collaboration.service.js';
import type { RequesterContext } from './decision.service.js';
import {
  UserModel,
  type CommentDocument,
  type CreateCommentInput,
  type UpdateCommentInput,
  type ResolveCommentInput,
} from '../models/index.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  CommentNotFoundError,
  CommentDepthExceededError,
  InvalidCommentResolutionError,
  InvalidCommentTargetError,
  InvalidOptionReferenceError,
  InvalidCriterionReferenceError,
  DecisionQuarantinedError,
  ForbiddenError,
} from '../errors/domain.errors.js';

export class CommentService {
  /**
   * Creates a root comment or a single-level reply on a decision.
   */
  async createComment(
    decisionId: string,
    input: CreateCommentInput,
    requester: RequesterContext
  ): Promise<CommentDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    const authorRole = await authorizeDecisionAction(decision, 'comment_create', requester);

    let targetType = input.targetType;
    let targetId = input.targetId;
    let cellCoordinates = input.cellCoordinates;
    let parentCommentId: string | null = null;

    if (input.parentCommentId) {
      // ─── Reply Handling ────────────────────────────────────────────────────────
      if (!mongoose.isValidObjectId(input.parentCommentId)) {
        throw new CommentNotFoundError('Parent comment not found');
      }

      const parentComment = await commentRepository.findById(input.parentCommentId);
      if (!parentComment) {
        throw new CommentNotFoundError('Parent comment not found');
      }

      // Same-decision boundary check
      if (parentComment.decisionId.toString() !== decisionId) {
        throw new InvalidCommentTargetError('Parent comment does not belong to this decision');
      }

      // Single-level depth check: parent must be a root comment
      if (parentComment.parentCommentId) {
        throw new CommentDepthExceededError();
      }

      // Target congruency: if supplied by client, must match parent exactly
      if (targetType && targetType !== parentComment.targetType) {
        throw new InvalidCommentTargetError('Reply targetType does not match root comment');
      }
      if (targetId && targetId !== parentComment.targetId) {
        throw new InvalidCommentTargetError('Reply targetId does not match root comment');
      }
      if (cellCoordinates) {
        if (
          !parentComment.cellCoordinates ||
          cellCoordinates.optionId !== parentComment.cellCoordinates.optionId ||
          cellCoordinates.criterionId !== parentComment.cellCoordinates.criterionId
        ) {
          throw new InvalidCommentTargetError('Reply cellCoordinates do not match root comment');
        }
      }

      // Anchor reply target to parent comment's target scope
      targetType = parentComment.targetType;
      targetId = parentComment.targetId;
      cellCoordinates = parentComment.cellCoordinates;
      parentCommentId = parentComment._id.toString();
    } else {
      // ─── Root Comment Target Validation ────────────────────────────────────────
      if (!targetType) {
        throw new InvalidCommentTargetError('targetType is required for root comments');
      }
      if (!targetId) {
        throw new InvalidCommentTargetError('targetId is required for root comments');
      }

      switch (targetType) {
        case 'decision':
          // Valid target
          break;

        case 'option': {
          const optionExists = decision.options.some((o) => o.id === targetId);
          if (!optionExists) {
            throw new InvalidOptionReferenceError(targetId);
          }
          break;
        }

        case 'criterion': {
          const criterionExists = decision.criteria.some((c) => c.id === targetId);
          if (!criterionExists) {
            throw new InvalidCriterionReferenceError(targetId);
          }
          break;
        }

        case 'cell': {
          if (!cellCoordinates || !cellCoordinates.optionId || !cellCoordinates.criterionId) {
            throw new InvalidCommentTargetError('cellCoordinates are required for cell comments');
          }
          const coords = cellCoordinates;
          const optExists = decision.options.some((o) => o.id === coords.optionId);
          if (!optExists) {
            throw new InvalidOptionReferenceError(coords.optionId);
          }
          const critExists = decision.criteria.some((c) => c.id === coords.criterionId);
          if (!critExists) {
            throw new InvalidCriterionReferenceError(coords.criterionId);
          }
          break;
        }

        case 'contribution': {
          if (!mongoose.isValidObjectId(targetId)) {
            throw new InvalidCommentTargetError(`Contribution '${targetId}' does not exist in this decision`);
          }
          const contrib = await contributionRepository.findById(targetId);
          if (!contrib || contrib.decisionId.toString() !== decisionId) {
            throw new InvalidCommentTargetError(`Contribution '${targetId}' does not exist in this decision`);
          }
          break;
        }

        default:
          throw new InvalidCommentTargetError(`Unsupported targetType: ${targetType}`);
      }
    }

    let authorName = requester.name;
    if (!authorName) {
      const userDoc = await UserModel.findById(requester.id).select('name').lean();
      authorName = userDoc?.name || 'Anonymous';
    }

    const comment = await commentRepository.create({
      decisionId,
      authorId: requester.id,
      authorName,
      authorRole,
      targetType: targetType!,
      targetId: targetId!,
      cellCoordinates,
      content: input.content.trim(),
      parentCommentId,
    });

    if (parentCommentId) {
      await commentRepository.incrementReplyCount(parentCommentId, 1);
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'comment.created',
      entityType: 'decision',
      entityId: comment._id.toString(),
      summary: `Posted comment on ${targetType} "${targetId}"`,
      diff: {
        after: {
          targetType,
          targetId,
          isReply: Boolean(parentCommentId),
        },
      },
    });

    collaborationService.publishEvent(decisionId, {
      type: 'comment.created',
      decisionId,
      version: decision.version || 1,
      actorId: requester.id,
      actorName: authorName,
      payload: {
        commentId: comment._id.toString(),
        targetType,
        targetId,
        parentCommentId,
      },
    });

    return comment;
  }

  /**
   * Lists comments for a decision with optional filters.
   */
  async listComments(
    decisionId: string,
    filter?: ListCommentsFilter,
    requester?: RequesterContext
  ): Promise<CommentDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    return commentRepository.listByDecision(decisionId, filter);
  }

  /**
   * Retrieves a single comment by ID.
   */
  async getComment(
    decisionId: string,
    commentId: string,
    requester?: RequesterContext
  ): Promise<CommentDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(commentId)) {
      throw new CommentNotFoundError();
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const comment = await commentRepository.findById(commentId);
    if (!comment || comment.decisionId.toString() !== decisionId) {
      throw new CommentNotFoundError();
    }

    return comment;
  }

  /**
   * Updates comment content (Author only).
   */
  async updateComment(
    decisionId: string,
    commentId: string,
    input: UpdateCommentInput,
    requester: RequesterContext
  ): Promise<CommentDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(commentId)) {
      throw new CommentNotFoundError();
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const comment = await commentRepository.findById(commentId);
    if (!comment || comment.decisionId.toString() !== decisionId) {
      throw new CommentNotFoundError();
    }

    if (comment.isDeleted) {
      throw new ForbiddenError('Cannot edit a deleted or tombstoned comment');
    }

    // Only author can edit their own comment
    if (comment.authorId !== requester.id && requester.role !== 'admin') {
      throw new ForbiddenError('You can only edit your own comments');
    }

    const updated = await commentRepository.updateContent(commentId, input.content.trim());
    if (!updated) {
      throw new CommentNotFoundError();
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'comment.updated',
      entityType: 'decision',
      entityId: commentId,
      summary: 'Updated comment content',
    });

    return updated;
  }

  /**
   * Deletes a comment or replaces it with a tombstone if it has child replies.
   */
  async deleteComment(
    decisionId: string,
    commentId: string,
    requester: RequesterContext
  ): Promise<{ action: 'deleted' | 'tombstoned'; comment: CommentDocument | null }> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(commentId)) {
      throw new CommentNotFoundError();
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const comment = await commentRepository.findById(commentId);
    if (!comment || comment.decisionId.toString() !== decisionId) {
      throw new CommentNotFoundError();
    }

    const role = await getDecisionRole(decision, requester);
    const isOwnerOrAdmin = role === 'owner' || requester.role === 'admin';
    const isAuthor = comment.authorId === requester.id;

    if (!isAuthor && !isOwnerOrAdmin) {
      throw new ForbiddenError('Insufficient permissions to delete this comment');
    }

    const isModeratorDelete = isOwnerOrAdmin && !isAuthor;

    const result = await commentRepository.deleteOrTombstone(commentId, isModeratorDelete);

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'comment.deleted',
      entityType: 'decision',
      entityId: commentId,
      summary: isModeratorDelete
        ? 'Moderator removed collaborator comment'
        : 'Author deleted comment',
      diff: {
        after: {
          tombstoned: result.action === 'tombstoned',
        },
      },
    });

    return result;
  }

  /**
   * Resolves or reopens a discussion thread (Root comment only; Owner or Editor only).
   */
  async resolveThread(
    decisionId: string,
    commentId: string,
    input: ResolveCommentInput,
    requester: RequesterContext
  ): Promise<CommentDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(commentId)) {
      throw new CommentNotFoundError();
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'comment_resolve', requester);

    const comment = await commentRepository.findById(commentId);
    if (!comment || comment.decisionId.toString() !== decisionId) {
      throw new CommentNotFoundError();
    }

    // Thread resolution is strictly restricted to root comments
    if (comment.parentCommentId) {
      throw new InvalidCommentResolutionError();
    }

    const resolvedBy = input.isResolved
      ? { id: requester.id, name: requester.name || requester.email || 'User' }
      : null;

    const updated = await commentRepository.resolveThread(
      commentId,
      input.isResolved,
      resolvedBy
    );

    if (!updated) {
      throw new CommentNotFoundError();
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'comment.resolved',
      entityType: 'decision',
      entityId: commentId,
      summary: input.isResolved
        ? 'Resolved discussion thread'
        : 'Reopened discussion thread',
      diff: {
        after: {
          isResolved: input.isResolved,
        },
      },
    });

    collaborationService.publishEvent(decisionId, {
      type: 'comment.resolved',
      decisionId,
      version: decision.version || 1,
      actorId: requester.id,
      actorName: requester.name || requester.email,
      payload: {
        commentId,
        isResolved: input.isResolved,
      },
    });

    return updated;
  }
}

export const commentService = new CommentService();
