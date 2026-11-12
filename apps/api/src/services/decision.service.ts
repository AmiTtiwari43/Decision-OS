import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { evaluateDecision, ValidationError } from '@decision-os/decision-engine';
import type {
  EngineEvaluationInput,
  EngineResult,
} from '@decision-os/decision-engine';
import { decisionRepository } from '../repositories/decision.repository.js';
import { operationJournalRepository } from '../repositories/operationJournal.repository.js';
import { decisionAccessRepository } from '../repositories/decisionAccess.repository.js';
import { invitationRepository } from '../repositories/invitation.repository.js';
import { contributionRepository } from '../repositories/contribution.repository.js';
import { evidenceRepository } from '../repositories/evidence.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import {
  authorizeDecisionAction,
  type DecisionRole,
} from './authorization.service.js';
import { auditService } from './audit.service.js';
import { outboxService } from './outbox.service.js';
import { runInTransaction, isReplicaSetSupported } from '../db/connection.js';
import { collaborationService } from './collaboration.service.js';
import { evaluationCache } from './evaluationCache.js';
import {
  DecisionModel,
  OperationJournalModel,
  type DecisionCriterion,
  type DecisionOption,
  type ScoreMatrix,
  type ScoreProvenanceMap,
  type DecisionDocument,
} from '../models/index.js';
import type { ListDecisionsFilter, PaginationOptions, PaginatedResult } from '../repositories/decision.repository.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  IncompleteScoresError,
  SyntheticScoresPresentError,
  EngineValidationError,
  DecisionConflictError,
  DecisionQuarantinedError,
  InvalidProvenanceTransitionError,
  CoordinateNotSyntheticError,
  InvalidScoreCoordinateError,
} from '../errors/domain.errors.js';
import type { MissingScorePair } from '../errors/domain.errors.js';
import type { ReplaceSyntheticScoreInput } from '../models/index.js';

export interface RequesterContext {
  id: string;
  role?: 'user' | 'admin' | string;
  email?: string;
  name?: string;
}

/**
 * Returns every option–criterion pair whose score is missing or out-of-range.
 * A decision is "complete" when:
 *  - it has at least 1 criterion AND at least 1 option, AND
 *  - every scores[optionId][criterionId] exists and is a finite number in [0, 100].
 */
export function validateCompleteness(
  criteria: DecisionCriterion[],
  options: DecisionOption[],
  scores: ScoreMatrix
): MissingScorePair[] {
  if (criteria.length === 0 || options.length === 0) {
    // Return one synthetic pair per option per criterion so callers have context
    const pairs: MissingScorePair[] = [];
    for (const opt of options) {
      for (const crit of criteria) {
        pairs.push({ optionId: opt.id, criterionId: crit.id });
      }
    }
    // If either list is empty, completeness check fails — surface at least one marker
    if (pairs.length === 0) {
      return [{ optionId: '(none)', criterionId: '(none)' }];
    }
    return pairs;
  }

  const missing: MissingScorePair[] = [];
  for (const opt of options) {
    for (const crit of criteria) {
      const score = scores[opt.id]?.[crit.id];
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
        missing.push({ optionId: opt.id, criterionId: crit.id });
      }
    }
  }
  return missing;
}

/**
 * Returns every option–criterion pair whose score has synthetic demo provenance.
 */
export function getSyntheticScoreCoordinates(
  criteria: DecisionCriterion[],
  options: DecisionOption[],
  scoreProvenance?: ScoreProvenanceMap
): MissingScorePair[] {
  if (!scoreProvenance || typeof scoreProvenance !== 'object') return [];
  const synthetics: MissingScorePair[] = [];
  for (const opt of options) {
    for (const crit of criteria) {
      if (scoreProvenance[opt.id]?.[crit.id]?.isSynthetic === true) {
        synthetics.push({ optionId: opt.id, criterionId: crit.id });
      }
    }
  }
  return synthetics;
}

/**
 * Safely merges incoming score provenance with persisted score provenance.
 * Server Invariant (Batch 02-R3 Finding A):
 * Once a coordinate has been persisted as synthetic:
 * - Ordinary updates must preserve its synthetic status.
 * - Omitting provenance must not clear the persisted flag.
 * - Changing isSynthetic from true to false must not be accepted as a normal update.
 * - Unrelated score or criteria changes must not erase provenance.
 * - Synthetic status can ONLY be converted to a verified assessment via explicit replacement.
 */
export function mergeScoreProvenance(
  persistedProvenance: ScoreProvenanceMap | undefined,
  incomingProvenance: ScoreProvenanceMap | undefined,
  criteria: DecisionCriterion[],
  options: DecisionOption[]
): ScoreProvenanceMap {
  const merged: ScoreProvenanceMap = {};
  const validOptionIds = new Set(options.map(o => o.id));
  const validCriterionIds = new Set(criteria.map(c => c.id));

  // 1. Strictly preserve all persisted synthetic coordinates that still exist in options & criteria
  if (persistedProvenance && typeof persistedProvenance === 'object') {
    for (const [optId, critMap] of Object.entries(persistedProvenance)) {
      if (!validOptionIds.has(optId)) continue;
      for (const [critId, prov] of Object.entries(critMap || {})) {
        if (!validCriterionIds.has(critId)) continue;
        if (prov && prov.isSynthetic === true) {
          if (!merged[optId]) merged[optId] = {};
          merged[optId][critId] = {
            isSynthetic: true,
            source: prov.source || 'demo',
            insertedAt: prov.insertedAt || new Date().toISOString(),
          };
        }
      }
    }
  }

  // 2. Reject client attempts to inject new synthetic coordinates via ordinary update (Finding A / Section 2)
  if (incomingProvenance && typeof incomingProvenance === 'object') {
    for (const [optId, critMap] of Object.entries(incomingProvenance)) {
      if (!validOptionIds.has(optId)) continue;
      for (const [critId, prov] of Object.entries(critMap || {})) {
        if (!validCriterionIds.has(critId)) continue;
        if (prov && prov.isSynthetic === true) {
          const wasAlreadySynthetic = persistedProvenance?.[optId]?.[critId]?.isSynthetic === true;
          if (!wasAlreadySynthetic) {
            throw new InvalidProvenanceTransitionError(
              `Cannot inject new synthetic score provenance for coordinate (${optId}, ${critId}) via ordinary update. Use POST /api/decisions/:id/populate-synthetic-demo.`
            );
          }
        }
      }
    }
  }

  return merged;
}

/**
 * Maps DB model types to the engine's input format.
 * Note: The engine treats all criteria as benefit-only; `direction` is NOT passed.
 */
