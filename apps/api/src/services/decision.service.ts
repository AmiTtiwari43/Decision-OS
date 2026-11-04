import mongoose from 'mongoose';
import { evaluateDecision, ValidationError } from '@decision-os/decision-engine';
import type {
  EngineEvaluationInput,
  EngineResult,
} from '@decision-os/decision-engine';
import { decisionRepository } from '../repositories/decision.repository.js';
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
import { runInTransaction } from '../db/connection.js';
import { collaborationService } from './collaboration.service.js';
import { evaluationCache } from './evaluationCache.js';
import {
  DecisionModel,
  type DecisionCriterion,
  type DecisionOption,
  type ScoreMatrix,
  type DecisionDocument,
} from '../models/index.js';
import type { ListDecisionsFilter, PaginationOptions, PaginatedResult } from '../repositories/decision.repository.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  IncompleteScoresError,
  EngineValidationError,
  DecisionConflictError,
  DecisionQuarantinedError,
} from '../errors/domain.errors.js';
import type { MissingScorePair } from '../errors/domain.errors.js';

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
  if (criteria.length > 0 && options.length > 0 && isComplete(criteria, options, scores)) {
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

export async function getDecision(
  id: string,
  requester?: RequesterContext
): Promise<DecisionDocument & { currentUserRole?: DecisionRole }> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }
  const doc = await decisionRepository.findById(id);
  if (!doc) {
    throw new DecisionNotFoundError(id);
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

  if (existing.pendingOperationId) {
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
  if (criteria.length > 0 && options.length > 0 && isComplete(criteria, options, scores)) {
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

  const doc = await decisionRepository.findById(id);
  if (!doc) {
    throw new DecisionNotFoundError(id);
  }

  if (doc.auditIntegrityStatus === 'quarantined') {
    throw new DecisionQuarantinedError(id, doc.quarantineReason || undefined);
  }

  if (doc.pendingOperationId) {
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
