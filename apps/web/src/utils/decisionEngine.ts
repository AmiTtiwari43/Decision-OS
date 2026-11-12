import {
  normalizeWeights as canonicalNormalizeWeights,
  validateInput,
  evaluateDecision,
  calculateSensitivity as canonicalCalculateSensitivity,
  ValidationError,
  type EngineCriterion,
  type EngineOption,
} from '@decision-os/decision-engine';
import { mapServerAnalysisToEngineResult } from './engineMapper.js';
import type {
  Criterion,
  Option,
  OptionEvaluation,
  ContributionItem,
  DeltaDriver,
  SensitivityAnalysis,
  ExplainabilitySummary,
  EvaluatedEngineResult,
} from '../types/decision.js';

export { ValidationError };

/**
 * Normalizes raw weights so they sum to exactly 100.0%.
 * Delegates to canonical Hare-Niemeyer (Largest Remainder) algorithm
 * with deterministic ASCII criterion-ID tie-breaking and locked weight preservation.
 */
export function normalizeWeights(
  rawWeights: Record<string, number>,
  criteria: Criterion[],
  lockedIds: string[] = []
): Record<string, number> {
  if (!criteria || criteria.length === 0) {
    return {};
  }

  const engineCriteria: EngineCriterion[] = criteria.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    weight: Math.max(0, rawWeights[c.id] ?? c.defaultWeight ?? 0),
    isLocked: lockedIds.includes(c.id),
  }));

  return canonicalNormalizeWeights(engineCriteria, lockedIds);
}

/**
 * Calculates weighted score and detailed contributions for a single option.
 * Strictly validates that every criterion has a finite numeric score in [0, 100].
 * Missing scores are rejected with ValidationError; never fabricated or defaulted to 50.
 */
export function evaluateOption(
  option: Option,
  criteria: Criterion[],
  normalizedWeights: Record<string, number>
): Omit<OptionEvaluation, 'rank' | 'scoreDifferenceToLeader'> {
  if (!criteria || criteria.length === 0) {
    throw new ValidationError('Decision matrix must contain at least one criterion');
  }

  if (!option || !option.scores || typeof option.scores !== 'object') {
    throw new ValidationError(`Option '${option?.id ?? 'unknown'}' is missing a scores object`);
  }

  let totalWeightedScore = 0;
  let rawSum = 0;

  const contributions: ContributionItem[] = criteria.map((c) => {
    const rawScore = option.scores[c.id];
    if (rawScore === undefined || rawScore === null) {
      throw new ValidationError(
        `Option '${option.id}' is missing required score for criterion '${c.id}'`
      );
    }
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) {
      throw new ValidationError(
        `Score for option '${option.id}' on criterion '${c.id}' must be a finite number`
      );
    }
    if (rawScore < 0.0 || rawScore > 100.0) {
      throw new ValidationError(
        `Score for option '${option.id}' on criterion '${c.id}' must be between 0.0 and 100.0 (received ${rawScore})`
      );
    }

    const weight = normalizedWeights[c.id] ?? 0;
    const weightedPoints = (rawScore * weight) / 100.0;

    totalWeightedScore += weightedPoints;
    rawSum += rawScore;

    return {
      criterionId: c.id,
      criterionName: c.name,
      shortName: c.shortName,
      rawScore,
      weight,
      weightedPoints: Math.round(weightedPoints * 100) / 100,
      percentageOfTotal: 0,
    };
  });

  const finalScore = Math.round(totalWeightedScore * 10) / 10;

  contributions.forEach((item) => {
    item.percentageOfTotal =
      totalWeightedScore > 0
        ? Math.round(((item.weightedPoints / totalWeightedScore) * 100) * 10) / 10
        : 0;
  });

  return {
    option,
    weightedScore: finalScore,
    rawScoreAvg: Math.round((rawSum / (criteria.length || 1)) * 10) / 10,
    contributions,
  };
}

/**
 * Performs sensitivity analysis to identify the exact tipping point weight for each criterion
 * where the runner-up overtakes the current winner.
 * Delegates to canonical closed-form sensitivity equation with frozen locked weights.
 */
