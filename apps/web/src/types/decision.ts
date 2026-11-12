export interface Criterion {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category: 'growth' | 'finance' | 'lifestyle' | 'risk' | 'execution';
  defaultWeight: number; // 0 - 100 percentage
  iconName?: string;
  isLocked?: boolean;
}

export interface Option {
  id: string;
  name: string;
  badge?: string;
  tagline: string;
  description: string;
  color: string; // Tailwind color or hex
  accentBorder: string;
  scores: Record<string, number>; // criterionId -> 0 to 100 score
  strengths: string[];
  vulnerabilities: string[];
}

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  description: string;
  badge?: string;
  weights: Record<string, number>; // criterionId -> percentage (sum = 100)
}

export interface ScoreCoordinateProvenance {
  isSynthetic: boolean;
  source?: string;
  insertedAt?: string;
}

export type ScoreProvenanceMap = Record<string, Record<string, ScoreCoordinateProvenance>>;

export interface DecisionDataset {
  id: string;
  title: string;
  question: string;
  context: string;
  criteria: Criterion[];
  options: Option[];
  scenarios: Scenario[];
  scoreProvenance?: ScoreProvenanceMap;
}

export interface ContributionItem {
  criterionId: string;
  criterionName: string;
  shortName: string;
  rawScore: number;
  weight: number;
  weightedPoints: number; // rawScore * (weight / 100)
  percentageOfTotal: number;
}

export interface OptionEvaluation {
  option: Option;
  weightedScore: number;
  rawScoreAvg: number;
  rank: number | null;
  scoreDifferenceToLeader: number;
  contributions: ContributionItem[];
}

export interface EvaluatedOptionEvaluation extends OptionEvaluation {
  rank: number;
}

export interface DeltaDriver {
  criterionId: string;
  criterionName: string;
  shortName: string;
  weight: number;
  winnerScore: number;
  runnerUpScore: number;
  pointAdvantage: number; // weighted difference in points (can be negative if runner-up won this criterion)
  rawDiff: number;
}

export interface SensitivityAnalysis {
  criterionId: string;
  criterionName: string;
  shortName: string;
  currentWeight: number;
  tippingPointWeight: number | null; // e.g. 36.4%
  weightDeltaNeeded: number | null; // e.g. +11.4%
  wouldFlipToOptionId: string | null;
  wouldFlipToOptionName: string | null;
  feasibility: 'low-threshold' | 'medium-threshold' | 'unreachable';
  summary: string;
}

export interface ExplainabilitySummary {
  winningOption: Option | null;
  runnerUpOption: Option | null;
  pointLead: number;
  headline: string;
  primaryDrivers: DeltaDriver[];
  concededAreas: DeltaDriver[];
  dynamicRationale: string;
  sensitivityStatement: string;
}

export interface EngineResult {
  evaluations: OptionEvaluation[];
  winner: OptionEvaluation | null;
  runnerUp: OptionEvaluation | null;
  normalizedWeights: Record<string, number>;
  totalWeight: number;
  sensitivity: SensitivityAnalysis[];
  explainability: ExplainabilitySummary;
  isAuthoritative?: boolean;
  engineVersion?: string;
  evaluatedAt?: string;
  isTie?: boolean;
  tiedWinnerIds?: readonly string[];
  decisionOutcome?: 'decisive' | 'tie' | 'incomplete' | 'invalid';
  isIncomplete?: boolean;
  isInvalid?: boolean;
  invalidReason?: 'weights' | 'scores' | null;
  errorMessage?: string | null;
  calculationHash?: string;
  inputHash?: string;
}

export interface EvaluatedEngineResult extends EngineResult {
  evaluations: EvaluatedOptionEvaluation[];
  winner: EvaluatedOptionEvaluation;
}
