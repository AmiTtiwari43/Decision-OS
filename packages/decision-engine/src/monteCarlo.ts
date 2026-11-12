import type {
  EngineCriterion,
  EngineOption,
  MonteCarloConfig,
  MonteCarloResult,
  MonteCarloOptionResult,
  MonteCarloCriterionStats,
} from './types';
import { normalizeWeights } from './normalization';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MutableCriterion {
  id: string;
  name: string;
  shortName?: string;
  weight: number;
  isLocked?: boolean;
}

export function runMonteCarloSimulation(
  options: ReadonlyArray<EngineOption>,
  criteria: ReadonlyArray<EngineCriterion>,
  baseNormalizedWeights: Record<string, number>,
  lockedIds: ReadonlyArray<string> = [],
  config: MonteCarloConfig = {}
): MonteCarloResult {
  const iterations = config.iterations ?? 1000;
  const seed = config.seed ?? 42;
  const sigmaRelative = config.sigmaRelative ?? 0.15;

  const rng = createMulberry32(seed);

  const lockedSet = new Set<string>(lockedIds);
  for (const c of criteria) {
    if (c.isLocked) {
      lockedSet.add(c.id);
    }
  }

  const numOptions = options.length;
  const numCriteria = criteria.length;

  // Pre-allocate typed matrices and structures outside simulation loop to eliminate GC pressure
  const optScoresMatrix: number[][] = Array.from({ length: numOptions });
  for (let o = 0; o < numOptions; o++) {
    const scores: number[] = Array.from({ length: numCriteria });
    const optScores = options[o].scores;
    for (let c = 0; c < numCriteria; c++) {
      scores[c] = optScores[criteria[c].id] ?? 0;
    }
    optScoresMatrix[o] = scores;
  }

  // Pre-allocate perturbed criteria instances once to avoid repetitive object allocation
  const perturbedCriteria: MutableCriterion[] = Array.from({ length: numCriteria });
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

  const weightSums = new Float64Array(numCriteria);
  const weightSqSums = new Float64Array(numCriteria);
  const minWeights = new Float64Array(numCriteria).fill(Infinity);
  const maxWeights = new Float64Array(numCriteria).fill(-Infinity);

  for (let iter = 0; iter < iterations; iter++) {
    // Generate perturbed weights
    for (let c = 0; c < numCriteria; c++) {
      if (isLockedCriteria[c] === 1) {
        perturbedCriteria[c].weight = baseWeights[c];
        perturbedCriteria[c].isLocked = true;
        continue;
      }

      // Box-Muller Gaussian Noise (exact same deterministic Mulberry32 sequence)
      const u1 = Math.max(1e-15, rng());
      const u2 = rng();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      const baseW = baseWeights[c];
      const perturbedW = Math.max(0.0, baseW + z0 * (sigmaRelative * baseW));
      perturbedCriteria[c].weight = perturbedW;
      perturbedCriteria[c].isLocked = false;
    }

    // Renormalize perturbed weights
    const perturbedNormalized = normalizeWeights(perturbedCriteria as unknown as ReadonlyArray<EngineCriterion>, lockedIds);

    // Optional inspection hook for per-iteration invariant verification (minimal test seam)
    if (config.onIterationWeights) {
      // Create an independent snapshot and freeze it so consumer code cannot mutate internal simulation state
      const snapshot: Readonly<Record<string, number>> = Object.freeze({ ...perturbedNormalized });
      config.onIterationWeights(snapshot, iter);
    }

    // Track simulated weight distribution metrics for invariant verification
    for (let c = 0; c < numCriteria; c++) {
      const w = perturbedNormalized[criteria[c].id] ?? 0;
      weightSums[c] += w;
      weightSqSums[c] += w * w;
      if (w < minWeights[c]) minWeights[c] = w;
      if (w > maxWeights[c]) maxWeights[c] = w;
    }

    // Score options under perturbed weights
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

    // Identify winners with fractional win share for ties within 1e-9
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

  // Sort option results descending by win count
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

  const criterionStats: MonteCarloCriterionStats[] = criteria.map((crit, c) => {
    const meanExact = weightSums[c] / iterations;
    const varianceExact = Math.max(0, (weightSqSums[c] / iterations) - (meanExact * meanExact));
    const isLocked = isLockedCriteria[c] === 1;

    return {
      criterionId: crit.id,
      meanWeight: round1(meanExact),
      variance: Math.round(varianceExact * 10000) / 10000,
      stdDev: Math.round(Math.sqrt(varianceExact) * 100) / 100,
      minWeight: round1(minWeights[c]),
      maxWeight: round1(maxWeights[c]),
      isLocked,
    };
  });

  return {
    engineVersion: '1.0.0',
    iterations,
    seed,
    sigmaRelative,
    optionResults,
    dominantOptionId,
    dominantWinProbability: topProb,
    robustnessRating,
    criterionStats,
  };
}
