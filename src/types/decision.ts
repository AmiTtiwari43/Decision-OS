export interface Criterion {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category: 'growth' | 'finance' | 'lifestyle' | 'risk' | 'execution';
  defaultWeight: number; // 0 - 100 percentage
  iconName?: string;
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

export interface DecisionDataset {
  id: string;
  title: string;
  question: string;
  context: string;
  criteria: Criterion[];
  options: Option[];
  scenarios: Scenario[];
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
  rank: number;
  scoreDifferenceToLeader: number;
  contributions: ContributionItem[];
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
  winningOption: Option;
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
  winner: OptionEvaluation;
  runnerUp: OptionEvaluation | null;
  normalizedWeights: Record<string, number>;
  totalWeight: number;
  sensitivity: SensitivityAnalysis[];
  explainability: ExplainabilitySummary;
}
