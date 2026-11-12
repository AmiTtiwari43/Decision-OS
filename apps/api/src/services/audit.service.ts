import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  auditRepository,
  decisionRepository,
  userRepository,
} from '../repositories/index.js';
import { DecisionModel, AuditEventModel } from '../models/index.js';
import { authorizeDecisionAction } from './authorization.service.js';
import type { RequesterContext } from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  ConcurrencyFencingError,
} from '../errors/domain.errors.js';
import { runInTransaction, isReplicaSetSupported } from '../db/connection.js';
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
  sequenceNumber?: number;
  session?: mongoose.ClientSession;
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
  sequenceNumber?: number;
}): string {
  const origTs =
    event.originalTimestamp instanceof Date
      ? event.originalTimestamp.toISOString()
      : new Date(event.originalTimestamp).toISOString();
  const appendTs =
    event.timestamp instanceof Date
      ? event.timestamp.toISOString()
      : new Date(event.timestamp).toISOString();

  const payloadToHash: Record<string, unknown> = {
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
    sequenceNumber: event.sequenceNumber !== undefined ? event.sequenceNumber : 1,
    summary: event.summary,
    timestamp: appendTs,
  };

  const canonical = JSON.stringify(canonicalizeJson(payloadToHash));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export class AuditService {
  /**
   * Appends an audit event with SHA-256 hash chaining, authoritative sequence numbers,
   * and session-bound transaction safety.
   *
   * Guarantees:
   * 1. If called within a MongoDB session, all writes participate in that transaction.
   * 2. Authoritative audit head on DecisionModel is conditionally updated.
   * 3. Idempotent on eventId retry.
   * 4. Aborted transactions leave zero partial audit state.
   */
  async recordEvent(
    input: RecordAuditInput,
    explicitSession?: mongoose.ClientSession
  ): Promise<AuditEventDocument> {
    const { decisionId, action, entityType, entityId, summary, diff } = input;
    const eventId = input.eventId || crypto.randomUUID();
    const session = explicitSession || input.session;

    if (!session && isReplicaSetSupported()) {
      return runInTransaction(async (txSession) => {
        return this.recordEvent(input, txSession);
      });
    }

    // 0. Idempotency check: if eventId already committed or in session, return it
    const existing = await AuditEventModel.findOne({ eventId })
      .session(session || null)
      .exec();
    if (existing) {
      return existing;
    }

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

    const originalTimestamp = input.originalTimestamp || new Date();
    const schemaVersion = 1;

    const maxAttempts = session ? 1 : 5; // Inside a session transaction, do not loop internally
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // 1. Read the current authoritative head from DecisionModel
        let currentSequence = 0;
        let previousEventHash = GENESIS_PREVIOUS_HASH;
        let lastTimestamp = 0;

        const decisionDoc = await DecisionModel.findById(decisionId)
          .session(session || null)
          .exec();

        if (!decisionDoc) {
          throw new DecisionNotFoundError(decisionId);
        }

        if (decisionDoc.auditHead && decisionDoc.auditHead.sequenceNumber > 0) {
          currentSequence = decisionDoc.auditHead.sequenceNumber;
          previousEventHash = decisionDoc.auditHead.eventHash || GENESIS_PREVIOUS_HASH;
          if (decisionDoc.auditHead.updatedAt) {
            lastTimestamp = new Date(decisionDoc.auditHead.updatedAt).getTime();
          }
        } else {
          // Fallback if auditHead is not yet populated
          const latestEvent = await auditRepository.getLatestByDecisionId(decisionId, session);
          if (latestEvent) {
            currentSequence = latestEvent.sequenceNumber || 1;
            previousEventHash = latestEvent.eventHash;
            lastTimestamp = new Date(latestEvent.timestamp).getTime();
          }
        }

        const sequenceNumber = input.sequenceNumber || currentSequence + 1;
        const nowMs = Date.now();
        const eventTimestamp =
          input.timestamp ||
          new Date(Math.max(nowMs, lastTimestamp + 1));

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
          sequenceNumber,
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
          sequenceNumber,
          schemaVersion,
        };

        const created = await auditRepository.create(eventPayload, session);

        // 2. Advance authoritative audit head on DecisionModel within the same session
        const headCondition: Record<string, unknown> = {
          _id: decisionDoc._id,
        };

        if (sequenceNumber === 1) {
          headCondition.$or = [
            { 'auditHead.sequenceNumber': 0 },
            { 'auditHead.sequenceNumber': { $exists: false } },
            { auditHead: null },
          ];
        } else {
          headCondition['auditHead.sequenceNumber'] = sequenceNumber - 1;
          headCondition['auditHead.eventHash'] = previousEventHash;
        }

        const headUpdateRes = await DecisionModel.updateOne(
          headCondition,
          {
            $set: {
              auditHead: {
                sequenceNumber,
                eventHash,
                lastEventId: eventId,
                updatedAt: eventTimestamp,
              },
            },
          },
          {
            timestamps: false,
            session,
          }
        ).exec();

        if (headUpdateRes.matchedCount === 0) {
          throw new ConcurrencyFencingError(
            `Audit-head CAS mismatch on decision ${decisionId}: expected prior sequence ${sequenceNumber - 1} with hash ${previousEventHash}, but audit head was modified concurrently`
          );
        }

        return created;
      } catch (err: unknown) {
        const isDuplicateKey =
          err &&
          typeof err === 'object' &&
          ('code' in err || 'errorLabels' in err) &&
          (err as { code?: number }).code === 11000;

        if (isDuplicateKey) {
          const committed = await AuditEventModel.findOne({ eventId })
            .session(session || null)
            .exec();
          if (committed) {
            return committed;
          }
          if (attempt < maxAttempts - 1) {
            await new Promise((res) => setTimeout(res, 10 * (attempt + 1)));
            continue;
          }
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
      sequenceNumber: doc.sequenceNumber || 1,
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
   * Verifies the cryptographic SHA-256 hash chain and monotonic sequence numbers for all events in this decision.
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

    // Order by sequenceNumber or hash chain linkage
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
        sequenceNumber: ev.sequenceNumber,
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

    // 3. Verify authoritative audit head matches chain tip
    if (decision.auditHead && decision.auditHead.sequenceNumber > 0) {
      const tip = events[events.length - 1];
      if (
        decision.auditHead.sequenceNumber !== tip.sequenceNumber ||
        decision.auditHead.eventHash !== tip.eventHash
      ) {
        return {
          decisionId,
          isValid: false,
          totalEventsChecked: events.length,
          rootHash: events[0].eventHash,
          headHash: tip.eventHash,
          verifiedAt: nowIso,
          reason: `Audit head mismatch: decision head sequence ${decision.auditHead.sequenceNumber} (hash ${decision.auditHead.eventHash}) does not match chain tip sequence ${tip.sequenceNumber} (hash ${tip.eventHash})`,
        };
      }
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

  /**
   * Convenience alias for chain verification with { valid, totalEvents, violations }.
   */
  async verifyChain(
    decisionId: string,
    requester?: RequesterContext
  ): Promise<{ valid: boolean; totalEvents: number; violations: string[] }> {
    const res = await this.verifyChainIntegrity(decisionId, requester);
    return {
      valid: res.isValid,
      totalEvents: res.totalEventsChecked,
      violations: res.brokenAtEventId ? [res.reason || `Broken chain at ${res.brokenAtEventId}`] : [],
    };
  }
}

export const auditService = new AuditService();