export function calculateSensitivity(
  winnerEval: OptionEvaluation,
  runnerUpEval: OptionEvaluation | null,
  criteria: Criterion[],
  weights: Record<string, number>,
  lockedIds: string[] = []
): SensitivityAnalysis[] {
  if (!runnerUpEval) {
    return criteria.map((c) => ({
      criterionId: c.id,
      criterionName: c.name,
      shortName: c.shortName,
      currentWeight: weights[c.id] ?? 0,
      tippingPointWeight: null,
      weightDeltaNeeded: null,
      wouldFlipToOptionId: null,
      wouldFlipToOptionName: null,
      feasibility: 'unreachable',
      summary: 'Add a second option to calculate sensitivity thresholds.',
    }));
  }

  const engineCriteria: EngineCriterion[] = criteria.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    weight: weights[c.id] ?? c.defaultWeight ?? 0,
    isLocked: lockedIds.includes(c.id),
  }));

  const leaderOpt: EngineOption = {
    id: winnerEval.option.id,
    name: winnerEval.option.name,
    scores: winnerEval.option.scores,
  };

  const challengerOpt: EngineOption = {
    id: runnerUpEval.option.id,
    name: runnerUpEval.option.name,
    scores: runnerUpEval.option.scores,
  };

  const canonicalTipping = canonicalCalculateSensitivity(
    leaderOpt,
    challengerOpt,
    engineCriteria,
    weights,
    lockedIds
  );

  const criteriaMap = new Map(criteria.map((c) => [c.id, c]));

  return canonicalTipping.map((t) => {
    const c = criteriaMap.get(t.criterionId);
    return {
      criterionId: t.criterionId,
      criterionName: c?.name ?? t.criterionId,
      shortName: c?.shortName ?? t.criterionId,
      currentWeight: t.currentWeight,
      tippingPointWeight: t.tippingPointWeight,
      weightDeltaNeeded: t.weightDeltaNeeded,
      wouldFlipToOptionId: t.wouldFlipToOptionId,
      wouldFlipToOptionName: t.wouldFlipToOptionId ? runnerUpEval.option.name : null,
      feasibility: t.feasibility,
      summary: t.summary,
    };
  });
}

/**
 * Synthesizes transparent plain-English explainability drivers without any hallucinations or fabricated fallbacks.
 */
