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
import {
  authorizeDecisionAction,
  type DecisionRole,
} from './authorization.service.js';
import type {
  DecisionCriterion,
  DecisionOption,
  ScoreMatrix,
  DecisionDocument,
} from '../models/index.js';
import type { ListDecisionsFilter, PaginationOptions, PaginatedResult } from '../repositories/decision.repository.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  IncompleteScoresError,
  EngineValidationError,
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
 */
export function runAnalysis(
  criteria: DecisionCriterion[],
  options: DecisionOption[],
  scores: ScoreMatrix,
  lockedIds?: string[]
): EngineResult {
  const input = mapToEngineInput(criteria, options, scores);
  const inputWithLocks: EngineEvaluationInput = lockedIds && lockedIds.length > 0
    ? { ...input, lockedIds }
    : input;

  try {
    return evaluateDecision(inputWithLocks);
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

  // Create the base document
  const doc = await decisionRepository.create(sanitized);

  const criteria = doc.criteria as DecisionCriterion[];
  const options = doc.options as DecisionOption[];
  const scores = doc.scores as ScoreMatrix;

  if (criteria.length > 0 && options.length > 0 && isComplete(criteria, options, scores)) {
    const analysis = runAnalysis(criteria, options, scores);
    const updated = await decisionRepository.update(doc._id.toString(), { analysis });
    return updated ?? doc;
  }

  return doc;
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

  await authorizeDecisionAction(existing, 'edit', requester);

  const sanitized = stripServerFields(data);

  const doc = await decisionRepository.update(id, sanitized as Parameters<typeof decisionRepository.update>[1]);
  if (!doc) {
    throw new DecisionNotFoundError(id);
  }

  const criteria = doc.criteria as DecisionCriterion[];
  const options = doc.options as DecisionOption[];
  const scores = doc.scores as ScoreMatrix;

  if (criteria.length > 0 && options.length > 0 && isComplete(criteria, options, scores)) {
    const analysis = runAnalysis(criteria, options, scores);
    const withAnalysis = await decisionRepository.update(id, { analysis });
    return withAnalysis ?? doc;
  } else {
    const cleared = await decisionRepository.update(id, { analysis: null });
    return cleared ?? doc;
  }
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

  await authorizeDecisionAction(existing, 'delete', requester);

  // Cascade delete any access grants, invitations, contributions, and evidence associated with this decision
  await Promise.all([
    decisionAccessRepository.deleteByDecisionId(id),
    invitationRepository.deleteByDecisionId(id),
    contributionRepository.deleteByDecisionId(id),
    evidenceRepository.deleteByDecisionId(id),
  ]);

  const deleted = await decisionRepository.delete(id);
  if (!deleted) {
    throw new DecisionNotFoundError(id);
  }
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

  await authorizeDecisionAction(doc, 'analyze', requester);

  const criteria = doc.criteria as DecisionCriterion[];
  const options = doc.options as DecisionOption[];
  const scores = doc.scores as ScoreMatrix;

  const missingPairs = validateCompleteness(criteria, options, scores);
  if (missingPairs.length > 0) {
    throw new IncompleteScoresError(missingPairs);
  }

  const analysis = runAnalysis(criteria, options, scores);
  const updated = await decisionRepository.update(id, { analysis });
  return updated ?? doc;
}
