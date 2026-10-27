import type {
  EngineCriterion,
  EngineOption,
  MonteCarloConfig,
  MonteCarloResult,
  MonteCarloOptionResult,
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

  const winCounts = new Map<string, number>();
  for (const opt of options) {
    winCounts.set(opt.id, 0);
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Generate perturbed weights
    const perturbedCriteria: EngineCriterion[] = criteria.map(c => {
      const baseW = baseNormalizedWeights[c.id] ?? 0;
      if (lockedSet.has(c.id)) {
        return { ...c, weight: baseW, isLocked: true };
      }

      // Box-Muller Gaussian Noise
      const u1 = Math.max(1e-15, rng());
      const u2 = rng();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      const perturbedW = Math.max(0.0, baseW + z0 * (sigmaRelative * baseW));
      return { ...c, weight: perturbedW, isLocked: false };
    });

    // Renormalize perturbed weights
    const perturbedNormalized = normalizeWeights(perturbedCriteria, lockedIds);

    // Score options under perturbed weights
    let maxScore = -Infinity;
    const scores: { optionId: string; score: number }[] = [];

    for (const opt of options) {
      let score = 0;
      for (const c of criteria) {
        const w = perturbedNormalized[c.id] ?? 0;
        score += (w / 100.0) * opt.scores[c.id];
      }
      scores.push({ optionId: opt.id, score });
      if (score > maxScore) {
        maxScore = score;
      }
    }

    // Identify winners with fractional win share for ties within 1e-9
    const winners = scores.filter(s => Math.abs(s.score - maxScore) < 1e-9);
    const winShare = 1.0 / winners.length;

    for (const w of winners) {
      winCounts.set(w.optionId, (winCounts.get(w.optionId) ?? 0) + winShare);
    }
  }

  const optionResults: MonteCarloOptionResult[] = options.map(opt => {
    const count = winCounts.get(opt.id) ?? 0;
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
