import { validateInput } from './validation';
import { normalizeWeights } from './normalization';
import { evaluateOptions } from './scoring';
import { calculateSensitivity } from './sensitivity';
import { runMonteCarloSimulation } from './monteCarlo';
import type {
  EngineEvaluationInput,
  EngineResult,
  MonteCarloResult,
} from './types';

export * from './types';
export * from './errors';
export { normalizeWeights } from './normalization';
export { validateInput } from './validation';
export { evaluateOptions } from './scoring';
export { calculateSensitivity } from './sensitivity';
export { runMonteCarloSimulation, createMulberry32 } from './monteCarlo';
export {
  calculateOptionScoreSensitivity,
  calculateMultiParameterCounterfactual,
} from './counterfactual';

export function evaluateDecision(input: EngineEvaluationInput): EngineResult {
  const criteria = input.criteria;
  const options = input.options;
  const lockedIds = input.lockedIds ?? [];

  // Step 1: Strict Validation
  validateInput(criteria, options);

  // Step 2: Canonical Largest Remainder Normalization
  const normalizedWeights = normalizeWeights(criteria, lockedIds);
  const totalWeight = Object.values(normalizedWeights).reduce((a, b) => a + b, 0);

  // Step 3: Exact Dual-Precision Scoring, Ranks, Ties, Presentation Order
  const scoringResult = evaluateOptions(options, criteria, normalizedWeights, lockedIds);

  // Find leader and runnerUp options
  const leaderEval = scoringResult.evaluations[0];
  const runnerUpEval = scoringResult.evaluations.length > 1 ? scoringResult.evaluations[1] : null;

  const leaderOption = options.find(o => o.id === leaderEval.optionId)!;
  const runnerUpOption = runnerUpEval ? options.find(o => o.id === runnerUpEval.optionId) ?? null : null;

  // Step 4: Analytical Sensitivity Tipping Calculations
  const sensitivity = calculateSensitivity(
    leaderOption,
    runnerUpOption,
    criteria,
    normalizedWeights,
    lockedIds
  );

  // Step 5: Optional Seeded Gaussian Monte Carlo
  let monteCarlo: MonteCarloResult | undefined;
  if (input.monteCarloConfig) {
    monteCarlo = runMonteCarloSimulation(
      options,
      criteria,
      normalizedWeights,
      lockedIds,
      input.monteCarloConfig
    );
  }

  return {
    engineVersion: '1.0.0',
    evaluatedAt: new Date().toISOString(),
    isTie: scoringResult.isTie,
    decisionOutcome: scoringResult.decisionOutcome,
    winnerId: scoringResult.winnerId,
    tiedWinnerIds: scoringResult.tiedWinnerIds,
    pointLead: scoringResult.pointLead,
    evaluations: scoringResult.evaluations,
    normalizedWeights,
    totalWeight: Math.round(totalWeight * 10) / 10,
    sensitivity,
    monteCarlo,
  };
}