export function generateExplainability(
  winnerEval: OptionEvaluation,
  runnerUpEval: OptionEvaluation | null,
  criteria: Criterion[],
  weights: Record<string, number>,
  sensitivity: SensitivityAnalysis[]
): ExplainabilitySummary {
  const winner = winnerEval.option;
  const runnerUp = runnerUpEval ? runnerUpEval.option : null;
  const pointLead = runnerUpEval
    ? Math.round((winnerEval.weightedScore - runnerUpEval.weightedScore) * 10) / 10
    : winnerEval.weightedScore;

  if (!runnerUp) {
    return {
      winningOption: winner,
      runnerUpOption: null,
      pointLead,
      headline: `${winner.name} is the sole evaluated option.`,
      primaryDrivers: [],
      concededAreas: [],
      dynamicRationale: `${winner.name} achieved an overall score of ${winnerEval.weightedScore}.`,
      sensitivityStatement: 'Add a second option to compare trade-offs and sensitivity thresholds.',
    };
  }

  const drivers: DeltaDriver[] = criteria.map((c) => {
    const w = weights[c.id] ?? 0;
    const wScore = winner.scores[c.id] ?? 0;
    const rScore = runnerUp.scores[c.id] ?? 0;
    const rawDiff = wScore - rScore;
    const pointAdvantage = Math.round(((rawDiff * w) / 100.0) * 100) / 100;

    return {
      criterionId: c.id,
      criterionName: c.name,
      shortName: c.shortName,
      weight: w,
      winnerScore: wScore,
      runnerUpScore: rScore,
      pointAdvantage,
      rawDiff,
    };
  });

  const primaryDrivers = drivers
    .filter((d) => d.pointAdvantage > 0)
    .sort((a, b) => b.pointAdvantage - a.pointAdvantage);

  const concededAreas = drivers
    .filter((d) => d.pointAdvantage < 0)
    .sort((a, b) => a.pointAdvantage - b.pointAdvantage);

  let headline = '';
  if (Math.abs(pointLead) < 1e-9) {
    headline = `Mathematical Tie: ${winner.name} and ${runnerUp.name} share identical scores (${winnerEval.weightedScore} pts).`;
  } else if (pointLead > 8) {
    headline = `${winner.name} holds a decisive +${pointLead} pt lead over ${runnerUp.name}.`;
  } else if (pointLead >= 3) {
    headline = `${winner.name} fits your current priorities better (+${pointLead} pts).`;
  } else {
    headline = `${winner.name} narrowly leads ${runnerUp.name} by +${pointLead} pts in a close contest.`;
  }

  const topAdvantageNames = primaryDrivers
    .slice(0, 2)
    .map((d) => `${d.criterionName} (+${d.rawDiff} raw)`)
    .join(' and ');
  const topConcededNames = concededAreas
    .slice(0, 2)
    .map((d) => `${d.criterionName} (-${Math.abs(d.rawDiff)} raw)`)
    .join(' and ');

  let dynamicRationale = '';
  if (Math.abs(pointLead) < 1e-9) {
    dynamicRationale = `The decision resulted in an exact tie under canonical Hare-Niemeyer normalization. Neither option holds a mathematically decisive advantage.`;
  } else {
    dynamicRationale = `${winner.name} ranks highest because your current weights favor its strengths in ${topAdvantageNames || 'core metrics'}.`;
    if (concededAreas.length > 0) {
      dynamicRationale += ` This effectively offsets ${runnerUp.name}'s advantage in ${topConcededNames}.`;
    }
  }

  const accessibleTippingPoint = sensitivity
    .filter(
      (s) =>
        s.feasibility === 'low-threshold' &&
        s.weightDeltaNeeded !== null &&
        s.weightDeltaNeeded > 0
    )
    .sort((a, b) => (a.weightDeltaNeeded || 999) - (b.weightDeltaNeeded || 999))[0];

  let sensitivityStatement = '';
  if (accessibleTippingPoint && accessibleTippingPoint.tippingPointWeight !== null) {
    sensitivityStatement = `If ${accessibleTippingPoint.criterionName} weight increases from ${accessibleTippingPoint.currentWeight}% to ${accessibleTippingPoint.tippingPointWeight}%, ${runnerUp.name} becomes the stronger choice.`;
  } else {
    sensitivityStatement = `The current ranking is robust against moderate single-criterion adjustments.`;
  }

  return {
    winningOption: winner,
    runnerUpOption: runnerUp,
    pointLead,
    headline,
    primaryDrivers,
    concededAreas,
    dynamicRationale,
    sensitivityStatement,
  };
}

/**
 * Main execution function for the Decision OS Engine.
 * Evaluates all options, normalizes weights, calculates sensitivity, and generates explainability.
 * Delegates strictly to canonical @decision-os/decision-engine.
 */
export function runDecisionEngine(
  options: Option[],
  criteria: Criterion[],
  rawWeights: Record<string, number>,
  lockedIds: string[] = []
): EvaluatedEngineResult {
  const engineCriteria: EngineCriterion[] = criteria.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    weight: Math.max(0, rawWeights[c.id] ?? c.defaultWeight ?? 0),
    isLocked: lockedIds.includes(c.id),
  }));

  const engineOptions: EngineOption[] = options.map((o) => ({
    id: o.id,
    name: o.name,
    scores: o.scores,
  }));

  // Canonical strict validation: rejects empty sets, non-finite scores, out-of-range scores, missing scores
  validateInput(engineCriteria, engineOptions);

  // Canonical evaluation: normalization, dual-precision scoring, competition ranking, sensitivity, cryptographic hashes
  const canonicalResult = evaluateDecision({
    criteria: engineCriteria,
    options: engineOptions,
    lockedIds,
  });

  const mapped = mapServerAnalysisToEngineResult(canonicalResult, options, criteria);

  return {
    ...mapped,
    isAuthoritative: false,
  };
}
