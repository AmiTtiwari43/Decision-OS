import type { Types } from 'mongoose';

export type ContributionStatus =
  | 'draft'
  | 'submitted'
  | 'withdrawn'
  | 'adopted'
  | 'rejected';

export interface IContributionPrediction {
  statement?: string;
  targetDate?: Date;
  probability?: number; // 0..1
}

export interface IContributionRecommendation {
  preferredOptionId: string;
  rationale?: string;
}

export interface IContributionRevisionSnapshot {
  revision: number;
  submittedAt: Date;
  recommendation: IContributionRecommendation;
  criterionScores: Record<string, number>;
  criterionReasoning?: Record<string, string>;
  confidence?: number;
  prediction?: IContributionPrediction;
}

export interface IDecisionContribution {
  decisionId: Types.ObjectId;
  contributorId: Types.ObjectId;
  recommendation: IContributionRecommendation;
  criterionScores: Record<string, number>; // criterionId -> score (0..100)
  criterionReasoning: Record<string, string>; // criterionId -> reasoning
  confidence: number; // 0..1
  prediction?: IContributionPrediction;
  evidenceReferences?: string[];
  status: ContributionStatus;
  revision: number;
  history: IContributionRevisionSnapshot[];
  submittedAt: Date | null;
  withdrawnAt: Date | null;
  adoptedAt?: Date | null;
  adoptedBy?: string | null;
  adoptedOptionId?: string | null;
  adoptedOperationId?: string | null;
  adoptedDecisionVersion?: number | null;
  adoptedFencingToken?: number | null;
  adoptedRevision?: number | null;
  rejectionReason?: string | null;
  rejectedAt?: Date | null;
  rejectedBy?: { id: string; name?: string; role?: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionContributionDocument extends IDecisionContribution {
  _id: Types.ObjectId;
}

export interface SaveContributionInput {
  preferredOptionId: string;
  rationale?: string;
  criterionScores?: Record<string, number>;
  criterionReasoning?: Record<string, string>;
  confidence?: number;
  prediction?: IContributionPrediction;
  evidenceReferences?: string[];
}

export interface AdoptContributionInput {
  expectedVersion: number;
  confirmation: boolean;
  selectedCriterionIds?: string[];
}

export interface RejectContributionInput {
  rejectionReason: string;
}
