import { describe, it, expect } from 'vitest';
import { runMonteCarloSimulation, normalizeWeights } from '../src';
import type {
  EngineCriterion,
  EngineOption,
  MonteCarloConfig,
  MonteCarloResult,
  MonteCarloOptionResult,
} from '../src';

/**
 * Legacy Monte Carlo result type corresponding strictly to HEAD prior to Batch 01A changes.
 */
type LegacyMonteCarloResult = Omit<MonteCarloResult, 'criterionStats'>;

/**
 * Independent snapshot of Mulberry32 PRNG from HEAD prior to Batch 01A-R1 changes.
 * Used strictly to execute side-by-side regression testing without depending on current engine export.
 * Note: Proven identical to HEAD via `git show HEAD:packages/decision-engine/src/monteCarlo.ts`.
 */
function createMulberry32Legacy(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Exact snapshot of runMonteCarloSimulation from HEAD prior to Batch 01A-R1 changes.
 * Note on helpers:
 * - `createMulberry32Legacy`: independent inlined HEAD function above.
 * - `normalizeWeights`: verified 100% identical to HEAD (`git diff HEAD packages/decision-engine/src/normalization.ts` is empty).
 */
function legacyRunMonteCarloSimulation(
  options: ReadonlyArray<EngineOption>,
  criteria: ReadonlyArray<EngineCriterion>,
  baseNormalizedWeights: Record<string, number>,
  lockedIds: ReadonlyArray<string> = [],
  config: MonteCarloConfig = {}
): LegacyMonteCarloResult {
  function round1(val: number): number {
    return Math.round(val * 10) / 10;
  }

  const iterations = config.iterations ?? 1000;
  const seed = config.seed ?? 42;
  const sigmaRelative = config.sigmaRelative ?? 0.15;

  const rng = createMulberry32Legacy(seed);

  const lockedSet = new Set<string>(lockedIds);
  for (const c of criteria) {
    if (c.isLocked) {
      lockedSet.add(c.id);
    }
  }

  const numOptions = options.length;
  const numCriteria = criteria.length;

  const optScoresMatrix: number[][] = Array.from({ length: numOptions });
  for (let o = 0; o < numOptions; o++) {
    const scores: number[] = Array.from({ length: numCriteria });
    const optScores = options[o].scores;
    for (let c = 0; c < numCriteria; c++) {
      scores[c] = optScores[criteria[c].id] ?? 0;
    }
    optScoresMatrix[o] = scores;
  }

  const perturbedCriteria = Array.from({ length: numCriteria });
  const isLockedCriteria = new Uint8Array(numCriteria);
  const baseWeights = new Float64Array(numCriteria);
  for (let c = 0; c < numCriteria; c++) {
    const crit = criteria[c];
    const isLocked = lockedSet.has(crit.id);
    isLockedCriteria[c] = isLocked ? 1 : 0;
    baseWeights[c] = baseNormalizedWeights[crit.id] ?? 0;
    perturbedCriteria[c] = {
      id: crit.id,
      name: crit.name,
      shortName: crit.shortName,
      weight: baseWeights[c],
      isLocked,
    };
  }

  const optionScores = new Float64Array(numOptions);
  const optWinCounts = new Float64Array(numOptions);

  for (let iter = 0; iter < iterations; iter++) {
    for (let c = 0; c < numCriteria; c++) {
      if (isLockedCriteria[c] === 1) {
        (perturbedCriteria[c] as { weight: number; isLocked: boolean }).weight = baseWeights[c];
        (perturbedCriteria[c] as { weight: number; isLocked: boolean }).isLocked = true;
        continue;
      }

      const u1 = Math.max(1e-15, rng());
      const u2 = rng();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      const baseW = baseWeights[c];
      const perturbedW = Math.max(0.0, baseW + z0 * (sigmaRelative * baseW));
      (perturbedCriteria[c] as { weight: number; isLocked: boolean }).weight = perturbedW;
      (perturbedCriteria[c] as { weight: number; isLocked: boolean }).isLocked = false;
    }

    const perturbedNormalized = normalizeWeights(
      perturbedCriteria as unknown as ReadonlyArray<EngineCriterion>,
      lockedIds
    );

    let maxScore = -Infinity;
    for (let o = 0; o < numOptions; o++) {
      let score = 0;
      const optScores = optScoresMatrix[o];
      for (let c = 0; c < numCriteria; c++) {
        const w = perturbedNormalized[criteria[c].id] ?? 0;
        score += (w / 100.0) * optScores[c];
      }
      optionScores[o] = score;
      if (score > maxScore) {
        maxScore = score;
      }
    }

    let winnerCount = 0;
    for (let o = 0; o < numOptions; o++) {
      if (Math.abs(optionScores[o] - maxScore) < 1e-9) {
        winnerCount++;
      }
    }
    const winShare = 1.0 / winnerCount;

    for (let o = 0; o < numOptions; o++) {
      if (Math.abs(optionScores[o] - maxScore) < 1e-9) {
        optWinCounts[o] += winShare;
      }
    }
  }

  const optionResults: MonteCarloOptionResult[] = options.map((opt, o) => {
    const count = optWinCounts[o];
    const prob = round1((count / iterations) * 100);
    return {
      optionId: opt.id,
      optionName: opt.name,
      winCount: Math.round(count * 10) / 10,
      winProbability: prob,
    };
  });

  optionResults.sort((a, b) => b.winCount - a.winCount);

  const topProb = optionResults[0]?.winProbability ?? 0;
  const isTopTie =
    optionResults.length > 1 &&
    Math.abs(optionResults[0].winProbability - optionResults[1].winProbability) < 1e-9;

  const dominantOptionId = isTopTie ? null : optionResults[0]?.optionId ?? null;

  let robustnessRating: 'robust' | 'moderate' | 'sensitive';
  if (topProb >= 75.0) {
    robustnessRating = 'robust';
  } else if (topProb >= 55.0) {
    robustnessRating = 'moderate';
  } else {
    robustnessRating = 'sensitive';
  }

  return {
    engineVersion: '1.0.0',
    iterations,
    seed,
    sigmaRelative,
    optionResults,
    dominantOptionId,
    dominantWinProbability: topProb,
    robustnessRating,
  };
}

/**
 * Asserts full field-by-field equality between current and legacy simulation results across all common fields.
 */
function assertFieldByFieldEquality(
  actual: MonteCarloResult,
  expected: LegacyMonteCarloResult
): void {
  expect(actual.engineVersion).toBe(expected.engineVersion);
  expect(actual.iterations).toBe(expected.iterations);
  expect(actual.seed).toBe(expected.seed);
  expect(actual.sigmaRelative).toBe(expected.sigmaRelative);
  expect(actual.dominantOptionId).toBe(expected.dominantOptionId);
  expect(actual.dominantWinProbability).toBe(expected.dominantWinProbability);
  expect(actual.robustnessRating).toBe(expected.robustnessRating);
  expect(actual.optionResults).toEqual(expected.optionResults);
}

describe('Monte Carlo Implementation Output Compatibility Verification', () => {
  const criteria: EngineCriterion[] = [
    { id: 'c1', name: 'Compensation', weight: 40, isLocked: false },
    { id: 'c2', name: 'Career Growth', weight: 35, isLocked: false },
    { id: 'c3', name: 'Work Life', weight: 25, isLocked: false },
  ];
  const baseWeights = { c1: 40, c2: 35, c3: 25 };

  const allOptions: EngineOption[] = [
    { id: 'optA', name: 'Company Alpha', scores: { c1: 90, c2: 70, c3: 60 } },
    { id: 'optB', name: 'Company Beta', scores: { c1: 65, c2: 85, c3: 90 } },
    { id: 'optC', name: 'Company Gamma', scores: { c1: 70, c2: 75, c3: 70 } },
  ];

  it('produces field-by-field identical outputs across complete legacy schema for two alternatives (seed 42, 500 iter)', () => {
    const twoOptions = [allOptions[0], allOptions[1]];
    const config = { iterations: 500, seed: 42, sigmaRelative: 0.15 };
    const legacyResult = legacyRunMonteCarloSimulation(twoOptions, criteria, baseWeights, [], config);
    const newResult = runMonteCarloSimulation(twoOptions, criteria, baseWeights, [], config);

    assertFieldByFieldEquality(newResult, legacyResult);
    expect(newResult.criterionStats).toBeDefined();
    expect(newResult.criterionStats).toHaveLength(criteria.length);
  });

  it('produces field-by-field identical outputs across complete legacy schema for three alternatives (seed 42, 1000 iter)', () => {
    const config = { iterations: 1000, seed: 42, sigmaRelative: 0.15 };
    const legacyResult = legacyRunMonteCarloSimulation(allOptions, criteria, baseWeights, [], config);
    const newResult = runMonteCarloSimulation(allOptions, criteria, baseWeights, [], config);

    assertFieldByFieldEquality(newResult, legacyResult);
    expect(newResult.criterionStats).toBeDefined();
    expect(newResult.criterionStats).toHaveLength(criteria.length);
  });

  it('produces field-by-field identical outputs across complete legacy schema with locked criteria (seed 99, 500 iter, locked c1)', () => {
    const config = { iterations: 500, seed: 99, sigmaRelative: 0.20 };
    const lockedIds = ['c1'];
    const legacyResult = legacyRunMonteCarloSimulation(allOptions, criteria, baseWeights, lockedIds, config);
    const newResult = runMonteCarloSimulation(allOptions, criteria, baseWeights, lockedIds, config);

    assertFieldByFieldEquality(newResult, legacyResult);
    expect(newResult.criterionStats).toBeDefined();
    expect(newResult.criterionStats).toHaveLength(criteria.length);
  });

  it('produces field-by-field identical outputs across complete legacy schema on tied scenarios (seed 1234, 300 iter)', () => {
    const tiedOptions: EngineOption[] = [
      { id: 't1', name: 'Tied 1', scores: { c1: 80, c2: 80, c3: 80 } },
      { id: 't2', name: 'Tied 2', scores: { c1: 80, c2: 80, c3: 80 } },
    ];
    const config = { iterations: 300, seed: 1234, sigmaRelative: 0.15 };
    const legacyResult = legacyRunMonteCarloSimulation(tiedOptions, criteria, baseWeights, [], config);
    const newResult = runMonteCarloSimulation(tiedOptions, criteria, baseWeights, [], config);

    assertFieldByFieldEquality(newResult, legacyResult);
    expect(newResult.dominantOptionId).toBeNull();
    expect(legacyResult.dominantOptionId).toBeNull();
    expect(newResult.criterionStats).toBeDefined();
    expect(newResult.criterionStats).toHaveLength(criteria.length);
  });
});