export function mapToEngineInput(
  criteria: DecisionCriterion[],
  options: DecisionOption[],
  scores: ScoreMatrix
): EngineEvaluationInput {
  return {
    criteria: criteria.map(c => ({
      id: c.id,
      name: c.name,
      ...(c.shortName !== undefined ? { shortName: c.shortName } : {}),
      weight: c.weight,
      ...(c.isLocked !== undefined ? { isLocked: c.isLocked } : {}),
    })),
    options: options.map(o => ({
      id: o.id,
      name: o.name,
      scores: scores[o.id] ?? {},
    })),
  };
}

/**
 * Runs the decision engine and wraps engine ValidationError in EngineValidationError.
 * Supports bounded deterministic in-memory caching validated against input hash and version.
 */
export function runAnalysis(
  criteria: DecisionCriterion[],
  options: DecisionOption[],
  scores: ScoreMatrix,
  lockedIds?: string[],
  cacheContext?: { decisionId: string; version: number }
): EngineResult {
  const input = mapToEngineInput(criteria, options, scores);
  const inputWithLocks: EngineEvaluationInput = lockedIds && lockedIds.length > 0
    ? { ...input, lockedIds }
    : input;

  let inputHash: string | null = null;
  if (cacheContext?.decisionId && cacheContext.version !== undefined) {
    inputHash = evaluationCache.computeInputHash(inputWithLocks);
    const cached = evaluationCache.get(cacheContext.decisionId, cacheContext.version, inputHash);
    if (cached) {
      return cached;
    }
  }

  try {
    const result = evaluateDecision(inputWithLocks);
    if (cacheContext?.decisionId && cacheContext.version !== undefined && inputHash) {
      evaluationCache.set(cacheContext.decisionId, cacheContext.version, inputHash, result);
    }
    return result;
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new EngineValidationError(err);
    }
    throw err;
  }
}

/**
 * Returns true when the decision is fully scoreable.
 */
function isComplete(
  criteria: DecisionCriterion[],
  options: DecisionOption[],
  scores: ScoreMatrix
): boolean {
  return validateCompleteness(criteria, options, scores).length === 0;
}

/**
 * Strips server-controlled fields that clients must never inject.
 */
function stripServerFields(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input };
  delete copy.analysis;
  delete copy.winner;
  delete copy.winnerId;
  delete copy.finalScore;
  delete copy.engineVersion;
  delete copy.calculationVersion;
  delete copy.ownerId;
  delete copy.expectedVersion;
  delete copy.version;
  delete copy.isAudited;
  delete copy.auditIntegrityStatus;
  delete copy.pendingOperationId;
  delete copy.quarantineReason;
  return copy;
}

// ─── Public Service Methods ───────────────────────────────────────────────────

export async function createDecision(
  input: Record<string, unknown>,
  requester?: RequesterContext | string
): Promise<DecisionDocument> {
  // Reject client-supplied synthetic score provenance on initial creation (Finding A / Section 2)
  if (
    input.scoreProvenance &&
    typeof input.scoreProvenance === 'object' &&
    Object.keys(input.scoreProvenance).length > 0
  ) {
    throw new InvalidProvenanceTransitionError(
      'Client-supplied synthetic score provenance is not permitted on decision creation. Use POST /api/decisions/:id/populate-synthetic-demo after creation.'
    );
  }

  const sanitized = stripServerFields(input) as unknown as Parameters<typeof decisionRepository.create>[0];

  const ownerId = typeof requester === 'string' ? requester : requester?.id;
  if (ownerId && mongoose.isValidObjectId(ownerId)) {
    sanitized.ownerId = new mongoose.Types.ObjectId(ownerId);
  }

  // Set default audit integrity status
  sanitized.isAudited = true;
  sanitized.auditIntegrityStatus = 'healthy';
  sanitized.pendingOperationId = null;

  // Create the base document
  const doc = await decisionRepository.create(sanitized);

  const criteria = doc.criteria as DecisionCriterion[];
  const options = doc.options as DecisionOption[];
  const scores = doc.scores as ScoreMatrix;

  let result = doc;
  const syntheticCoords = getSyntheticScoreCoordinates(criteria, options, doc.scoreProvenance);
  if (
    criteria.length > 0 &&
    options.length > 0 &&
    isComplete(criteria, options, scores) &&
    syntheticCoords.length === 0
  ) {
    const analysis = runAnalysis(criteria, options, scores);
    const updated = await decisionRepository.update(doc._id.toString(), { analysis });
    result = updated ?? doc;
  }

  // Audit event
  await auditService.recordEvent({
    decisionId: doc._id.toString(),
    actor: requester,
    action: 'decision.created',
    entityType: 'decision',
    entityId: doc._id.toString(),
    summary: `Created decision "${doc.title}"`,
    diff: {
      after: {
        title: doc.title,
        criteriaCount: criteria.length,
        optionsCount: options.length,
      },
    },
  });

  return result;
}

/**
 * Explicitly replaces a synthetic score coordinate with a verified real assessment.
 * Server Invariant (Batch 02-R3 Finding A & Section 3):
 * - Identifies exact option and criterion coordinate.
 * - Requires explicit replacement score within [0, 100].
 * - Updates score and provenance atomically.
 * - Removes synthetic marker ONLY for this coordinate; preserves all others.
 * - Re-evaluates authoritative MCDA analysis only if zero synthetics remain and matrix is complete.
 * - Records an authoritative audit event with before/after diff.
 * - Enforces optimistic concurrency via expectedVersion.
 */
