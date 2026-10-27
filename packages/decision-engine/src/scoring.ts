import type {
  EngineCriterion,
  EngineOption,
  OptionEvaluationResult,
  CriterionContribution,
} from './types';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

const EPSILON = 1e-9;

export function evaluateOptions(
  options: ReadonlyArray<EngineOption>,
  criteria: ReadonlyArray<EngineCriterion>,
  normalizedWeights: Record<string, number>,
  lockedIds: ReadonlyArray<string> = []
): {
  evaluations: OptionEvaluationResult[];
  isTie: boolean;
  decisionOutcome: 'decisive' | 'tie';
  winnerId: string | null;
  tiedWinnerIds: string[];
  pointLead: number;
} {
  const lockedSet = new Set<string>(lockedIds);
  for (const c of criteria) {
    if (c.isLocked) {
      lockedSet.add(c.id);
    }
  }

  // Pre-calculate dominant criterion for Tier 3
  // Dominant criterion: highest weight, ties broken by ID ascending ASCII
  const sortedCriteriaForDominance = [...criteria].sort((a, b) => {
    const wA = normalizedWeights[a.id] ?? 0;
    const wB = normalizedWeights[b.id] ?? 0;
    if (Math.abs(wB - wA) > EPSILON) {
      return wB - wA;
    }
    return a.id.localeCompare(b.id);
  });
  const dominantCriterion = sortedCriteriaForDominance[0];

  interface RawEvaluation {
    option: EngineOption;
    unroundedScore: number;
    weightedScore: number;
    contributions: CriterionContribution[];
    lockedPerformance: number;
    dominantScore: number;
    unweightedAvg: number;
  }

  const rawEvaluations: RawEvaluation[] = options.map(opt => {
    let unroundedScore = 0;
    let lockedPerformance = 0;
    let rawSum = 0;

    const contributions: CriterionContribution[] = criteria.map(c => {
      const rawScore = opt.scores[c.id];
      const weight = normalizedWeights[c.id] ?? 0;
      const weightedPoints = (weight / 100.0) * rawScore;

      unroundedScore += weightedPoints;
      rawSum += rawScore;

      if (lockedSet.has(c.id)) {
        lockedPerformance += weight * rawScore;
      }

      return {
        criterionId: c.id,
        rawScore,
        weight,
        weightedPoints: round2(weightedPoints),
        percentageOfTotal: 0,
      };
    });

    const weightedScore = round1(unroundedScore);

    // Calculate percentage of total for contributions
    for (const item of contributions) {
      (item as { percentageOfTotal: number }).percentageOfTotal =
        unroundedScore > 0 ? round1((item.weightedPoints / unroundedScore) * 100) : 0;
    }

    const unweightedAvg = rawSum / (criteria.length || 1);
    const dominantScore = dominantCriterion ? (opt.scores[dominantCriterion.id] ?? 0) : 0;

    return {
      option: opt,
      unroundedScore,
      weightedScore,
      contributions,
      lockedPerformance,
      dominantScore,
      unweightedAvg,
    };
  });

  // Presentation Order Sorting: Tiers 1-5
  const presentationSorted = [...rawEvaluations].sort((a, b) => {
    // Tier 1: unroundedScore descending
    const scoreDiff = b.unroundedScore - a.unroundedScore;
    if (Math.abs(scoreDiff) >= EPSILON) {
      return scoreDiff;
    }

    // Tier 2: Locked criteria performance descending
    const lockedDiff = b.lockedPerformance - a.lockedPerformance;
    if (Math.abs(lockedDiff) >= EPSILON) {
      return lockedDiff;
    }

    // Tier 3: Dominant criterion score descending
    const domDiff = b.dominantScore - a.dominantScore;
    if (Math.abs(domDiff) >= EPSILON) {
      return domDiff;
    }

    // Tier 4: Unweighted average descending
    const avgDiff = b.unweightedAvg - a.unweightedAvg;
    if (Math.abs(avgDiff) >= EPSILON) {
      return avgDiff;
    }

    // Tier 5: Option ID ascending ASCII
    return a.option.id.localeCompare(b.option.id);
  });

  // Standard Competition Ranking (1224 Ranking)
  // First, sort strictly by unroundedScore descending to assign mathematical ranks
  const scoreSorted = [...rawEvaluations].sort((a, b) => b.unroundedScore - a.unroundedScore);

  const optionRanks = new Map<string, number>();
  let currentRank = 1;
  for (let i = 0; i < scoreSorted.length; i++) {
    if (i > 0) {
      const prevScore = scoreSorted[i - 1].unroundedScore;
      const currScore = scoreSorted[i].unroundedScore;
      if (Math.abs(prevScore - currScore) >= EPSILON) {
        currentRank = i + 1;
      }
    }
    optionRanks.set(scoreSorted[i].option.id, currentRank);
  }

  const leaderScore = presentationSorted[0]?.unroundedScore ?? 0;
  const runnerUpScore = presentationSorted[1]?.unroundedScore ?? leaderScore;
  const pointLead = round1(leaderScore - runnerUpScore);

  // Check top rank ties
  const topRankOptions = scoreSorted.filter(
    item => Math.abs(item.unroundedScore - leaderScore) < EPSILON
  );
  const isTie = topRankOptions.length > 1;
  const decisionOutcome: 'decisive' | 'tie' = isTie ? 'tie' : 'decisive';
  const winnerId = isTie ? null : presentationSorted[0]?.option.id ?? null;
  const tiedWinnerIds = isTie ? topRankOptions.map(t => t.option.id) : [];

  const evaluations: OptionEvaluationResult[] = presentationSorted.map((item, index) => {
    const rank = optionRanks.get(item.option.id) ?? index + 1;
    const scoreDiff = round1(leaderScore - item.unroundedScore);

    return {
      optionId: item.option.id,
      optionName: item.option.name,
      unroundedScore: item.unroundedScore,
      weightedScore: item.weightedScore,
      rank,
      presentationOrder: index + 1,
      scoreDifferenceToLeader: scoreDiff,
      contributions: item.contributions,
    };
  });

  return {
    evaluations,
    isTie,
    decisionOutcome,
    winnerId,
    tiedWinnerIds,
    pointLead,
  };
}
