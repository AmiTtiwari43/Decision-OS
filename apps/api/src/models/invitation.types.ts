import type { Types } from 'mongoose';
import type { DecisionCollaboratorRole } from './decisionAccess.types.js';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface IDecisionInvitation {
  decisionId: Types.ObjectId;
  inviterId: Types.ObjectId;
  email: string;
  role: DecisionCollaboratorRole;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: Types.ObjectId | null;
  revokedAt: Date | null;
  revokedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionInvitationDocument extends IDecisionInvitation {
  _id: Types.ObjectId;
}

export interface CreateInvitationInput {
  decisionId: string | Types.ObjectId;
  inviterId: string | Types.ObjectId;
  email: string;
  role: DecisionCollaboratorRole;
  tokenHash: string;
  expiresAt?: Date;
}
