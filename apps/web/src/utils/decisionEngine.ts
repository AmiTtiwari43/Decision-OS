import type {
  Criterion,
  Option,
  OptionEvaluation,
  ContributionItem,
  DeltaDriver,
  SensitivityAnalysis,
  ExplainabilitySummary,
  EngineResult,
} from '../types/decision';

/**
 * Normalizes raw weights so they sum to exactly 100%.
 * Supports locked weights which remain unchanged while distributing remainder to unlocked weights.
 */
export function normalizeWeights(
  rawWeights: Record<string, number>,
  criteria: Criterion[],
  lockedIds: string[] = []
): Record<string, number> {
  const result: Record<string, number> = {};
  
  // Calculate total locked weight
  let lockedSum = 0;
  lockedIds.forEach(id => {
    const val = Math.max(0, Math.min(100, rawWeights[id] || 0));
    lockedSum += val;
  });

  // Clamp lockedSum to 100
  if (lockedSum >= 100) {
    criteria.forEach(c => {
      if (lockedIds.includes(c.id)) {
        result[c.id] = Number(((rawWeights[c.id] || 0) / lockedSum * 100).toFixed(1));
      } else {
        result[c.id] = 0;
      }
    });
    return result;
  }

  const remainingTarget = 100 - lockedSum;
  const unlockedCriteria = criteria.filter(c => !lockedIds.includes(c.id));

  // If no unlocked criteria, just return as is
  if (unlockedCriteria.length === 0) {
    criteria.forEach(c => {
      result[c.id] = Number((rawWeights[c.id] || 0).toFixed(1));
    });
    return result;
  }

  // Calculate sum of unlocked weights
  let unlockedSum = 0;
  unlockedCriteria.forEach(c => {
    unlockedSum += Math.max(0, rawWeights[c.id] || 0);
  });

  // Set locked values directly
  lockedIds.forEach(id => {
    result[id] = Number((rawWeights[id] || 0).toFixed(1));
  });

  // Distribute remaining target
  if (unlockedSum === 0) {
    const evenSplit = remainingTarget / unlockedCriteria.length;
    unlockedCriteria.forEach(c => {
      result[c.id] = Number(evenSplit.toFixed(1));
    });
  } else {
    unlockedCriteria.forEach(c => {
      const proportion = (rawWeights[c.id] || 0) / unlockedSum;
      result[c.id] = Number((proportion * remainingTarget).toFixed(1));
    });
  }

  // Correction pass for small rounding error to ensure exactly 100%
  const totalSum = Object.values(result).reduce((acc, v) => acc + v, 0);
  const diff = Number((100 - totalSum).toFixed(1));
  if (diff !== 0 && unlockedCriteria.length > 0) {
    const firstUnlocked = unlockedCriteria[0].id;
    result[firstUnlocked] = Number((result[firstUnlocked] + diff).toFixed(1));
  }

  return result;
}

/**
 * Calculates weighted score and detailed contributions for a single option.
 */
export function evaluateOption(
  option: Option,
  criteria: Criterion[],
  normalizedWeights: Record<string, number>
): Omit<OptionEvaluation, 'rank' | 'scoreDifferenceToLeader'> {
  let totalWeightedScore = 0;
  let rawSum = 0;

  const contributions: ContributionItem[] = criteria.map(c => {
    const rawScore = option.scores[c.id] ?? 50;
    const weight = normalizedWeights[c.id] ?? 0;
    const weightedPoints = (rawScore * weight) / 100;

    totalWeightedScore += weightedPoints;
    rawSum += rawScore;

    return {
      criterionId: c.id,
      criterionName: c.name,
      shortName: c.shortName,
      rawScore,
      weight,
      weightedPoints: Number(weightedPoints.toFixed(2)),
      percentageOfTotal: 0,
    };
  });

  const finalScore = Number(totalWeightedScore.toFixed(1));

  contributions.forEach(item => {
    item.percentageOfTotal =
      finalScore > 0 ? Number(((item.weightedPoints / finalScore) * 100).toFixed(1)) : 0;
  });

  return {
    option,
    weightedScore: finalScore,
    rawScoreAvg: Number((rawSum / (criteria.length || 1)).toFixed(1)),
    contributions,
  };
}

/**
 * Performs sensitivity analysis to identify the exact tipping point weight for each criterion
 * where the runner-up overtakes the current winner.
 */
