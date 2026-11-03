import type { Types } from 'mongoose';
import type { AuditAction, AuditDiff } from './audit.types.js';

export type OperationState =
  | 'PENDING'
  | 'DECISION_MUTATED'
  | 'EVALUATED'
  | 'ENTITIES_UPDATED'
  | 'AUDITED'
  | 'COMPENSATING'
  | 'COMPLETED'
  | 'REVERTED'
  | 'UNRECOVERABLE';

export interface IOperationJournal {
  operationId: string; // UUIDv4 idempotency key
  decisionId: Types.ObjectId;
  action: AuditAction;
  actor: {
    id: string;
    role: string;
    name?: string;
    email?: string;
  };
  expectedVersion: number;
  targetVersion: number;
  compensatingVersion?: number | null;
  payload: Record<string, unknown>;
  previousSnapshot: Record<string, unknown>;
  auditDraft: {
    eventId: string;
    entityType: string;
    entityId: string;
    summary: string;
    diff: AuditDiff;
  };
  state: OperationState;

  // Lease and Fencing Metadata (F4-08)
  recoveryOwner: string | null;
  leaseExpiresAt: Date | null;
  fencingToken: number;
  heartbeatAt: Date;
  retryCount: number;
  errorDetails?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface OperationJournalDocument extends IOperationJournal {
  _id: Types.ObjectId;
}