export async function replaceSyntheticScore(
  id: string,
  input: ReplaceSyntheticScoreInput,
  requester?: RequesterContext,
  explicitSession?: mongoose.ClientSession
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  const existing = await decisionRepository.findById(id, explicitSession);
  if (!existing) {
    throw new DecisionNotFoundError(id);
  }

  if (existing.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, existing.quarantineReason || undefined);
  }

  if (existing.pendingOperationId || existing.auditIntegrityStatus === 'pending_reconciliation') {
    throw new DecisionConflictError(
      existing.version || 1,
      'Decision has an in-flight operation pending reconciliation'
    );
  }

  await authorizeDecisionAction(existing, 'edit', requester);

  // Optimistic concurrency check
  if (input.expectedVersion !== undefined && typeof input.expectedVersion === 'number') {
    const currentVersion = existing.version || 1;
    if (input.expectedVersion !== currentVersion) {
      throw new DecisionConflictError(
        currentVersion,
        `Decision has been modified by another participant (current version: ${currentVersion}, expected: ${input.expectedVersion})`
      );
    }
  }

  const criteria = existing.criteria as DecisionCriterion[];
  const options = existing.options as DecisionOption[];

  const option = options.find((o) => o.id === input.optionId);
  if (!option) {
    throw new InvalidScoreCoordinateError(`Option with ID '${input.optionId}' not found in decision.`);
  }

  const criterion = criteria.find((c) => c.id === input.criterionId);
  if (!criterion) {
    throw new InvalidScoreCoordinateError(`Criterion with ID '${input.criterionId}' not found in decision.`);
  }

  // Validate replacement score value
  if (
    typeof input.score !== 'number' ||
    !Number.isFinite(input.score) ||
    input.score < 0 ||
    input.score > 100
  ) {
    throw new InvalidScoreCoordinateError(
      `Replacement score must be a finite number between 0 and 100 (received ${input.score}).`
    );
  }

  // Verify that coordinate currently possesses synthetic provenance
  const currentProv = existing.scoreProvenance?.[input.optionId]?.[input.criterionId];
  if (!currentProv || currentProv.isSynthetic !== true) {
    throw new CoordinateNotSyntheticError(input.optionId, input.criterionId);
  }

  const nextVersion = (existing.version || 1) + 1;

  // Deep copy scores and provenance
  const scores: ScoreMatrix = JSON.parse(JSON.stringify(existing.scores || {}));
  if (!scores[input.optionId]) {
    scores[input.optionId] = {};
  }
  scores[input.optionId][input.criterionId] = input.score;

  const provenance: ScoreProvenanceMap = JSON.parse(JSON.stringify(existing.scoreProvenance || {}));
  if (provenance[input.optionId]) {
    delete provenance[input.optionId][input.criterionId];
    if (Object.keys(provenance[input.optionId]).length === 0) {
      delete provenance[input.optionId];
    }
  }

  // Invalidate any cached engine evaluation
  evaluationCache.invalidate(id);

  // Check remaining synthetic coordinates
  const remainingSynthetics = getSyntheticScoreCoordinates(criteria, options, provenance);

  let analysis: EngineResult | null = null;
  if (
    criteria.length > 0 &&
    options.length > 0 &&
    isComplete(criteria, options, scores) &&
    remainingSynthetics.length === 0
  ) {
    analysis = runAnalysis(criteria, options, scores, undefined, {
      decisionId: id,
      version: nextVersion,
    });
  }

  const executeReplacement = async (
    session?: mongoose.ClientSession,
    opId?: string,
    eventId?: string
  ): Promise<DecisionDocument> => {
    const updatePayload: Record<string, unknown> = {
      scores,
      scoreProvenance: provenance,
      analysis,
      version: nextVersion,
    };
    if (opId) {
      updatePayload.isAudited = false;
      updatePayload.auditIntegrityStatus = 'pending_reconciliation';
      updatePayload.pendingOperationId = opId;
    }

    const updated = await decisionRepository.update(
      id,
      updatePayload,
      input.expectedVersion,
      session
    );

    if (!updated) {
      if (input.expectedVersion !== undefined) {
        const fresh = await decisionRepository.findById(id, session);
        if (fresh) {
          throw new DecisionConflictError(
            fresh.version || 1,
            `Decision has been modified by another participant (current version: ${fresh.version || 1}, expected: ${input.expectedVersion})`
          );
        }
      }
      throw new DecisionNotFoundError(id);
    }

    // Record audit event within the exact same transaction session
    const auditPayload = {
      decisionId: id,
      actor: requester,
      action: 'decision.synthetic_score_replaced' as const,
      entityType: 'decision' as const,
      entityId: id,
      summary: `Replaced synthetic score for alternative "${option.name}" on criterion "${criterion.name}" with real assessment ${input.score}`,
      diff: {
        optionId: input.optionId,
        criterionId: input.criterionId,
        previousScore: existing.scores?.[input.optionId]?.[input.criterionId],
        replacementScore: input.score,
        previousProvenance: currentProv,
        remainingSyntheticCount: remainingSynthetics.length,
        comment: input.comment,
      },
      ...(eventId ? { eventId } : {}),
    };

    if (session) {
      await auditService.recordEvent(auditPayload, session);
    } else {
      await auditService.recordEvent(auditPayload);
    }

    if (opId) {
      if (mongoose.connection.readyState === 1) {
        await DecisionModel.updateOne(
          { _id: id, version: nextVersion },
          {
            $set: {
              isAudited: true,
              auditIntegrityStatus: 'healthy',
              pendingOperationId: null,
            },
          }
        ).exec();
        await OperationJournalModel.updateOne(
          { operationId: opId },
          { $set: { state: 'COMPLETED' } }
        ).exec();
      }
      (updated as unknown as Record<string, unknown>).isAudited = true;
      (updated as unknown as Record<string, unknown>).auditIntegrityStatus = 'healthy';
      (updated as unknown as Record<string, unknown>).pendingOperationId = null;
    }

    return updated;
  };

  let updated: DecisionDocument;
  if (explicitSession) {
    updated = await executeReplacement(explicitSession);
  } else if (isReplicaSetSupported()) {
    updated = await runInTransaction(async (session) => {
      return executeReplacement(session);
    });
  } else {
    // Standalone MongoDB environment: replica set multi-document transactions are not supported.
    // Durable Outbox / Operation Journal protocol (Task 2):
    // 1. Durably persist an OperationJournal record in PENDING state before mutation.
    // 2. Atomically update decision scores, provenance, version, and set auditIntegrityStatus: 'pending_reconciliation'.
    // 3. Append the audit event to AuditEventModel with deterministic eventId.
    // 4. Finalize decision (auditIntegrityStatus: 'healthy') and transition journal to COMPLETED.
    // 5. In crash scenarios, reconcileStandaloneAudit uses the durable journal to complete or quarantine.
    const opId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    await operationJournalRepository.createEntry({
      operationId: opId,
      decisionId: id,
      action: 'decision.synthetic_score_replaced',
      actor: {
        id: requester?.id || 'system',
        role: requester?.role || 'admin',
        name: requester?.name,
        email: requester?.email,
      },
      expectedVersion: existing.version || 1,
      targetVersion: nextVersion,
      payload: { optionId: input.optionId, criterionId: input.criterionId, score: input.score },
      previousSnapshot: {
        scores: existing.scores || {},
        criteria: existing.criteria || [],
        options: existing.options || [],
        version: existing.version || 1,
      },
      auditDraft: {
        eventId,
        entityType: 'decision',
        entityId: id,
        summary: `Replaced synthetic score for alternative "${option.name}" on criterion "${criterion.name}" with real assessment ${input.score}`,
        diff: {
          optionId: input.optionId,
          criterionId: input.criterionId,
          previousScore: existing.scores?.[input.optionId]?.[input.criterionId],
          replacementScore: input.score,
          previousProvenance: currentProv,
          remainingSyntheticCount: remainingSynthetics.length,
          comment: input.comment,
        },
      },
    });

    try {
      updated = await executeReplacement(undefined, opId, eventId);
    } catch (err) {
      if (mongoose.connection.readyState === 1) {
        const fresh = await decisionRepository.findById(id);
        if (fresh && fresh.version === existing.version) {
          await OperationJournalModel.updateOne(
            { operationId: opId },
            { $set: { state: 'REVERTED', errorDetails: err instanceof Error ? err.message : String(err) } }
          ).exec();
        }
      }
      throw err;
    }
  }

  // Broadcast real-time update
  collaborationService.publishEvent(id, {
    type: 'decision.updated',
    decisionId: id,
    version: nextVersion,
    actorId: requester?.id,
    actorName: requester?.name || requester?.email,
    payload: {
      scores,
      scoreProvenance: provenance,
      analysis,
      version: nextVersion,
    },
  });

  return updated;
}