export function calculateSensitivity(
  winnerEval: OptionEvaluation,
  runnerUpEval: OptionEvaluation | null,
  criteria: Criterion[],
  weights: Record<string, number>
): SensitivityAnalysis[] {
  if (!runnerUpEval) return [];

  const winner = winnerEval.option;
  const runnerUp = runnerUpEval.option;

  return criteria.map(c => {
    const k = c.id;
    const currentWeight = weights[k] ?? 0;
    const sAk = winner.scores[k] ?? 50;
    const sBk = runnerUp.scores[k] ?? 50;

    let R_A = 0;
    let R_B = 0;
    criteria.forEach(other => {
      if (other.id !== k) {
        const w = (weights[other.id] ?? 0) / 100;
        R_A += (winner.scores[other.id] ?? 50) * w;
        R_B += (runnerUp.scores[other.id] ?? 50) * w;
      }
    });

    const deltaR = 100 * (R_A - R_B);
    const deltaS = sAk - sBk;
    const denominator = deltaR - deltaS * (100 - currentWeight);

    let tippingPointWeight: number | null = null;
    let weightDeltaNeeded: number | null = null;
    let wouldFlip = false;

    if (denominator !== 0) {
      const w_star = (100 * deltaR) / denominator;
      if (w_star > 0 && w_star <= 95) {
        tippingPointWeight = Number(w_star.toFixed(1));
        weightDeltaNeeded = Number((tippingPointWeight - currentWeight).toFixed(1));
        wouldFlip = true;
      }
    }

    let feasibility: 'low-threshold' | 'medium-threshold' | 'unreachable' = 'unreachable';
    let summary = '';

    if (wouldFlip && tippingPointWeight !== null && weightDeltaNeeded !== null) {
      const absDelta = Math.abs(weightDeltaNeeded);
      if (absDelta <= 15) {
        feasibility = 'low-threshold';
        summary = `Shifting ${c.name} from ${currentWeight}% to ${tippingPointWeight}% (${weightDeltaNeeded > 0 ? '+' : ''}${weightDeltaNeeded}%) causes ${runnerUp.name} to win.`;
      } else if (absDelta <= 35) {
        feasibility = 'medium-threshold';
        summary = `If ${c.name} becomes a dominant priority at ${tippingPointWeight}%, ${runnerUp.name} takes the lead.`;
      } else {
        feasibility = 'unreachable';
        summary = `Requires extreme weighting (${tippingPointWeight}%) to change the outcome.`;
      }
    } else {
      if (sAk >= sBk) {
        summary = `${winner.name} maintains an advantage here; increasing this weight solidifies its lead.`;
      } else {
        summary = `Even at high priority, ${c.name} alone is insufficient to overturn the score difference.`;
      }
    }

    return {
      criterionId: c.id,
      criterionName: c.name,
      shortName: c.shortName,
      currentWeight,
      tippingPointWeight,
      weightDeltaNeeded,
      wouldFlipToOptionId: wouldFlip ? runnerUp.id : null,
      wouldFlipToOptionName: wouldFlip ? runnerUp.name : null,
      feasibility,
      summary,
    };
  });
}

/**
 * Synthesizes transparent plain-English explainability drivers without any hallucinations or generic fluff.
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
    ? Number((winnerEval.weightedScore - runnerUpEval.weightedScore).toFixed(1))
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

  const drivers: DeltaDriver[] = criteria.map(c => {
    const w = weights[c.id] ?? 0;
    const wScore = winner.scores[c.id] ?? 50;
    const rScore = runnerUp.scores[c.id] ?? 50;
    const rawDiff = wScore - rScore;
    const pointAdvantage = Number(((rawDiff * w) / 100).toFixed(2));

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
    .filter(d => d.pointAdvantage > 0)
    .sort((a, b) => b.pointAdvantage - a.pointAdvantage);

  const concededAreas = drivers
    .filter(d => d.pointAdvantage < 0)
    .sort((a, b) => a.pointAdvantage - b.pointAdvantage);

  let headline = '';
  if (pointLead > 8) {
    headline = `${winner.name} holds a decisive +${pointLead} pt lead over ${runnerUp.name}.`;
  } else if (pointLead >= 3) {
    headline = `${winner.name} fits your current priorities better (+${pointLead} pts).`;
  } else {
    headline = `${winner.name} narrowly leads ${runnerUp.name} by +${pointLead} pts in a close contest.`;
  }

  const topAdvantageNames = primaryDrivers.slice(0, 2).map(d => `${d.criterionName} (+${d.rawDiff} raw)`).join(' and ');
  const topConcededNames = concededAreas.slice(0, 2).map(d => `${d.criterionName} (-${Math.abs(d.rawDiff)} raw)`).join(' and ');

  let dynamicRationale = `${winner.name} ranks highest because your current weights favor its strengths in ${topAdvantageNames || 'core metrics'}.`;
  if (concededAreas.length > 0) {
    dynamicRationale += ` This effectively offsets ${runnerUp.name}'s advantage in ${topConcededNames}.`;
  }

  const accessibleTippingPoint = sensitivity
    .filter(s => s.feasibility === 'low-threshold' && s.weightDeltaNeeded !== null && s.weightDeltaNeeded > 0)
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
 */
export function runDecisionEngine(
  options: Option[],
  criteria: Criterion[],
  rawWeights: Record<string, number>,
  lockedIds: string[] = []
): EngineResult {
  const normalizedWeights = normalizeWeights(rawWeights, criteria, lockedIds);

  const rawEvaluations = options.map(opt => evaluateOption(opt, criteria, normalizedWeights));

  rawEvaluations.sort((a, b) => b.weightedScore - a.weightedScore);

  const leaderScore = rawEvaluations[0]?.weightedScore || 0;

  const evaluations: OptionEvaluation[] = rawEvaluations.map((item, index) => ({
    ...item,
    rank: index + 1,
    scoreDifferenceToLeader: Number((leaderScore - item.weightedScore).toFixed(1)),
  }));

  const winner = evaluations[0];
  const runnerUp = evaluations.length > 1 ? evaluations[1] : null;

  const sensitivity = calculateSensitivity(winner, runnerUp, criteria, normalizedWeights);
  const explainability = generateExplainability(winner, runnerUp, criteria, normalizedWeights, sensitivity);

  const totalWeight = Number(Object.values(normalizedWeights).reduce((a, b) => a + b, 0).toFixed(1));

  return {
    evaluations,
    winner,
    runnerUp,
    normalizedWeights,
    totalWeight,
    sensitivity,
    explainability,
  };
}
