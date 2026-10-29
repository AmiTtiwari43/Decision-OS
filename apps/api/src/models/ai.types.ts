export type AiCapability =
  | 'all'
  | 'executive_summary'
  | 'tradeoff_analysis'
  | 'evidence_gaps'
  | 'expert_perspectives'
  | 'assumptions_questions'
  | 'suggest_criteria';

export interface AiCriterionProposal {
  id: string;
  name: string;
  description: string;
  suggestedWeight: number;
  direction: 'benefit' | 'cost';
  rationale: string;
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

export interface AiAnalystOutput {
  executiveSummary: string;
  tradeoffAnalysis?: {
    winnerObservation?: string;
    keyTradeoffs: string[];
    sensitivityNotes: string[];
  };
  evidenceGaps: AiEvidenceGap[];
  expertSummary?: AiExpertPerspectiveSummary;
  assumptions: string[];
  followUpQuestions: string[];
  suggestedCriteria: AiCriterionProposal[];
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

export interface ApplyProposalPayload {
  type: 'add_criterion';
  criterion: ApplyProposalCriterionInput;
}

