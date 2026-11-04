export type CollaborationEventType =
  | 'decision.updated'
  | 'decision.calculation.updated'
  | 'contribution.submitted'
  | 'contribution.adopted'
  | 'contribution.rejected'
  | 'comment.created'
  | 'comment.resolved'
  | 'evidence.created'
  | 'disagreement.resolved'
  | 'participant.joined'
  | 'participant.left'
  | 'presence.sync'
  | 'decision.conflict'
  | 'decision.quarantine_resolved'
  | 'sync_required';

export interface CollaborationEvent<T = unknown> {
  eventId: string;
  type: CollaborationEventType;
  decisionId: string;
  version: number;
  actorId?: string;
  actorName?: string;
  timestamp: string;
  payload: T;
}

export interface ParticipantPresence {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer' | 'contributor';
  status: 'active' | 'idle';
  currentView?: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface PresenceSyncPayload {
  participants: ParticipantPresence[];
}

export interface DecisionConflictPayload {
  currentVersion: number;
  expectedVersion?: number;
  modifiedBy?: string;
  message: string;
}
