import type { DecisionDto } from '../api/index.js';

export type EvaluationStatus = 'decisive' | 'tie' | 'stale' | 'draft';

/**
 * Determines whether a decision has a valid, authoritative MCDA evaluation,
 * distinguishing decisive results, mathematical ties, stale results, and drafts.
 * In the canonical engine, ties intentionally have winnerId: null while analysis remains authoritative.
 */
export function getDecisionEvaluationStatus(decision: DecisionDto): EvaluationStatus {
  // Check if explicitly flagged as stale/invalidated by backend contract
  const isExplicitlyStale = Boolean(
    (decision as any).isStale ||
    (decision as any).status === 'stale' ||
    (decision.analysis as any)?.isStale ||
    (decision.analysis as any)?.status === 'stale' ||
    (decision as any).status === 'invalidated' ||
    (decision.analysis as any)?.status === 'invalidated'
  );
  if (isExplicitlyStale) {
    return 'stale';
  }

  const analysis = decision.analysis;
  if (!analysis || typeof analysis !== 'object') {
    return 'draft';
  }

  // Missing or malformed evaluation metadata
  if (
    analysis.engineVersion !== '1.0.0' ||
    !Array.isArray(analysis.evaluations) ||
    typeof analysis.pointLead !== 'number' ||
    !analysis.normalizedWeights ||
    typeof analysis.normalizedWeights !== 'object'
  ) {
    return 'draft';
  }

  const decisionOptions = decision.options || [];
  const decisionCriteria = decision.criteria || [];

  // Inconsistency check: if evaluations array is populated, it must match current decision options
  if (decisionOptions.length > 0 && analysis.evaluations.length > 0) {
    if (decisionOptions.length !== analysis.evaluations.length) {
      return 'stale';
    }
    const optionIds = new Set(decisionOptions.map((o) => o.id));
    const allEvaluatedMatch = analysis.evaluations.every(
      (e: any) => {
        const id = e.option?.id ?? e.optionId;
        return id ? optionIds.has(id) : false;
      }
    );
    if (!allEvaluatedMatch) {
      return 'stale';
    }
  }

  // Inconsistency check: normalized weights must align with current decision criteria
  if (decisionCriteria.length > 0 && analysis.normalizedWeights) {
    const critIds = new Set(decisionCriteria.map((c) => c.id));
    const weightKeys = Object.keys(analysis.normalizedWeights);
    if (weightKeys.length > 0) {
      if (critIds.size !== weightKeys.length) {
        return 'stale';
      }
      const allCriteriaMatch = weightKeys.every((k) => critIds.has(k));
      if (!allCriteriaMatch) {
        return 'stale';
      }
    }
  }

  // Canonical tie evaluation: isTie is true or decisionOutcome is 'tie'
  if (analysis.isTie || analysis.decisionOutcome === 'tie') {
    if (!Array.isArray(analysis.tiedWinnerIds) || analysis.tiedWinnerIds.length < 2) {
      return 'draft';
    }
    if (decisionOptions.length > 0) {
      const allTiedExist = analysis.tiedWinnerIds.every((tiedId) =>
        decisionOptions.some((o) => o.id === tiedId)
      );
      if (!allTiedExist) {
        return 'stale';
      }
    }
    return 'tie';
  }

  // Canonical decisive evaluation: unique winner exists and isTie is false
  if (analysis.winnerId && !analysis.isTie) {
    if (decisionOptions.length > 0) {
      const winnerOption = decisionOptions.find((o) => o.id === analysis.winnerId);
      if (!winnerOption) {
        return 'stale';
      }
    }
    return 'decisive';
  }

  return 'draft';
}

