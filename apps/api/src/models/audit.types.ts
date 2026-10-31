import type { Types } from 'mongoose';

export type AuditAction =
  | 'decision.created'
  | 'decision.updated'
  | 'decision.calculated'
  | 'decision.deleted'
  | 'decision.round_locked'
  | 'decision.round_unlocked'
  | 'sharing.invitation_created'
  | 'sharing.invitation_redeemed'
  | 'sharing.grant_updated'
  | 'sharing.grant_revoked'
  | 'contribution.saved'
  | 'contribution.submitted'
  | 'contribution.withdrawn'
  | 'contribution.adopted'
  | 'evidence.created'
  | 'evidence.updated'
  | 'evidence.deleted'
  | 'ai.analysis_generated'
  | 'ai.proposal_applied'
  | 'disagreement.created'
  | 'disagreement.resolved'
  | 'disagreement.dismissed'
  | 'prediction.created'
  | 'prediction.outcome_verified'
  | 'prediction.disputed'
  | 'snapshot.created'
  | 'export.generated';

export type AuditEntityType =
  | 'decision'
  | 'criterion'
  | 'option'
  | 'score'
  | 'sharing'
  | 'contribution'
  | 'evidence'
  | 'ai'
  | 'disagreement'
  | 'prediction'
  | 'snapshot'
  | 'export';

export interface AuditDiff {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changedFields?: string[];
}

export interface IAuditEvent {
  eventId: string;
  decisionId: Types.ObjectId;
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  diff?: AuditDiff;
  timestamp: Date;
  eventHash: string;
  previousEventHash: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEventDocument extends IAuditEvent {
  _id: Types.ObjectId;
}

export interface AuditEventDto {
  eventId: string;
  decisionId: string;
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  diff?: AuditDiff;
  timestamp: string;
  eventHash: string;
  previousEventHash: string;
  schemaVersion: number;
}

export interface AuditHistoryQueryFilter {
  action?: string;
  entityType?: AuditEntityType;
  actorId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ChainVerificationResultDto {
  decisionId: string;
  isValid: boolean;
  totalEventsChecked: number;
  rootHash: string | null;
  headHash: string | null;
  verifiedAt: string;
  brokenAtEventId?: string;
  reason?: string;
}

