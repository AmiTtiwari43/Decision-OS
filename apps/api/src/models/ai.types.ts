export type AiCapability =
  | 'all'
  | 'executive_summary'
  | 'tradeoff_analysis'
  | 'evidence_gaps'
  | 'expert_perspectives'
  | 'assumptions_questions'
  | 'suggest_criteria'
  | 'suggest_alternatives'
  | 'expert_recommendations'
  | 'ranked_suggestions';

export interface AiCriterionProposal {
  id: string;
  name: string;
  description: string;
  suggestedWeight: number;
  direction: 'benefit' | 'cost';
  rationale: string;
}

export interface AiAlternativeProposal {
  id: string;
  name: string;
  description: string;
  rationale: string;
  tradeoffs?: string;
  potentialAdvantages?: string[];
  potentialDisadvantages?: string[];
}

export interface AiExpertRecommendation {
  domain: string;
  role: 'contributor' | 'editor';
  rationale: string;
  targetCriteria: string[];
  expectedContribution: string;
}

export interface AiRiskItem {
  risk: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
  affectedOptionIds?: string[];
}

export interface AiEvidenceGap {
  targetType: 'decision' | 'option' | 'criterion' | 'contribution';
  targetId: string;
  targetName: string;
  gapDescription: string;
  recommendation: string;
}

export interface AiExpertPerspectiveSummary {
  totalContributionsAnalyzed: number;
  consensusAreas: string[];
  divergenceAreas: string[];
  keyInsights: string[];
}

export interface AiSuggestionScoreBreakdown {
  criteriaRelevance: number;
  evidenceGrounding: number;
  sensitivityUrgency: number;
  confidenceScore: number;
  penalties: number;
  formula: string;
}

export type AiSuggestionCategory =
  | 'criterion'
  | 'alternative'
  | 'evidence'
  | 'expert'
  | 'risk_mitigation';

export interface AiRankedSuggestion {
  id: string;
  rank: number;
  category: AiSuggestionCategory;
  title: string;
  explanation: string;
  relevantCriteria: Array<{ id: string; name: string }>;
  supportingEvidence: Array<{ id: string; title: string }>;
  confidence: number;
  uncertaintyLevel: 'low' | 'medium' | 'high';
  rankingScore: number;
  rankingMethodology: string;
  scoreBreakdown: AiSuggestionScoreBreakdown;
  missingInformation: string[];
  potentialBiasOrLimitations: string[];
  whyThisRank: string;
  criteriaInfluence: string;
  evidenceSupport: string;
  assumptionsMade: string[];
  whatCouldChangeRecommendation: string;
  actionablePayload?: ApplyProposalPayload;
}

export interface AiAnalystOutput {
  executiveSummary: string;
  tradeoffAnalysis?: {
    winnerObservation?: string;
    keyTradeoffs: string[];
    sensitivityNotes: string[];
    risks?: AiRiskItem[];
  };
  evidenceGaps: AiEvidenceGap[];
  expertSummary?: AiExpertPerspectiveSummary;
  assumptions: string[];
  followUpQuestions: string[];
  suggestedCriteria: AiCriterionProposal[];
  suggestedAlternatives?: AiAlternativeProposal[];
  expertRecommendations?: AiExpertRecommendation[];
  rankedSuggestions?: AiRankedSuggestion[];
}

export interface AiAnalystResponseDto {
  decisionId: string;
  analysisType: AiCapability;
  generatedAt: string;
  provider: string;
  model: string;
  isAiGenerated: true;
  disclaimer: string;
  output: AiAnalystOutput;
}

export interface ApplyProposalCriterionInput {
  id: string;
  name: string;
  weight: number;
  direction?: 'benefit' | 'cost';
  isLocked?: boolean;
}

export interface ApplyProposalOptionInput {
  id: string;
  name: string;
  description?: string;
  tagline?: string;
}

export type ApplyProposalPayload =
  | {
      type: 'add_criterion';
      criterion: ApplyProposalCriterionInput;
    }
  | {
      type: 'add_option';
      option: ApplyProposalOptionInput;
    };
