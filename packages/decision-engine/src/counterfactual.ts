import type {
  EngineCriterion,
  EngineOption,
  OptionScoreSensitivityResult,
  MultiParameterCounterfactualResult,
  CounterfactualWeightShift,
} from './types';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

const EPSILON = 1e-9;

/**
 * Calculates raw score sensitivity for each criterion.
 * Determines what raw score decrease on the Leader, or raw score increase on the Challenger,
 * would bring the two options to a tie / breakeven point.
 */
export function calculateOptionScoreSensitivity(
  leader: EngineOption,
  challenger: EngineOption | null,
  criteria: ReadonlyArray<EngineCriterion>,
  normalizedWeights: Record<string, number>
): OptionScoreSensitivityResult[] {
  if (!challenger) {
    return criteria.map(c => ({
      criterionId: c.id,
      criterionName: c.name,
      weight: normalizedWeights[c.id] ?? 0,
      scoreDeltaNeeded: null,
      leaderThresholdScore: null,
      challengerThresholdScore: null,
      feasibility: 'unreachable',
      summary: 'Add a second option to calculate option-score sensitivity.',
    }));
  }

  // Calculate current point lead Delta = Score(leader) - Score(challenger)
  let leaderScore = 0;
  let challengerScore = 0;
  for (const c of criteria) {
    const w = (normalizedWeights[c.id] ?? 0) / 100.0;
    leaderScore += w * (leader.scores[c.id] ?? 0);
    challengerScore += w * (challenger.scores[c.id] ?? 0);
  }
  const deltaLead = Math.max(0, leaderScore - challengerScore);

  if (deltaLead < EPSILON) {
    // Current winner already tied
    return criteria.map(c => ({
      criterionId: c.id,
      criterionName: c.name,
      weight: normalizedWeights[c.id] ?? 0,
      scoreDeltaNeeded: 0,
      leaderThresholdScore: leader.scores[c.id] ?? 0,
      challengerThresholdScore: challenger.scores[c.id] ?? 0,
      feasibility: 'feasible',
      summary: `Options '${leader.name}' and '${challenger.name}' are currently tied.`,
    }));
  }

  return criteria.map(c => {
    const w = normalizedWeights[c.id] ?? 0;
    const currentLeaderScore = leader.scores[c.id] ?? 0;
    const currentChallengerScore = challenger.scores[c.id] ?? 0;

    if (w < EPSILON) {
      return {
        criterionId: c.id,
        criterionName: c.name,
        weight: w,
        scoreDeltaNeeded: null,
        leaderThresholdScore: null,
        challengerThresholdScore: null,
        feasibility: 'unreachable',
        summary: `Criterion '${c.name}' has 0% weight and cannot alter the decision outcome.`,
      };
    }

    // Delta score needed on this criterion: deltaScore = (100 * deltaLead) / w
    const scoreDeltaNeeded = (100.0 * deltaLead) / w;

    // Leader score must decrease by scoreDeltaNeeded
    const rawLeaderTarget = currentLeaderScore - scoreDeltaNeeded;
    // Challenger score must increase by scoreDeltaNeeded
    const rawChallengerTarget = currentChallengerScore + scoreDeltaNeeded;

    const leaderFeasible = rawLeaderTarget >= -EPSILON;
    const challengerFeasible = rawChallengerTarget <= 100.0 + EPSILON;

    const leaderThresholdScore = leaderFeasible ? round1(Math.max(0, rawLeaderTarget)) : null;
    const challengerThresholdScore = challengerFeasible ? round1(Math.min(100, rawChallengerTarget)) : null;

    if (!leaderFeasible && !challengerFeasible) {
      return {
        criterionId: c.id,
        criterionName: c.name,
        weight: w,
        scoreDeltaNeeded: round1(scoreDeltaNeeded),
        leaderThresholdScore: null,
        challengerThresholdScore: null,
        feasibility: 'unreachable',
        summary: `Score shift of ${round1(scoreDeltaNeeded)} pts required on '${c.name}' exceeds the [0, 100] score bounds.`,
      };
    }

    let summaryParts: string[] = [];
    if (leaderThresholdScore !== null) {
      summaryParts.push(`${leader.name} score dropping to ${leaderThresholdScore}`);
    }
    if (challengerThresholdScore !== null) {
      summaryParts.push(`${challenger.name} score rising to ${challengerThresholdScore}`);
    }

    return {
      criterionId: c.id,
      criterionName: c.name,
      weight: w,
      scoreDeltaNeeded: round1(scoreDeltaNeeded),
      leaderThresholdScore,
      challengerThresholdScore,
      feasibility: 'feasible',
      summary: `Tie reached on '${c.name}' via ${summaryParts.join(' or ')}.`,
    };
  });
}