/**
 * Atomically clears all synthetic scores and their provenance flags.
 * Cleared coordinates become missing (empty), guaranteeing authoritative analysis
 * remains blocked until every missing coordinate is scored with a real assessment.
 */
export async function clearSyntheticScores(
  id: string,
  expectedVersion?: number,
  requester?: RequesterContext,
  explicitSession?: mongoose.ClientSession
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  const existing = await decisionRepository.findById(id, explicitSession);
  if (!existing) {
    throw new DecisionNotFoundError(id);
  }

  if (existing.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, existing.quarantineReason || undefined);
  }

  if (existing.pendingOperationId || existing.auditIntegrityStatus === 'pending_reconciliation') {
    throw new DecisionConflictError(
      existing.version || 1,
      'Decision has an in-flight operation pending reconciliation'
    );
  }

  await authorizeDecisionAction(existing, 'edit', requester);

  if (expectedVersion !== undefined && typeof expectedVersion === 'number') {
    const currentVersion = existing.version || 1;
    if (expectedVersion !== currentVersion) {
      throw new DecisionConflictError(
        currentVersion,
        `Decision has been modified by another participant (current version: ${currentVersion}, expected: ${expectedVersion})`
      );
    }
  }

  const prov = existing.scoreProvenance;
  if (!prov || Object.keys(prov).length === 0) {
    return existing;
  }

  const nextVersion = (existing.version || 1) + 1;
  const scores: ScoreMatrix = JSON.parse(JSON.stringify(existing.scores || {}));
  let clearedCount = 0;

  for (const [optId, critMap] of Object.entries(prov)) {
    for (const [critId, entry] of Object.entries(critMap || {})) {
      if (entry?.isSynthetic) {
        if (scores[optId]) {
          delete scores[optId][critId];
        }
        clearedCount++;
      }
    }
  }

  evaluationCache.invalidate(id);

  const executeClear = async (
    session?: mongoose.ClientSession,
    opId?: string,
    eventId?: string
  ): Promise<DecisionDocument> => {
    const updatePayload: Record<string, unknown> = {
      scores,
      scoreProvenance: {},
      analysis: null,
      version: nextVersion,
    };
    if (opId) {
      updatePayload.isAudited = false;
      updatePayload.auditIntegrityStatus = 'pending_reconciliation';
      updatePayload.pendingOperationId = opId;
    }

    const updated = await decisionRepository.update(
      id,
      updatePayload,
      expectedVersion,
      session
    );

    if (!updated) {
      if (expectedVersion !== undefined) {
        const fresh = await decisionRepository.findById(id, session);
        if (fresh) {
          throw new DecisionConflictError(
            fresh.version || 1,
            `Decision has been modified by another participant (current version: ${fresh.version || 1}, expected: ${expectedVersion})`
          );
        }
      }
      throw new DecisionNotFoundError(id);
    }

    const auditPayload = {
      decisionId: id,
      actor: requester,
      action: 'decision.synthetic_scores_cleared' as const,
      entityType: 'decision' as const,
      entityId: id,
      summary: `Cleared ${clearedCount} synthetic score(s) and their provenance`,
      diff: {
        clearedCount,
      },
      ...(eventId ? { eventId } : {}),
    };

    if (session) {
      await auditService.recordEvent(auditPayload, session);
    } else {
      await auditService.recordEvent(auditPayload);
    }

    if (opId) {
      if (mongoose.connection.readyState === 1) {
        await DecisionModel.updateOne(
          { _id: id, version: nextVersion },
          {
            $set: {
              isAudited: true,
              auditIntegrityStatus: 'healthy',
              pendingOperationId: null,
            },
          }
        ).exec();
        await OperationJournalModel.updateOne(
          { operationId: opId },
          { $set: { state: 'COMPLETED' } }
        ).exec();
      }
      (updated as unknown as Record<string, unknown>).isAudited = true;
      (updated as unknown as Record<string, unknown>).auditIntegrityStatus = 'healthy';
      (updated as unknown as Record<string, unknown>).pendingOperationId = null;
    }

    return updated;
  };

  let updated: DecisionDocument;
  if (explicitSession) {
    updated = await executeClear(explicitSession);
  } else if (isReplicaSetSupported()) {
    updated = await runInTransaction(async (session) => {
      return executeClear(session);
    });
  } else {
    // Standalone MongoDB environment: replica set multi-document transactions are not supported.
    // Durable Outbox / Operation Journal protocol (Task 2):
    // 1. Durably persist an OperationJournal record in PENDING state before mutation.
    // 2. Atomically update decision scores, provenance, version, and set auditIntegrityStatus: 'pending_reconciliation'.
    // 3. Append the audit event to AuditEventModel with deterministic eventId.
    // 4. Finalize decision (auditIntegrityStatus: 'healthy') and transition journal to COMPLETED.
    // 5. In crash scenarios, reconcileStandaloneAudit uses the durable journal to complete or quarantine.
    const opId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    await operationJournalRepository.createEntry({
      operationId: opId,
      decisionId: id,
      action: 'decision.synthetic_scores_cleared',
      actor: {
        id: requester?.id || 'system',
        role: requester?.role || 'admin',
        name: requester?.name,
        email: requester?.email,
      },
      expectedVersion: existing.version || 1,
      targetVersion: nextVersion,
      payload: { clearedCount },
      previousSnapshot: {
        scores: existing.scores || {},
        criteria: existing.criteria || [],
        options: existing.options || [],
        version: existing.version || 1,
      },
      auditDraft: {
        eventId,
        entityType: 'decision',
        entityId: id,
        summary: `Cleared ${clearedCount} synthetic score(s) and their provenance`,
        diff: {
          clearedCount,
        },
      },
    });

    try {
      updated = await executeClear(undefined, opId, eventId);
    } catch (err) {
      if (mongoose.connection.readyState === 1) {
        const fresh = await decisionRepository.findById(id);
        if (fresh && fresh.version === existing.version) {
          await OperationJournalModel.updateOne(
            { operationId: opId },
            { $set: { state: 'REVERTED', errorDetails: err instanceof Error ? err.message : String(err) } }
          ).exec();
        }
      }
      throw err;
    }
  }

  collaborationService.publishEvent(id, {
    type: 'decision.updated',
    decisionId: id,
    version: nextVersion,
    actorId: requester?.id,
    actorName: requester?.name || requester?.email,
    payload: {
      scores,
      scoreProvenance: {},
      analysis: null,
      version: nextVersion,
    },
  });

  return updated;
}

