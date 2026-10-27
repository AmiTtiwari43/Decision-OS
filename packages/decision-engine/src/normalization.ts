import { ValidationError } from './errors';
import type { EngineCriterion } from './types';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function normalizeWeights(
  criteria: ReadonlyArray<EngineCriterion>,
  lockedIds: ReadonlyArray<string> = []
): Record<string, number> {
  const lockedSet = new Set<string>();
  for (const id of lockedIds) {
    lockedSet.add(id);
  }
  for (const c of criteria) {
    if (c.isLocked) {
      lockedSet.add(c.id);
    }
  }

  const lockedCriteria = criteria.filter(c => lockedSet.has(c.id));
  const unlockedCriteria = criteria.filter(c => !lockedSet.has(c.id));

  // Step 1: Validate Locked Sum
  const rawLockedSum = lockedCriteria.reduce((sum, c) => sum + c.weight, 0);
  const roundedLockedSum = round1(rawLockedSum);

  if (roundedLockedSum > 100.0) {
    throw new ValidationError(`Sum of locked weights (${roundedLockedSum}%) exceeds 100.0%`);
  }

  if (unlockedCriteria.length === 0 && roundedLockedSum !== 100.0) {
    throw new ValidationError(
      `All criteria are locked but their sum (${roundedLockedSum}%) does not equal 100.0%`
    );
  }

  const result: Record<string, number> = {};

  // Step 2: Allocate Locked Weights
  let allocatedLockedTotal = 0;
  for (const c of lockedCriteria) {
    const w = round1(c.weight);
    result[c.id] = w;
    allocatedLockedTotal += w;
  }
  allocatedLockedTotal = round1(allocatedLockedTotal);

  // Step 3: Distribute Remaining Target
  const remainingTarget = round1(100.0 - allocatedLockedTotal);

  if (unlockedCriteria.length === 0) {
    return result;
  }

  const unlockedRawSum = unlockedCriteria.reduce((sum, c) => sum + c.weight, 0);

  const targets: { criterion: EngineCriterion; q: number; init: number; remainder: number }[] = [];

  for (const c of unlockedCriteria) {
    let q: number;
    if (unlockedRawSum === 0.0) {
      q = remainingTarget / unlockedCriteria.length;
    } else {
      q = (c.weight / unlockedRawSum) * remainingTarget;
    }

    // Step 4: Initial Tenths Allocation & Remainder Tracking
    // Use Math.floor(q * 10 + 1e-9) / 10 to avoid float inaccuracy like 33.299999999
    const init = Math.floor(q * 10 + 1e-9) / 10;
    const remainder = Math.max(0, q - init);
    targets.push({ criterion: c, q, init, remainder });
  }

  // Step 5: Largest Remainder Correction Pass (Hare-Niemeyer)
  const currentAllocatedSum = round1(
    allocatedLockedTotal + targets.reduce((sum, t) => sum + t.init, 0)
  );

  const K = Math.round((100.0 - currentAllocatedSum) / 0.1);

  const adjustments: Record<string, number> = {};
  for (const t of targets) {
    adjustments[t.criterion.id] = 0;
  }

  if (K > 0) {
    // Sort descending by remainder, ties broken by ID ascending ASCII
    const sorted = [...targets].sort((a, b) => {
      const diff = b.remainder - a.remainder;
      if (Math.abs(diff) > 1e-9) {
        return diff;
      }
      return a.criterion.id.localeCompare(b.criterion.id);
    });

    for (let i = 0; i < K && i < sorted.length; i++) {
      adjustments[sorted[i].criterion.id] += 0.1;
    }
  } else if (K < 0) {
    // Sort ascending by remainder, ties broken by ID ascending ASCII
    const sorted = [...targets].sort((a, b) => {
      const diff = a.remainder - b.remainder;
      if (Math.abs(diff) > 1e-9) {
        return diff;
      }
      return a.criterion.id.localeCompare(b.criterion.id);
    });

    const count = Math.abs(K);
    for (let i = 0; i < count && i < sorted.length; i++) {
      adjustments[sorted[i].criterion.id] -= 0.1;
    }
  }

  for (const t of targets) {
    result[t.criterion.id] = round1(t.init + adjustments[t.criterion.id]);
  }

  return result;
}
