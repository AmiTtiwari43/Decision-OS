import mongoose from 'mongoose';
import { evaluateDecision, ValidationError } from '@decision-os/decision-engine';
import type {
  EngineEvaluationInput,
  EngineResult,
} from '@decision-os/decision-engine';
import { decisionRepository } from '../repositories/decision.repository.js';
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
  return copy;
}

// ─── Public Service Methods ───────────────────────────────────────────────────

export async function createDecision(
  input: Record<string, unknown>
): Promise<DecisionDocument> {
  const sanitized = stripServerFields(input) as unknown as Parameters<typeof decisionRepository.create>[0];

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

export async function getDecision(id: string): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }
  const doc = await decisionRepository.findById(id);
  if (!doc) {
    throw new DecisionNotFoundError(id);
  }
  return doc;
}

export async function listDecisions(
  filter?: ListDecisionsFilter,
  pagination?: PaginationOptions
): Promise<PaginatedResult<DecisionDocument>> {
  return decisionRepository.list(filter, pagination);
}

export async function updateDecision(
  id: string,
  data: Record<string, unknown>
): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

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

export async function deleteDecision(id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }
  const deleted = await decisionRepository.delete(id);
  if (!deleted) {
    throw new DecisionNotFoundError(id);
  }
}

export async function analyzeDecision(id: string): Promise<DecisionDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new InvalidDecisionIdError(id);
  }

  const doc = await decisionRepository.findById(id);
  if (!doc) {
    throw new DecisionNotFoundError(id);
  }

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