/**
 * Server-recognized demo-fill operation (Section 4).
 * Creates authoritative server-recognized synthetic state directly on the backend.
 * Once created, ordinary updates cannot silently remove this provenance.
 */
export async function populateSyntheticDemo(
  id: string,
  defaultValue = 75,
  expectedVersion?: number,
  requester?: RequesterContext,
  explicitSession?: mongoose.ClientSession
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  // Validate defaultValue range (Finding A / Section 2)
  if (
    typeof defaultValue !== 'number' ||
    !Number.isFinite(defaultValue) ||
    defaultValue < 0 ||
    defaultValue > 100
  ) {
    throw new InvalidScoreCoordinateError(
      `Demo score value must be a finite number between 0 and 100 (received ${defaultValue}).`
    );
  }

  const existing = await decisionRepository.findById(id, explicitSession);
  if (!existing) {
    throw new DecisionNotFoundError(id);
  }

  if (existing.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, existing.quarantineReason || undefined);
  }

  if (existing.pendingOperationId || existing.auditIntegrityStatus === 'pending_reconciliation') {
    throw new DecisionConflictError(
      existing.version || 1,
      'Decision has an in-flight operation pending reconciliation'
    );
  }

  await authorizeDecisionAction(existing, 'edit', requester);

  if (expectedVersion !== undefined && typeof expectedVersion === 'number') {
    const currentVersion = existing.version || 1;
    if (expectedVersion !== currentVersion) {
      throw new DecisionConflictError(
        currentVersion,
        `Decision has been modified by another participant (current version: ${currentVersion}, expected: ${expectedVersion})`
      );
    }
  }

  const criteria = existing.criteria as DecisionCriterion[];
  const options = existing.options as DecisionOption[];

  const nextVersion = (existing.version || 1) + 1;
  const scores: ScoreMatrix = JSON.parse(JSON.stringify(existing.scores || {}));
  const provenance: ScoreProvenanceMap = JSON.parse(JSON.stringify(existing.scoreProvenance || {}));

  let populatedCount = 0;
  for (const opt of options) {
    if (!scores[opt.id]) scores[opt.id] = {};
    if (!provenance[opt.id]) provenance[opt.id] = {};
    for (const crit of criteria) {
      const currentScore = scores[opt.id]?.[crit.id];
      if (typeof currentScore !== 'number' || !Number.isFinite(currentScore)) {
        scores[opt.id][crit.id] = defaultValue;
        provenance[opt.id][crit.id] = {
          isSynthetic: true,
          source: 'demo',
          insertedAt: new Date().toISOString(),
        };
        populatedCount++;
      }
    }
  }

  // Idempotency / No-Op Protection (Task 1):
  // If no scores were missing, leave decision unchanged.
  // Do NOT increment version and do NOT generate duplicate audit events.
  if (populatedCount === 0) {
    return existing;
  }

  evaluationCache.invalidate(id);

  const executePopulate = async (
    session?: mongoose.ClientSession,
    opId?: string,
    eventId?: string
  ): Promise<DecisionDocument> => {
    const updatePayload: Record<string, unknown> = {
      scores,
      scoreProvenance: provenance,
      analysis: null, // synthetic scores strictly suppress authoritative analysis
      version: nextVersion,
    };
    if (opId) {
      updatePayload.isAudited = false;
      updatePayload.auditIntegrityStatus = 'pending_reconciliation';
      updatePayload.pendingOperationId = opId;
    }

    const updated = await decisionRepository.update(
      id,
      updatePayload,
      expectedVersion,
      session
    );

    if (!updated) {
      if (expectedVersion !== undefined) {
        const fresh = await decisionRepository.findById(id, session);
        if (fresh) {
          throw new DecisionConflictError(
            fresh.version || 1,
            `Decision has been modified by another participant (current version: ${fresh.version || 1}, expected: ${expectedVersion})`
          );
        }
      }
      throw new DecisionNotFoundError(id);
    }

    const auditPayload = {
      decisionId: id,
      actor: requester,
      action: 'decision.synthetic_demo_populated' as const,
      entityType: 'decision' as const,
      entityId: id,
      summary: `Populated ${populatedCount} missing score(s) with synthetic demo value ${defaultValue}`,
      diff: {
        populatedCount,
        defaultValue,
      },
      ...(eventId ? { eventId } : {}),
    };

    if (session) {
      await auditService.recordEvent(auditPayload, session);
    } else {
      await auditService.recordEvent(auditPayload);
    }

    if (opId) {
      if (mongoose.connection.readyState === 1) {
        await DecisionModel.updateOne(
          { _id: id, version: nextVersion },
          {
            $set: {
              isAudited: true,
              auditIntegrityStatus: 'healthy',
              pendingOperationId: null,
            },
          }
        ).exec();
        await OperationJournalModel.updateOne(
          { operationId: opId },
          { $set: { state: 'COMPLETED' } }
        ).exec();
      }
      (updated as unknown as Record<string, unknown>).isAudited = true;
      (updated as unknown as Record<string, unknown>).auditIntegrityStatus = 'healthy';
      (updated as unknown as Record<string, unknown>).pendingOperationId = null;
    }

    return updated;
  };

  let updated: DecisionDocument;
  if (explicitSession) {
    updated = await executePopulate(explicitSession);
  } else if (isReplicaSetSupported()) {
    updated = await runInTransaction(async (session) => {
      return executePopulate(session);
    });
  } else {
    // Standalone MongoDB environment: replica set multi-document transactions are not supported.
    // Durable Outbox / Operation Journal protocol (Task 2):
    // 1. Durably persist an OperationJournal record in PENDING state before mutation.
    // 2. Atomically update decision scores, provenance, version, and set auditIntegrityStatus: 'pending_reconciliation'.
    // 3. Append the audit event to AuditEventModel with deterministic eventId.
    // 4. Finalize decision (auditIntegrityStatus: 'healthy') and transition journal to COMPLETED.
    // 5. In crash scenarios, reconcileStandaloneAudit uses the durable journal to complete or quarantine.
    const opId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    await operationJournalRepository.createEntry({
      operationId: opId,
      decisionId: id,
      action: 'decision.synthetic_demo_populated',
      actor: {
        id: requester?.id || 'system',
        role: requester?.role || 'admin',
        name: requester?.name,
        email: requester?.email,
      },
      expectedVersion: existing.version || 1,
      targetVersion: nextVersion,
      payload: { defaultValue, populatedCount },
      previousSnapshot: {
        scores: existing.scores || {},
        criteria: existing.criteria || [],
        options: existing.options || [],
        version: existing.version || 1,
      },
      auditDraft: {
        eventId,
        entityType: 'decision',
        entityId: id,
        summary: `Populated ${populatedCount} missing score(s) with synthetic demo value ${defaultValue}`,
        diff: {
          populatedCount,
          defaultValue,
        },
      },
    });

    try {
      updated = await executePopulate(undefined, opId, eventId);
    } catch (err) {
      if (mongoose.connection.readyState === 1) {
        const fresh = await decisionRepository.findById(id);
        if (fresh && fresh.version === existing.version) {
          await OperationJournalModel.updateOne(
            { operationId: opId },
            { $set: { state: 'REVERTED', errorDetails: err instanceof Error ? err.message : String(err) } }
          ).exec();
        }
      }
      throw err;
    }
  }

  collaborationService.publishEvent(id, {
    type: 'decision.updated',
    decisionId: id,
    version: nextVersion,
    actorId: requester?.id,
    actorName: requester?.name || requester?.email,
    payload: {
      scores,
      scoreProvenance: provenance,
      analysis: null,
      version: nextVersion,
    },
  });

  return updated;
}

