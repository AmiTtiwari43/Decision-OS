export interface EngineCriterion {
  readonly id: string;
  readonly name: string;
  readonly shortName?: string;
  readonly weight: number;
  readonly isLocked?: boolean;
}

export interface EngineOption {
  readonly id: string;
  readonly name: string;
  readonly scores: Readonly<Record<string, number>>;
}

export interface CriterionContribution {
  readonly criterionId: string;
  readonly rawScore: number;
  readonly weight: number;
  readonly weightedPoints: number;
  readonly percentageOfTotal: number;
}

export interface OptionEvaluationResult {
  readonly optionId: string;
  readonly optionName: string;
  readonly unroundedScore: number;
  readonly weightedScore: number;
  readonly rank: number;
  readonly presentationOrder: number;
  readonly scoreDifferenceToLeader: number;
  readonly contributions: ReadonlyArray<CriterionContribution>;
}

export interface TippingPointResult {
  readonly criterionId: string;
  readonly currentWeight: number;
  readonly tippingPointWeight: number | null;
  readonly weightDeltaNeeded: number | null;
  readonly direction: 'increase' | 'decrease' | 'none';
  readonly feasibility: 'low-threshold' | 'medium-threshold' | 'unreachable';
  readonly wouldFlipToOptionId: string | null;
  readonly summary: string;
}

export interface MonteCarloOptionResult {
  readonly optionId: string;
  readonly optionName: string;
  readonly winCount: number;
  readonly winProbability: number;
}

export interface MonteCarloConfig {
  readonly iterations?: number;
  readonly seed?: number;
  readonly sigmaRelative?: number;
}

export interface MonteCarloResult {
  readonly engineVersion: '1.0.0';
  readonly iterations: number;
  readonly seed: number;
  readonly sigmaRelative: number;
  readonly optionResults: ReadonlyArray<MonteCarloOptionResult>;
  readonly dominantOptionId: string | null;
  readonly dominantWinProbability: number;
  readonly robustnessRating: 'robust' | 'moderate' | 'sensitive';
}

export interface EngineEvaluationInput {
  readonly criteria: ReadonlyArray<EngineCriterion>;
  readonly options: ReadonlyArray<EngineOption>;
  readonly lockedIds?: ReadonlyArray<string>;
  readonly monteCarloConfig?: MonteCarloConfig;
}

export interface EngineResult {
  readonly engineVersion: '1.0.0';
  readonly evaluatedAt: string;
  readonly isTie: boolean;
  readonly decisionOutcome: 'decisive' | 'tie';
  readonly winnerId: string | null;
  readonly tiedWinnerIds: ReadonlyArray<string>;
  readonly pointLead: number;
  readonly evaluations: ReadonlyArray<OptionEvaluationResult>;
  readonly normalizedWeights: Readonly<Record<string, number>>;
  readonly totalWeight: number;
  readonly sensitivity: ReadonlyArray<TippingPointResult>;
  readonly monteCarlo?: MonteCarloResult;
}
