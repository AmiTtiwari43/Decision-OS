import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  auditRepository,
  decisionRepository,
  userRepository,
} from '../repositories/index.js';
import { authorizeDecisionAction } from './authorization.service.js';
import type { RequesterContext } from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
} from '../errors/domain.errors.js';
import type {
  AuditAction,
  AuditEntityType,
  AuditDiff,
  AuditEventDto,
  AuditHistoryQueryFilter,
  ChainVerificationResultDto,
  IAuditEvent,
  AuditEventDocument,
} from '../models/index.js';

export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

export interface RecordAuditInput {
  decisionId: string;
  actor?: RequesterContext | string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  diff?: AuditDiff;
  timestamp?: Date;
}

export function computeCanonicalEventHash(event: {
  eventId: string;
  decisionId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  diff?: AuditDiff | null;
  timestamp: Date | string;
  previousEventHash: string;
  schemaVersion: number;
}): string {
  const ts = event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date(event.timestamp).toISOString();
  const canonical = JSON.stringify({
    action: event.action,
    actorId: event.actorId,
    decisionId: event.decisionId,
    diff: event.diff ?? null,
    entityId: event.entityId,
    entityType: event.entityType,
    eventId: event.eventId,
    previousEventHash: event.previousEventHash,
    schemaVersion: event.schemaVersion || 1,
    summary: event.summary,
    timestamp: ts,
  });

  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export class AuditService {
  /**
   * Appends an audit event with SHA-256 hash chaining to guarantee chronological tamper-evidence.
   */
  async recordEvent(input: RecordAuditInput): Promise<AuditEventDocument> {
    const { decisionId, action, entityType, entityId, summary, diff } = input;
    const eventId = crypto.randomUUID();
    const timestamp = input.timestamp || new Date();

    let actorId = 'system';
    let actorEmail: string | undefined;
    let actorName: string | undefined;

    if (input.actor) {
      if (typeof input.actor === 'string') {
        actorId = input.actor;
      } else {
        actorId = input.actor.id || 'system';
        actorEmail = input.actor.email;
        actorName = input.actor.name;
      }
    }

    // Attempt to enrich actor details if email is missing and actorId is an ObjectId
    if (!actorEmail && mongoose.isValidObjectId(actorId)) {
      try {
        const user = await userRepository.findById(actorId);
        if (user) {
          actorEmail = user.email;
          actorName = user.name;
        }
      } catch {
        // Tolerant on user lookup failure
      }
    }

    // Determine previousEventHash from the latest audit record for this decision
    const latestEvent = await auditRepository.getLatestByDecisionId(decisionId);
    const previousEventHash = latestEvent?.eventHash || GENESIS_PREVIOUS_HASH;
    const schemaVersion = 1;

    const eventHash = computeCanonicalEventHash({
      eventId,
      decisionId,
      actorId,
      action,
      entityType,
      entityId,
      summary,
      diff,
      timestamp,
      previousEventHash,
      schemaVersion,
    });

    const eventPayload: Omit<IAuditEvent, 'createdAt' | 'updatedAt'> = {
      eventId,
      decisionId: new mongoose.Types.ObjectId(decisionId),
      actorId,
      actorEmail,
      actorName,
      action,
      entityType,
      entityId,
      summary,
      diff,
      timestamp,
      eventHash,
      previousEventHash,
      schemaVersion,
    };

    return auditRepository.create(eventPayload);
  }

  /**
   * Retrieves paginated audit history for a decision. Enforces decision read access.
   */
  async getDecisionHistory(
    decisionId: string,
    filter?: AuditHistoryQueryFilter,
    pagination?: { page?: number; limit?: number },
    requester?: RequesterContext
  ): Promise<{ items: AuditEventDto[]; total: number; page: number; limit: number; hasMore: boolean }> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const page = Math.max(1, pagination?.page ?? 1);
    const limit = Math.min(200, Math.max(1, pagination?.limit ?? 50));

    const { items, total } = await auditRepository.listByDecisionId(
      decisionId,
      filter,
      { page, limit }
    );

    const dtos: AuditEventDto[] = items.map(doc => ({
      eventId: doc.eventId,
      decisionId: doc.decisionId.toString(),
      actorId: doc.actorId,
      actorEmail: doc.actorEmail,
      actorName: doc.actorName,
      action: doc.action,
      entityType: doc.entityType,
      entityId: doc.entityId,
      summary: doc.summary,
      diff: doc.diff,
      timestamp: doc.timestamp.toISOString(),
      eventHash: doc.eventHash,
      previousEventHash: doc.previousEventHash,
      schemaVersion: doc.schemaVersion,
    }));

    return {
      items: dtos,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  /**
   * Verifies the cryptographic SHA-256 hash chain for all events in this decision.
   */
  async verifyChainIntegrity(
    decisionId: string,
    requester?: RequesterContext
  ): Promise<ChainVerificationResultDto> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const events = await auditRepository.getAllForDecision(decisionId);
    const nowIso = new Date().toISOString();

    if (events.length === 0) {
      return {
        decisionId,
        isValid: true,
        totalEventsChecked: 0,
        rootHash: null,
        headHash: null,
        verifiedAt: nowIso,
      };
    }

    let expectedPrevHash = GENESIS_PREVIOUS_HASH;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];

      // 1. Check previous hash linkage
      if (ev.previousEventHash !== expectedPrevHash) {
        return {
          decisionId,
          isValid: false,
          totalEventsChecked: i,
          rootHash: events[0].eventHash,
          headHash: i > 0 ? events[i - 1].eventHash : null,
          verifiedAt: nowIso,
          brokenAtEventId: ev.eventId,
          reason: `Previous hash linkage broken at event index ${i}: expected "${expectedPrevHash}", found "${ev.previousEventHash}"`,
        };
      }

      // 2. Re-compute canonical hash
      const computedHash = computeCanonicalEventHash({
        eventId: ev.eventId,
        decisionId: ev.decisionId.toString(),
        actorId: ev.actorId,
        action: ev.action,
        entityType: ev.entityType,
        entityId: ev.entityId,
        summary: ev.summary,
        diff: ev.diff,
        timestamp: ev.timestamp,
        previousEventHash: ev.previousEventHash,
        schemaVersion: ev.schemaVersion,
      });

      if (computedHash !== ev.eventHash) {
        return {
          decisionId,
          isValid: false,
          totalEventsChecked: i,
          rootHash: events[0].eventHash,
          headHash: i > 0 ? events[i - 1].eventHash : null,
          verifiedAt: nowIso,
          brokenAtEventId: ev.eventId,
          reason: `Content hash verification failed at event index ${i}: expected "${computedHash}", recorded "${ev.eventHash}"`,
        };
      }

      expectedPrevHash = ev.eventHash;
    }

    return {
      decisionId,
      isValid: true,
      totalEventsChecked: events.length,
      rootHash: events[0].eventHash,
      headHash: events[events.length - 1].eventHash,
      verifiedAt: nowIso,
    };
  }
}

export const auditService = new AuditService();