/**
 * Reconciles a pending audit obligation in standalone mode (Task 2).
 * Verifies invariants:
 * - If journal entry not found -> quarantines decision.
 * - If decision.version === expectedVersion -> reverts journal (safe abort).
 * - If decision.version === targetVersion && decision.pendingOperationId === opId ->
 *   rolls forward audit event idempotently with eventId, marks decision healthy, and journal COMPLETED.
 * - If version is desynchronized -> marks quarantined and journal UNRECOVERABLE.
 */
export async function reconcileStandaloneAudit(
  decisionId: string,
  operationId?: string
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }

  const existing = await decisionRepository.findById(decisionId);
  if (!existing) {
    throw new DecisionNotFoundError(decisionId);
  }

  const opId = operationId || existing.pendingOperationId;
  if (!opId) {
    if (existing.auditIntegrityStatus === 'pending_reconciliation') {
      await DecisionModel.updateOne(
        { _id: decisionId },
        {
          $set: {
            auditIntegrityStatus: 'quarantined',
            quarantineReason: 'Pending reconciliation without valid pendingOperationId',
            isAudited: false,
          },
        }
      ).exec();
      throw new DecisionQuarantinedError(decisionId, 'Pending reconciliation without valid pendingOperationId');
    }
    return existing;
  }

  const journal = await operationJournalRepository.findByOperationId(opId);
  if (!journal) {
    await DecisionModel.updateOne(
      { _id: decisionId },
      {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: `Operation journal not found for pending operation ${opId}`,
          isAudited: false,
          pendingOperationId: null,
        },
      }
    ).exec();
    throw new DecisionQuarantinedError(decisionId, `Operation journal not found for pending operation ${opId}`);
  }

  // State 1: Abort prior to mutation
  if (existing.version === journal.expectedVersion) {
    await OperationJournalModel.updateOne(
      { operationId: opId },
      { $set: { state: 'REVERTED', errorDetails: 'Operation aborted prior to decision mutation' } }
    ).exec();
    await DecisionModel.updateOne(
      { _id: decisionId, version: journal.expectedVersion },
      { $set: { pendingOperationId: null, auditIntegrityStatus: 'healthy', isAudited: true } }
    ).exec();
    const fresh = await decisionRepository.findById(decisionId);
    return fresh!;
  }

  // State 2: Roll forward committed mutation
  if (existing.version === journal.targetVersion && existing.pendingOperationId === opId) {
    const draft = journal.auditDraft;
    const auditPayload = {
      decisionId,
      actor: journal.actor,
      action: journal.action as any,
      entityType: (draft?.entityType || 'decision') as any,
      entityId: draft?.entityId || decisionId,
      summary: draft?.summary || `Reconciled operation ${opId}`,
      diff: draft?.diff || {},
      eventId: draft?.eventId,
    };

    // recordEvent is idempotent on eventId
    await auditService.recordEvent(auditPayload);

    await DecisionModel.updateOne(
      { _id: decisionId, version: journal.targetVersion },
      {
        $set: {
          pendingOperationId: null,
          auditIntegrityStatus: 'healthy',
          isAudited: true,
        },
      }
    ).exec();

    await OperationJournalModel.updateOne(
      { operationId: opId },
      { $set: { state: 'COMPLETED' } }
    ).exec();

    const fresh = await decisionRepository.findById(decisionId);
    return fresh!;
  }

  // State 3: Version desynchronization -> Quarantine
  await OperationJournalModel.updateOne(
    { operationId: opId },
    { $set: { state: 'UNRECOVERABLE', errorDetails: `Version mismatch: decision version ${existing.version} != expected ${journal.expectedVersion} / target ${journal.targetVersion}` } }
  ).exec();
  await DecisionModel.updateOne(
    { _id: decisionId },
    {
      $set: {
        auditIntegrityStatus: 'quarantined',
        quarantineReason: `Version desynchronization during reconciliation: decision version ${existing.version} does not match expected ${journal.expectedVersion} or target ${journal.targetVersion}`,
        isAudited: false,
        pendingOperationId: null,
      },
    }
  ).exec();
  throw new DecisionQuarantinedError(
    decisionId,
    `Version desynchronization during reconciliation: decision version ${existing.version} does not match expected ${journal.expectedVersion} or target ${journal.targetVersion}`
  );
}

