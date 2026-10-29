import type { Types } from 'mongoose';

export type DecisionCollaboratorRole = 'editor' | 'viewer';

export interface IDecisionAccessGrant {
  decisionId: Types.ObjectId;
  userId: Types.ObjectId;
  role: DecisionCollaboratorRole;
  grantedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionAccessGrantDocument extends IDecisionAccessGrant {
  _id: Types.ObjectId;
}

export interface CreateDecisionAccessGrantInput {
  decisionId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  role: DecisionCollaboratorRole;
  grantedBy: string | Types.ObjectId;
}

export interface UpdateDecisionAccessGrantInput {
  role: DecisionCollaboratorRole;
}
