import type {
  EngineCriterion,
  EngineOption,
  TippingPointResult,
} from './types';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

const EPSILON = 1e-9;

export function calculateSensitivity(
  leader: EngineOption,
  challenger: EngineOption | null,
  criteria: ReadonlyArray<EngineCriterion>,
  normalizedWeights: Record<string, number>,
  lockedIds: ReadonlyArray<string> = []
): TippingPointResult[] {
  if (!challenger) {
    return criteria.map(c => ({
      criterionId: c.id,
      currentWeight: normalizedWeights[c.id] ?? 0,
      tippingPointWeight: null,
      weightDeltaNeeded: null,
      direction: 'none',
      feasibility: 'unreachable',
      wouldFlipToOptionId: null,
      summary: 'Add a second option to calculate sensitivity thresholds.',
    }));
  }

  const lockedSet = new Set<string>(lockedIds);
  for (const c of criteria) {
    if (c.isLocked) {
      lockedSet.add(c.id);
    }
  }

  // Total locked weight
  let S_L = 0;
  for (const c of criteria) {
    if (lockedSet.has(c.id)) {
      S_L += normalizedWeights[c.id] ?? 0;
    }
  }
  S_L = round1(S_L);

  const unlockedCriteria = criteria.filter(c => !lockedSet.has(c.id));

  return criteria.map(c => {
    const k = c.id;
    const currentWeight = normalizedWeights[k] ?? 0;

    // Locked criterion cannot be adjusted in single-criterion sensitivity
    if (lockedSet.has(k)) {
      return {
        criterionId: k,
        currentWeight,
        tippingPointWeight: null,
        weightDeltaNeeded: null,
        direction: 'none',
        feasibility: 'unreachable',
        wouldFlipToOptionId: null,
        summary: `Criterion '${c.name}' is locked and cannot be varied.`,
      };
    }

    // Must have at least one other unlocked criterion to absorb the weight shift
    const otherUnlocked = unlockedCriteria.filter(u => u.id !== k);
    if (otherUnlocked.length === 0) {
      return {
        criterionId: k,
        currentWeight,
        tippingPointWeight: null,
        weightDeltaNeeded: null,
        direction: 'none',
        feasibility: 'unreachable',
        wouldFlipToOptionId: null,
        summary: 'No other unlocked criteria exist to absorb weight changes.',
      };
    }

    const W_other = 100.0 - S_L - currentWeight;
    if (W_other <= EPSILON) {
      return {
        criterionId: k,
        currentWeight,
        tippingPointWeight: null,
        weightDeltaNeeded: null,
        direction: 'none',
        feasibility: 'unreachable',
        wouldFlipToOptionId: null,
        summary: 'Criterion already consumes 100% of the available unlocked budget.',
      };
    }

    const sAk = leader.scores[k];
    const sBk = challenger.scores[k];
    const delta_s_k = sAk - sBk;

    // Delta R_L: weighted score difference on locked criteria
    let delta_R_L = 0;
    for (const l of criteria) {
      if (lockedSet.has(l.id)) {
        const w_l = (normalizedWeights[l.id] ?? 0) / 100.0;
        delta_R_L += w_l * (leader.scores[l.id] - challenger.scores[l.id]);
      }
    }

    // Delta R_U: weighted score difference on other unlocked criteria under current weights
    let delta_R_U = 0;
    for (const u of otherUnlocked) {
      const w_u = (normalizedWeights[u.id] ?? 0) / 100.0;
      delta_R_U += w_u * (leader.scores[u.id] - challenger.scores[u.id]);
    }

    // Closed-form Tipping Equation (CANONICAL_DECISION_ENGINE_V1_SPEC Section 5.8)
    const numerator = 100.0 * ((100.0 - S_L) * delta_R_U + (100.0 - S_L - currentWeight) * delta_R_L);
    const denominator = 100.0 * delta_R_U - delta_s_k * (100.0 - S_L - currentWeight);

    let tippingPointWeight: number | null = null;
    let weightDeltaNeeded: number | null = null;
    let direction: 'increase' | 'decrease' | 'none' = 'none';
    let feasibility: 'low-threshold' | 'medium-threshold' | 'unreachable' = 'unreachable';
    let wouldFlipToOptionId: string | null = null;
    let summary = '';

    if (Math.abs(denominator) < EPSILON || Math.abs(delta_s_k) < EPSILON) {
      summary = `Changing '${c.name}' weight cannot alter the outcome.`;
    } else {
      const w_star = numerator / denominator;
      const maxAllowed = 100.0 - S_L;

      if (w_star >= -EPSILON && w_star <= maxAllowed + EPSILON) {
        const clampedWStar = Math.max(0.0, Math.min(maxAllowed, w_star));
        tippingPointWeight = round1(clampedWStar);
        weightDeltaNeeded = round1(tippingPointWeight - currentWeight);

        if (weightDeltaNeeded > EPSILON) {
          direction = 'increase';
        } else if (weightDeltaNeeded < -EPSILON) {
          direction = 'decrease';
        } else {
          direction = 'none';
        }

        const absDelta = Math.abs(weightDeltaNeeded);
        if (absDelta <= 15.0) {
          feasibility = 'low-threshold';
        } else if (absDelta <= 35.0) {
          feasibility = 'medium-threshold';
        } else {
          feasibility = 'unreachable';
        }

        wouldFlipToOptionId = challenger.id;
        summary = `Shifting ${c.name} from ${currentWeight}% to ${tippingPointWeight}% (${weightDeltaNeeded > 0 ? '+' : ''}${weightDeltaNeeded}%) causes ${challenger.name} to overtake.`;
      } else {
        summary = `No feasible weight in [0%, ${round1(maxAllowed)}%] causes an outcome reversal.`;
      }
    }

    return {
      criterionId: k,
      currentWeight,
      tippingPointWeight,
      weightDeltaNeeded,
      direction,
      feasibility,
      wouldFlipToOptionId,
      summary,
    };
  });
}