export async function getDecision(
  id: string,
  requester?: RequesterContext
): Promise<DecisionDocument & { currentUserRole?: DecisionRole }> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }
  let doc = await decisionRepository.findById(id);
  if (!doc) {
    throw new DecisionNotFoundError(id);
  }

  // Self-healing: if an interrupted standalone operation is pending reconciliation, attempt immediate recovery
  if (doc.auditIntegrityStatus === 'pending_reconciliation' && doc.pendingOperationId) {
    try {
      doc = await reconcileStandaloneAudit(id, doc.pendingOperationId);
    } catch {
      const refreshed = await decisionRepository.findById(id);
      if (refreshed) {
        doc = refreshed;
      }
    }
  }

  const role = await authorizeDecisionAction(doc, 'read', requester);

  // Return document with effective current user role attached
  const res = doc as DecisionDocument & { currentUserRole?: DecisionRole };
  res.currentUserRole = role;
  return res;
}

export async function listDecisions(
  filter?: ListDecisionsFilter,
  pagination?: PaginationOptions,
  requester?: RequesterContext
): Promise<PaginatedResult<DecisionDocument>> {
  const effectiveFilter: ListDecisionsFilter = { ...filter };

  // Regular users only see their own decisions plus decisions explicitly shared with them
  if (requester && requester.role !== 'admin') {
    effectiveFilter.ownerId = requester.id;
    const sharedIds = await decisionAccessRepository.listSharedDecisionIdsForUser(requester.id);
    effectiveFilter.allowedIds = sharedIds;
  }

  return decisionRepository.list(effectiveFilter, pagination);
}

export async function updateDecision(
  id: string,
  data: Record<string, unknown>,
  requester?: RequesterContext
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  const existing = await decisionRepository.findById(id);
  if (!existing) {
    throw new DecisionNotFoundError(id);
  }

  if (existing.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, existing.quarantineReason || undefined);
  }

  if (existing.pendingOperationId || existing.auditIntegrityStatus === 'pending_reconciliation') {
    throw new DecisionConflictError(
      existing.version || 1,
      'Decision has an in-flight operation pending reconciliation'
    );
  }

  await authorizeDecisionAction(existing, 'edit', requester);

  // Optimistic concurrency check
  let expectedVersion: number | undefined;
  if (data.expectedVersion !== undefined && typeof data.expectedVersion === 'number') {
    expectedVersion = data.expectedVersion;
    const currentVersion = existing.version || 1;
    if (data.expectedVersion !== currentVersion) {
      throw new DecisionConflictError(
        currentVersion,
        `Decision has been modified by another participant (current version: ${currentVersion}, expected: ${data.expectedVersion})`
      );
    }
  }

  const nextVersion = (existing.version || 1) + 1;
  const sanitized = stripServerFields(data);
  (sanitized as Record<string, unknown>).version = nextVersion;

  // Server-Enforced Synthetic Provenance Integrity (Batch 02-R3 Finding A):
  // Check if client explicitly attempted to set isSynthetic: false for any coordinate
  const incomingProvenance = data.scoreProvenance as ScoreProvenanceMap | undefined;
  if (incomingProvenance && typeof incomingProvenance === 'object') {
    for (const [optId, critMap] of Object.entries(incomingProvenance)) {
      for (const [critId, entry] of Object.entries(critMap || {})) {
        if (entry && (entry as unknown as { isSynthetic?: unknown }).isSynthetic === false) {
          throw new InvalidProvenanceTransitionError(
            `Cannot set isSynthetic to false on coordinate (${optId}, ${critId}) via ordinary update. Use the explicit replacement endpoint.`
          );
        }
      }
    }
  }

  // Safe merge: Persisted synthetic coordinates CANNOT be erased or bypassed by ordinary updates
  const effectiveCriteria = (data.criteria as DecisionCriterion[]) ?? (existing.criteria as DecisionCriterion[]);
  const effectiveOptions = (data.options as DecisionOption[]) ?? (existing.options as DecisionOption[]);
  sanitized.scoreProvenance = mergeScoreProvenance(
    existing.scoreProvenance,
    incomingProvenance,
    effectiveCriteria,
    effectiveOptions
  );

  const doc = await decisionRepository.update(
    id,
    sanitized as Parameters<typeof decisionRepository.update>[1],
    expectedVersion
  );
  if (!doc) {
    if (expectedVersion !== undefined) {
      const fresh = await decisionRepository.findById(id);
      if (fresh) {
        throw new DecisionConflictError(
          fresh.version || 1,
          `Decision has been modified by another participant (current version: ${fresh.version || 1}, expected: ${expectedVersion})`
        );
      }
    }
    throw new DecisionNotFoundError(id);
  }

  const criteria = doc.criteria as DecisionCriterion[];
  const options = doc.options as DecisionOption[];
  const scores = doc.scores as ScoreMatrix;

  // Invalidate any cached engine evaluation on decision mutation
  evaluationCache.invalidate(id);

  let result = doc;
  const syntheticCoords = getSyntheticScoreCoordinates(criteria, options, doc.scoreProvenance);
  if (
    criteria.length > 0 &&
    options.length > 0 &&
    isComplete(criteria, options, scores) &&
    syntheticCoords.length === 0
  ) {
    const analysis = runAnalysis(criteria, options, scores, undefined, {
      decisionId: id,
      version: nextVersion,
    });
    const withAnalysis = await decisionRepository.update(id, { analysis, version: nextVersion });
    result = withAnalysis ?? doc;
  } else {
    const cleared = await decisionRepository.update(id, { analysis: null, version: nextVersion });
    result = cleared ?? doc;
  }

  // Audit event
  await auditService.recordEvent({
    decisionId: id,
    actor: requester,
    action: 'decision.updated',
    entityType: 'decision',
    entityId: id,
    summary: `Updated decision "${result.title}"`,
    diff: {
      changedFields: Object.keys(data),
    },
  });

  // Broadcast real-time collaboration event
  collaborationService.publishEvent(id, {
    type: 'decision.updated',
    decisionId: id,
    version: result.version || nextVersion,
    actorId: requester?.id,
    actorName: requester?.name || requester?.email,
    payload: {
      title: result.title,
      description: result.description,
      criteria: result.criteria,
      options: result.options,
      scores: result.scores,
      scoreProvenance: result.scoreProvenance,
      version: result.version || nextVersion,
    },
  });

  return result;
}

