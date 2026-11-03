import type { Types } from 'mongoose';

export type CommentTargetType = 'decision' | 'option' | 'criterion' | 'cell' | 'contribution';

export interface CommentCellCoordinates {
  optionId: string;
  criterionId: string;
}

export interface IComment {
  decisionId: Types.ObjectId;
  authorId: string;
  authorName: string;
  authorRole: 'owner' | 'editor' | 'contributor' | 'viewer';
  targetType: CommentTargetType;
  targetId: string;
  cellCoordinates?: CommentCellCoordinates | null;
  content: string; // 1 to 2000 chars, trimmed
  parentCommentId?: Types.ObjectId | null;
  isResolved: boolean;
  resolvedBy?: { id: string; name: string } | null;
  resolvedAt?: Date | null;
  isDeleted: boolean;
  deletedAt?: Date | null;
  editedAt?: Date | null;
  replyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentDocument extends IComment {
  _id: Types.ObjectId;
}

export interface CommentDto {
  id: string;
  decisionId: string;
  authorId: string;
  authorName: string;
  authorRole: 'owner' | 'editor' | 'contributor' | 'viewer';
  targetType: CommentTargetType;
  targetId: string;
  cellCoordinates?: CommentCellCoordinates | null;
  content: string;
  parentCommentId: string | null;
  isResolved: boolean;
  resolvedBy?: { id: string; name: string } | null;
  resolvedAt?: string | null;
  isDeleted: boolean;
  deletedAt?: string | null;
  editedAt?: string | null;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  targetType?: CommentTargetType;
  targetId?: string;
  cellCoordinates?: CommentCellCoordinates | null;
  content: string;
  parentCommentId?: string | null;
}

export interface UpdateCommentInput {
  content: string;
}

export interface ResolveCommentInput {
  isResolved: boolean;
}
