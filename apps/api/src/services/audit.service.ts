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
  eventId?: string;
  originalTimestamp?: Date;
  timestamp?: Date;
}

function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson);
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson((obj as Record<string, unknown>)[key]);
  }
  return result;
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
  originalTimestamp: Date | string;
  timestamp: Date | string;
  previousEventHash: string;
  schemaVersion: number;
}): string {
  const origTs =
    event.originalTimestamp instanceof Date
      ? event.originalTimestamp.toISOString()
      : new Date(event.originalTimestamp).toISOString();
  const appendTs =
    event.timestamp instanceof Date
      ? event.timestamp.toISOString()
      : new Date(event.timestamp).toISOString();

  const canonical = JSON.stringify(
    canonicalizeJson({
      action: event.action,
      actorId: event.actorId,
      decisionId: event.decisionId,
      diff: event.diff ?? null,
      entityId: event.entityId,
      entityType: event.entityType,
      eventId: event.eventId,
      originalTimestamp: origTs,
      previousEventHash: event.previousEventHash,
      schemaVersion: event.schemaVersion || 1,
      summary: event.summary,
      timestamp: appendTs,
    })
  );

  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export class AuditService {
  /**
   * Appends an audit event with SHA-256 hash chaining and dual timestamps.
   * Guarantees chronological tamper-evidence, preserves stable identity across retries,
   * and enforces strict monotonicity.
   */
  async recordEvent(input: RecordAuditInput): Promise<AuditEventDocument> {
    const { decisionId, action, entityType, entityId, summary, diff } = input;
    const eventId = input.eventId || crypto.randomUUID();
    const originalTimestamp = input.originalTimestamp || new Date();

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

    // Determine previousEventHash from the latest audit record for this decision with retry on concurrent contention
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const latestEvent = await auditRepository.getLatestByDecisionId(decisionId);
        const previousEventHash = latestEvent?.eventHash || GENESIS_PREVIOUS_HASH;
        const schemaVersion = 1;

        // Sequence timestamp: strictly monotonic chain append time
        const eventTimestamp =
          input.timestamp ||
          (latestEvent
            ? new Date(Math.max(Date.now(), latestEvent.timestamp.getTime() + 1))
            : new Date());

        const eventHash = computeCanonicalEventHash({
          eventId,
          decisionId,
          actorId,
          action,
          entityType,
          entityId,
          summary,
          diff,
          originalTimestamp,
          timestamp: eventTimestamp,
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
          originalTimestamp,
          timestamp: eventTimestamp,
          eventHash,
          previousEventHash,
          schemaVersion,
        };

        return await auditRepository.create(eventPayload);
      } catch (err: unknown) {
        // If MongoDB duplicate key on { decisionId, previousEventHash } occurred due to concurrent writes, retry with new chain head
        const isDuplicateKey =
          err &&
          typeof err === 'object' &&
          ('code' in err || 'errorLabels' in err) &&
          (err as { code?: number }).code === 11000;
        if (isDuplicateKey && attempt < maxAttempts - 1) {
          await new Promise((res) => setTimeout(res, 10 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Failed to record audit event for decision ${decisionId} after ${maxAttempts} attempts.`
    );
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

    const dtos: AuditEventDto[] = items.map((doc) => ({
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
      originalTimestamp: (doc.originalTimestamp || doc.timestamp).toISOString(),
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

    const rawEvents = await auditRepository.getAllForDecision(decisionId);
    const nowIso = new Date().toISOString();

    if (rawEvents.length === 0) {
      return {
        decisionId,
        isValid: true,
        totalEventsChecked: 0,
        rootHash: null,
        headHash: null,
        verifiedAt: nowIso,
      };
    }

    // Order by cryptographic chain linkage if a complete chain exists, protecting against millisecond sort ties
    const eventsByPrev = new Map<string, AuditEventDocument>();
    for (const ev of rawEvents) {
      eventsByPrev.set(ev.previousEventHash, ev);
    }
    const chainedEvents: AuditEventDocument[] = [];
    let curHash = GENESIS_PREVIOUS_HASH;
    while (eventsByPrev.has(curHash)) {
      const nextEv = eventsByPrev.get(curHash)!;
      chainedEvents.push(nextEv);
      curHash = nextEv.eventHash;
    }
    const events = chainedEvents.length === rawEvents.length ? chainedEvents : rawEvents;

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
        originalTimestamp: ev.originalTimestamp || ev.timestamp,
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
