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

export interface OptionScoreSensitivityResult {
  readonly criterionId: string;
  readonly criterionName: string;
  readonly weight: number;
  readonly scoreDeltaNeeded: number | null;
  readonly leaderThresholdScore: number | null;
  readonly challengerThresholdScore: number | null;
  readonly feasibility: 'feasible' | 'unreachable';
  readonly summary: string;
}

export interface CounterfactualWeightShift {
  readonly criterionId: string;
  readonly criterionName: string;
  readonly currentWeight: number;
  readonly counterfactualWeight: number;
  readonly delta: number;
}

export interface MultiParameterCounterfactualResult {
  readonly isFeasible: boolean;
  readonly totalWeightShiftL1: number;
  readonly netShiftAmount: number;
  readonly shifts: ReadonlyArray<CounterfactualWeightShift>;
  readonly targetOptionId: string | null;
  readonly targetOptionName: string | null;
  readonly summary: string;
}

export interface EngineResult {
  readonly engineVersion: '1.0.0';
  readonly engineSpecHash?: string;
  readonly evaluatedAt: string;
  readonly inputHash?: string;
  readonly calculationHash?: string;
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

export type DisagreementCategory = 'score' | 'priority' | 'evidence' | 'assumption' | 'interpretation';

export interface ContributorSubmissionInput {
  readonly contributorId: string;
  readonly contributorName?: string;
  readonly preferredOptionId?: string;
  readonly scores: Record<string, number>; // criterionId -> score (0..100)
  readonly reasoning?: Record<string, string>; // criterionId -> reasoning
  readonly confidence?: number; // 0..1
  readonly predictionStatement?: string;
  readonly evidenceReferences?: ReadonlyArray<string>;
}

export interface CriterionDisagreementMetrics {
  readonly criterionId: string;
  readonly criterionName: string;
  readonly weight: number;
  readonly sampleCount: number;
  readonly minScore: number | null;
  readonly maxScore: number | null;
  readonly scoreRange: number | null;
  readonly meanScore: number | null;
  readonly sampleStdDev: number | null;
  readonly medianScore: number | null;
  readonly confidenceWeightedMean: number | null;
  readonly isDecisionCritical: boolean;
  readonly tippingDeltaThreshold: number | null;
  readonly criticalReason?: string;
  readonly scenarioResults: {
    readonly minScenarioWinnerId: string | null;
    readonly minScenarioWinnerFlips: boolean;
    readonly medianScenarioWinnerId: string | null;
    readonly medianScenarioWinnerFlips: boolean;
    readonly maxScenarioWinnerId: string | null;
    readonly maxScenarioWinnerFlips: boolean;
  };
}

export interface DisagreementIntelligenceItem {
  readonly id: string;
  readonly category: DisagreementCategory;
  readonly title: string;
  readonly criterionId?: string;
  readonly criterionName?: string;
  readonly optionId?: string;
  readonly optionName?: string;
  readonly isDecisionCritical: boolean;
  readonly scoreMetrics?: CriterionDisagreementMetrics;
  readonly description: string;
  readonly numericalExplanation: string;
  readonly participants: ReadonlyArray<{
    contributorId: string;
    contributorName?: string;
    value: string | number;
    confidence?: number;
    reasoning?: string;
  }>;
  readonly suggestedClarificationQuestions: ReadonlyArray<string>;
}

export interface DisagreementIntelligenceResult {
  readonly hasSufficientData: boolean;
  readonly totalContributors: number;
  readonly totalDisagreements: number;
  readonly decisionCriticalCount: number;
  readonly criteriaMetrics: ReadonlyArray<CriterionDisagreementMetrics>;
  readonly items: ReadonlyArray<DisagreementIntelligenceItem>;
  readonly priorityBreakdown: ReadonlyArray<{
    optionId: string;
    optionName: string;
    recommendationCount: number;
    percentage: number;
  }>;
  readonly summary: string;
}


// ---------------------------------------------------------------------------
// Phase 12: Expert Calibration Types
// ---------------------------------------------------------------------------

export interface CalibrationPredictionInput {
  readonly id: string;
  readonly probability: number; // 0.0 .. 1.0
  readonly observedOutcome: number; // 0 or 1
  readonly domain?: string;
  readonly submittedAt?: string | Date;
  readonly outcomeDate?: string | Date;
}

export interface CalibrationBin {
  readonly binIndex: number; // 0..4
  readonly range: string;
  readonly count: number;
  readonly meanPredictedProbability: number;
  readonly observedFrequency: number;
  readonly calibrationError: number;
}

export interface DomainCalibrationMetrics {
  readonly domain: string;
  readonly count: number;
  readonly brierScore: number;
  readonly expectedCalibrationError: number;
}

export interface ExpertCalibrationResult {
  readonly methodologyVersion: '1.0.0';
  readonly totalPredictions: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly hasSufficientSample: boolean;
  readonly minimumSampleThreshold: number;
  readonly brierScore: number | null;
  readonly climatologyBss: number | null;
  readonly expectedCalibrationError: number | null;
  readonly calibrationBins: ReadonlyArray<CalibrationBin>;
  readonly domainBreakdown: ReadonlyArray<DomainCalibrationMetrics>;
  readonly summary: string;
}