export async function deleteDecision(
  id: string,
  requester?: RequesterContext
): Promise<void> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  const existing = await decisionRepository.findById(id);
  if (!existing) {
    throw new DecisionNotFoundError(id);
  }

  if (existing.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, existing.quarantineReason || undefined);
  }

  await authorizeDecisionAction(existing, 'delete', requester);

  // Preserve historical audit record before cascade and deletion
  await auditService.recordEvent({
    decisionId: id,
    actor: requester,
    action: 'decision.deleted',
    entityType: 'decision',
    entityId: id,
    summary: `Deleted decision "${existing.title}"`,
  });

  // Cascade delete any access grants, invitations, contributions, evidence, and comments associated with this decision
  await Promise.all([
    decisionAccessRepository.deleteByDecisionId(id),
    invitationRepository.deleteByDecisionId(id),
    contributionRepository.deleteByDecisionId(id),
    evidenceRepository.deleteByDecisionId(id),
    commentRepository.deleteByDecisionId(id),
  ]);

  const deleted = await decisionRepository.delete(id);
  if (!deleted) {
    throw new DecisionNotFoundError(id);
  }

  // Invalidate cached engine calculations and cleanup real-time streams
  evaluationCache.invalidate(id);
  collaborationService.closeDecision(id);
}

export async function analyzeDecision(
  id: string,
  requester?: RequesterContext
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  let doc = await decisionRepository.findById(id);
  if (!doc) {
    throw new DecisionNotFoundError(id);
  }

  // Self-healing: if an interrupted standalone operation is pending reconciliation, attempt immediate recovery
  if (doc.auditIntegrityStatus === 'pending_reconciliation' && doc.pendingOperationId) {
    try {
      doc = await reconcileStandaloneAudit(id, doc.pendingOperationId);
    } catch {
      const refreshed = await decisionRepository.findById(id);
      if (refreshed) {
        doc = refreshed;
      }
    }
  }

  if (doc.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, doc.quarantineReason || undefined);
  }

  if (doc.pendingOperationId || doc.auditIntegrityStatus === 'pending_reconciliation') {
    throw new DecisionConflictError(
      doc.version || 1,
      'Decision has an in-flight operation pending reconciliation'
    );
  }

  await authorizeDecisionAction(doc, 'analyze', requester);

  const criteria = doc.criteria as DecisionCriterion[];
  const options = doc.options as DecisionOption[];
  const scores = doc.scores as ScoreMatrix;

  const missingPairs = validateCompleteness(criteria, options, scores);
  if (missingPairs.length > 0) {
    throw new IncompleteScoresError(missingPairs);
  }

  const syntheticCoords = getSyntheticScoreCoordinates(criteria, options, doc.scoreProvenance);
  if (syntheticCoords.length > 0) {
    throw new SyntheticScoresPresentError(syntheticCoords);
  }

  const analysis = runAnalysis(criteria, options, scores, undefined, {
    decisionId: id,
    version: doc.version || 1,
  });
  const nextVersion = (doc.version || 1) + 1;
  const updated = await decisionRepository.update(id, { analysis, version: nextVersion });
  const result = updated ?? doc;

  const winnerName = options.find(o => o.id === analysis.winnerId)?.name || (analysis.isTie ? 'Tie' : 'undetermined');

  await auditService.recordEvent({
    decisionId: id,
    actor: requester,
    action: 'decision.calculated',
    entityType: 'decision',
    entityId: id,
    summary: `Calculated authoritative MCDA analysis (winner: ${winnerName})`,
    diff: {
      after: {
        winnerId: analysis.winnerId,
        winnerName,
        engineVersion: analysis.engineVersion,
      },
    },
  });

  // Broadcast real-time calculation update
  collaborationService.publishEvent(id, {
    type: 'decision.calculation.updated',
    decisionId: id,
    version: result.version || nextVersion,
    actorId: requester?.id,
    actorName: requester?.name || requester?.email,
    payload: {
      winnerId: analysis.winnerId,
      winnerName,
      engineVersion: analysis.engineVersion,
      normalizedWeights: analysis.normalizedWeights,
      evaluations: analysis.evaluations,
      isTie: analysis.isTie,
      version: result.version || nextVersion,
    },
  });

  return result;
}

export async function resolveQuarantine(
  id: string,
  requester?: RequesterContext,
  resolutionNotes?: string
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  const existing = await decisionRepository.findById(id);
  if (!existing) {
    throw new DecisionNotFoundError(id);
  }

  await authorizeDecisionAction(existing, 'quarantine_resolve', requester);

  if (existing.auditIntegrityStatus !== 'quarantined') {
    throw new Error(`Decision '${id}' is not in quarantined status (current status: ${existing.auditIntegrityStatus})`);
  }

  const currentVersion = existing.version || 1;
  const nextVersion = currentVersion + 1;

  const executeResolution = async (session?: mongoose.ClientSession): Promise<DecisionDocument> => {
    const updated = await DecisionModel.findOneAndUpdate(
      {
        _id: id,
        auditIntegrityStatus: 'quarantined',
      },
      {
        $set: {
          auditIntegrityStatus: 'healthy',
          quarantineReason: null,
          pendingOperationId: null,
          recoveryOwner: null,
          recoveryLeaseExpiresAt: null,
          isAudited: true,
          version: nextVersion,
        },
      },
      { new: true, session }
    ).exec();

    if (!updated) {
      throw new DecisionConflictError(
        currentVersion,
        'Decision quarantine was concurrently modified or resolved'
      );
    }

    // Append authoritative audit event
    await auditService.recordEvent(
      {
        decisionId: id,
        actor: requester,
        action: 'decision.quarantine_resolved',
        entityType: 'decision',
        entityId: id,
        summary: resolutionNotes?.trim() || `Administrative quarantine resolution by ${requester?.name || requester?.id || 'admin'}`,
        diff: {
          before: {
            auditIntegrityStatus: 'quarantined',
            quarantineReason: existing.quarantineReason,
            version: currentVersion,
          },
          after: {
            auditIntegrityStatus: 'healthy',
            version: nextVersion,
          },
        },
      },
      session
    );

    // Create outbox notification
    await outboxService.createNotification(
      {
        decisionId: id,
        eventType: 'decision.quarantine_resolved',
        payload: {
          decisionId: id,
          resolvedBy: requester?.id,
          version: nextVersion,
        },
      },
      session
    );

    return updated;
  };

  const resolvedDoc = await runInTransaction(async (session) => {
    return executeResolution(session);
  });

  evaluationCache.invalidate(id);

  collaborationService.publishEvent(id, {
    type: 'decision.quarantine_resolved',
    decisionId: id,
    version: nextVersion,
    actorId: requester?.id,
    actorName: requester?.name || requester?.email,
    payload: {
      status: 'healthy',
      version: nextVersion,
    },
  });

  return resolvedDoc;
}