/**
 * Calculates the smallest combined weight change (multi-parameter counterfactual)
 * that causes the challenger to overtake or tie the leader.
 * Respects locked criteria and ensures weights stay non-negative and sum to 100%.
 */
export function calculateMultiParameterCounterfactual(
  leader: EngineOption,
  challenger: EngineOption | null,
  criteria: ReadonlyArray<EngineCriterion>,
  normalizedWeights: Record<string, number>,
  lockedIds: ReadonlyArray<string> = []
): MultiParameterCounterfactualResult {
  if (!challenger) {
    return {
      isFeasible: false,
      totalWeightShiftL1: 0,
      netShiftAmount: 0,
      shifts: [],
      targetOptionId: null,
      targetOptionName: null,
      summary: 'Add a second option to calculate counterfactual weight shifts.',
    };
  }

  const lockedSet = new Set<string>(lockedIds);
  for (const c of criteria) {
    if (c.isLocked) {
      lockedSet.add(c.id);
    }
  }

  // Calculate current score lead: Delta = Score(leader) - Score(challenger)
  let deltaLead = 0;
  for (const c of criteria) {
    const w = (normalizedWeights[c.id] ?? 0) / 100.0;
    deltaLead += w * ((leader.scores[c.id] ?? 0) - (challenger.scores[c.id] ?? 0));
  }

  if (deltaLead <= EPSILON) {
    return {
      isFeasible: true,
      totalWeightShiftL1: 0,
      netShiftAmount: 0,
      shifts: criteria.map(c => ({
        criterionId: c.id,
        criterionName: c.name,
        currentWeight: normalizedWeights[c.id] ?? 0,
        counterfactualWeight: normalizedWeights[c.id] ?? 0,
        delta: 0,
      })),
      targetOptionId: challenger.id,
      targetOptionName: challenger.name,
      summary: `Options '${leader.name}' and '${challenger.name}' are already tied or challenger is ahead.`,
    };
  }

  // Define challenger advantage per criterion: g_i = challenger.scores[i] - leader.scores[i]
  const unlocked = criteria.filter(c => !lockedSet.has(c.id));
  if (unlocked.length < 2) {
    return {
      isFeasible: false,
      totalWeightShiftL1: 0,
      netShiftAmount: 0,
      shifts: [],
      targetOptionId: challenger.id,
      targetOptionName: challenger.name,
      summary: 'At least 2 unlocked criteria are required to absorb combined weight shifts.',
    };
  }

  // Working copy of weights
  const currentW: Record<string, number> = {};
  for (const c of criteria) {
    currentW[c.id] = normalizedWeights[c.id] ?? 0;
  }

  // Advantage gradient g_i: higher g_i means shifting weight TO i helps challenger the most
  const items = unlocked.map(c => ({
    id: c.id,
    name: c.name,
    g: (challenger.scores[c.id] ?? 0) - (leader.scores[c.id] ?? 0),
    w: currentW[c.id] ?? 0,
  }));

  // Sort ascending by g so items[0] has lowest g (donor) and items[items.length - 1] has highest g (recipient)
  items.sort((a, b) => a.g - b.g);

  const bestAdvantage = items[items.length - 1].g;
  const worstAdvantage = items[0].g;

  if (bestAdvantage <= worstAdvantage + EPSILON || bestAdvantage <= 0) {
    // Challenger does not beat leader on any unlocked criterion
    return {
      isFeasible: false,
      totalWeightShiftL1: 0,
      netShiftAmount: 0,
      shifts: [],
      targetOptionId: challenger.id,
      targetOptionName: challenger.name,
      summary: `Challenger '${challenger.name}' does not have an advantage on any unlocked criterion.`,
    };
  }

  // Greedy water-filling weight shift:
  // Transfer weight from lowest g_i (donors) to highest g_j (recipients)
  let remainingLead = deltaLead; // in score points
  let donorIdx = 0;
  let recipientIdx = items.length - 1;
  const deltas: Record<string, number> = {};
  for (const c of criteria) {
    deltas[c.id] = 0;
  }

  let totalNetShift = 0;

  while (donorIdx < recipientIdx && remainingLead > EPSILON) {
    const donor = items[donorIdx];
    const recipient = items[recipientIdx];

    const efficiency = (recipient.g - donor.g) / 100.0; // score delta gain per 1% weight shifted
    if (efficiency <= EPSILON) {
      break;
    }

    // Weight needed to completely close remainingLead
    const weightNeeded = remainingLead / efficiency;
    // Available weight from current donor
    const availableWeight = donor.w;

    const shiftAmount = Math.min(weightNeeded, availableWeight);

    if (shiftAmount > 0) {
      deltas[donor.id] -= shiftAmount;
      deltas[recipient.id] += shiftAmount;
      donor.w -= shiftAmount;
      totalNetShift += shiftAmount;
      remainingLead -= shiftAmount * efficiency;
    }

    if (donor.w <= EPSILON) {
      donorIdx++;
    }
    if (remainingLead <= EPSILON) {
      break;
    }
    if (shiftAmount === 0 && donor.w > 0) {
      // Cannot make progress
      break;
    }
  }

  const isFeasible = remainingLead <= 1e-4;

  if (!isFeasible) {
    return {
      isFeasible: false,
      totalWeightShiftL1: round1(totalNetShift * 2),
      netShiftAmount: round1(totalNetShift),
      shifts: [],
      targetOptionId: challenger.id,
      targetOptionName: challenger.name,
      summary: `Insufficient unlocked weight available to overcome '${leader.name}' point lead.`,
    };
  }

  const shifts: CounterfactualWeightShift[] = criteria.map(c => {
    const cur = round1(normalizedWeights[c.id] ?? 0);
    const delta = round1(deltas[c.id] ?? 0);
    const counterfactualWeight = round1(Math.max(0, cur + delta));
    return {
      criterionId: c.id,
      criterionName: c.name,
      currentWeight: cur,
      counterfactualWeight,
      delta,
    };
  });

  const totalShiftL1 = round1(shifts.reduce((acc, s) => acc + Math.abs(s.delta), 0));
  const netShift = round1(shifts.filter(s => s.delta > 0).reduce((acc, s) => acc + s.delta, 0));

  const changedCriteria = shifts.filter(s => Math.abs(s.delta) > 0.1);
  const shiftDescriptions = changedCriteria
    .map(s => `${s.criterionName} (${s.delta > 0 ? '+' : ''}${s.delta}%)`)
    .join(', ');

  return {
    isFeasible: true,
    totalWeightShiftL1: totalShiftL1,
    netShiftAmount: netShift,
    shifts,
    targetOptionId: challenger.id,
    targetOptionName: challenger.name,
    summary: `Smallest counterfactual shift: ${netShift}% weight relocated [${shiftDescriptions}] inverts winner to '${challenger.name}'.`,
  };
}

