import type { Types } from 'mongoose';
import type { EngineResult } from '@decision-os/decision-engine';

export type CriterionDirection = 'benefit' | 'cost';

export type AuditIntegrityStatus = 'healthy' | 'pending_reconciliation' | 'quarantined';

export interface DecisionCriterion {
  id: string;
  name: string;
  shortName?: string;
  weight: number;
  direction: CriterionDirection;
  isLocked?: boolean;
}

export interface DecisionOption {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  color?: string;
}

/**
 * Nested map of optionId -> criterionId -> score (0..100).
 */
export type ScoreMatrix = Record<string, Record<string, number>>;

export interface DecisionAuditHead {
  sequenceNumber: number;
  eventHash: string;
  lastEventId?: string;
  updatedAt?: Date;
}

export interface IDecision {
  title: string;
  description: string;
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  scores: ScoreMatrix;
  analysis: EngineResult | null;
  calculationVersion: number;
  version: number;
  ownerId?: Types.ObjectId | null;
  isContributionRoundLocked?: boolean;
  contributionRoundLockedAt?: Date | null;
  isAudited?: boolean;
  auditIntegrityStatus?: AuditIntegrityStatus;
  pendingOperationId?: string | null;
  quarantineReason?: string | null;
  recoveryFencingToken?: number;
  recoveryOwner?: string | null;
  recoveryLeaseExpiresAt?: Date | null;
  auditHead?: DecisionAuditHead | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionDocument extends IDecision {
  _id: Types.ObjectId;
}

export interface DecisionDto {
  id: string;
  title: string;
  description: string;
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  scores: ScoreMatrix;
  analysis: EngineResult | null;
  calculationVersion: number;
  version: number;
  ownerId?: string | null;
  isContributionRoundLocked?: boolean;
  contributionRoundLockedAt?: string | null;
  currentUserRole?: string;
  isAudited: boolean;
  auditIntegrityStatus: AuditIntegrityStatus;
  pendingOperationId: string | null;
  quarantineReason?: string | null;
  auditHead?: DecisionAuditHead | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionInput {
  title: string;
  description?: string;
  criteria?: DecisionCriterion[];
  options?: DecisionOption[];
  scores?: ScoreMatrix;
  analysis?: EngineResult | null;
  calculationVersion?: number;
  version?: number;
  ownerId?: Types.ObjectId | string | null;
  isContributionRoundLocked?: boolean;
  contributionRoundLockedAt?: Date | null;
  isAudited?: boolean;
  auditIntegrityStatus?: AuditIntegrityStatus;
  pendingOperationId?: string | null;
  quarantineReason?: string | null;
  auditHead?: DecisionAuditHead | null;
}

export interface UpdateDecisionInput {
  title?: string;
  description?: string;
  criteria?: DecisionCriterion[];
  options?: DecisionOption[];
  scores?: ScoreMatrix;
  analysis?: EngineResult | null;
  calculationVersion?: number;
  version?: number;
  expectedVersion?: number;
  ownerId?: Types.ObjectId | string | null;
  isContributionRoundLocked?: boolean;
  contributionRoundLockedAt?: Date | null;
  isAudited?: boolean;
  auditIntegrityStatus?: AuditIntegrityStatus;
  pendingOperationId?: string | null;
  quarantineReason?: string | null;
  auditHead?: DecisionAuditHead | null;
}
