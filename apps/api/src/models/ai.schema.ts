import { z } from 'zod';

export const aiCapabilityEnum = z.enum([
  'all',
  'executive_summary',
  'tradeoff_analysis',
  'evidence_gaps',
  'expert_perspectives',
  'assumptions_questions',
  'suggest_criteria',
  'suggest_alternatives',
  'expert_recommendations',
  'ranked_suggestions',
]);

export const aiAnalyzeRequestSchema = z.object({
  capability: aiCapabilityEnum.default('all'),
});

export const aiCriterionProposalSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  suggestedWeight: z.number().min(0).max(100),
  direction: z.enum(['benefit', 'cost']).default('benefit'),
  rationale: z.string().max(1000).default(''),
});

export const aiAlternativeProposalSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  rationale: z.string().max(1000).default(''),
  tradeoffs: z.string().max(1000).optional(),
  potentialAdvantages: z.array(z.string().max(500)).default([]),
  potentialDisadvantages: z.array(z.string().max(500)).default([]),
});

export const aiExpertRecommendationSchema = z.object({
  domain: z.string().min(1).max(100),
  role: z.enum(['contributor', 'editor']).default('contributor'),
  rationale: z.string().max(1000).default(''),
  targetCriteria: z.array(z.string().max(50)).default([]),
  expectedContribution: z.string().max(1000).default(''),
});

export const aiRiskItemSchema = z.object({
  risk: z.string().min(1).max(500),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  mitigation: z.string().max(1000).default(''),
  affectedOptionIds: z.array(z.string().max(50)).default([]),
});

export const aiEvidenceGapSchema = z.object({
  targetType: z.enum(['decision', 'option', 'criterion', 'contribution']),
  targetId: z.string().min(1),
  targetName: z.string().min(1),
  gapDescription: z.string().max(1000),
  recommendation: z.string().max(1000),
});

export const aiExpertPerspectiveSummarySchema = z.object({
  totalContributionsAnalyzed: z.number().int().nonnegative().default(0),
  consensusAreas: z.array(z.string().max(1000)).default([]),
  divergenceAreas: z.array(z.string().max(1000)).default([]),
  keyInsights: z.array(z.string().max(1000)).default([]),
});

export const aiTradeoffAnalysisSchema = z.object({
  winnerObservation: z.string().max(1000).optional(),
  keyTradeoffs: z.array(z.string().max(1000)).default([]),
  sensitivityNotes: z.array(z.string().max(1000)).default([]),
  risks: z.array(aiRiskItemSchema).default([]),
});

export const aiSuggestionScoreBreakdownSchema = z.object({
  criteriaRelevance: z.number(),
  evidenceGrounding: z.number(),
  sensitivityUrgency: z.number(),
  confidenceScore: z.number(),
  penalties: z.number(),
  formula: z.string(),
});

export const applyProposalCriterionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Criterion id is required')
    .max(50, 'Criterion id cannot exceed 50 characters')
    .regex(/^[a-z0-9_-]+$/i, 'Criterion id must contain only alphanumeric characters, dashes, or underscores'),
  name: z.string().trim().min(1, 'Criterion name is required').max(100, 'Criterion name cannot exceed 100 characters'),
  weight: z.number().min(0, 'Weight cannot be negative').max(100, 'Weight cannot exceed 100'),
  direction: z.enum(['benefit', 'cost']).optional(),
  isLocked: z.boolean().optional(),
});

export const applyProposalOptionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Option id is required')
    .max(50, 'Option id cannot exceed 50 characters')
    .regex(/^[a-z0-9_-]+$/i, 'Option id must contain only alphanumeric characters, dashes, or underscores'),
  name: z.string().trim().min(1, 'Option name is required').max(100, 'Option name cannot exceed 100 characters'),
  description: z.string().max(1000).optional(),
  tagline: z.string().max(200).optional(),
});

export const applyProposalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_criterion'),
    criterion: applyProposalCriterionSchema,
  }),
  z.object({
    type: z.literal('add_option'),
    option: applyProposalOptionSchema,
  }),
]);

export const aiRankedSuggestionSchema = z.object({
  id: z.string(),
  rank: z.number().int().positive(),
  category: z.enum(['criterion', 'alternative', 'evidence', 'expert', 'risk_mitigation']),
  title: z.string().min(1),
  explanation: z.string(),
  relevantCriteria: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  supportingEvidence: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
  confidence: z.number().min(0).max(1).default(0.8),
  uncertaintyLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  rankingScore: z.number().min(0).max(100),
  rankingMethodology: z.string(),
  scoreBreakdown: aiSuggestionScoreBreakdownSchema,
  missingInformation: z.array(z.string()).default([]),
  potentialBiasOrLimitations: z.array(z.string()).default([]),
  whyThisRank: z.string(),
  criteriaInfluence: z.string(),
  evidenceSupport: z.string(),
  assumptionsMade: z.array(z.string()).default([]),
  whatCouldChangeRecommendation: z.string(),
  actionablePayload: applyProposalSchema.optional(),
});

export const aiAnalystOutputSchema = z.object({
  executiveSummary: z.string().min(10).max(4000),
  tradeoffAnalysis: aiTradeoffAnalysisSchema.optional(),
  evidenceGaps: z.array(aiEvidenceGapSchema).default([]),
  expertSummary: aiExpertPerspectiveSummarySchema.optional(),
  assumptions: z.array(z.string().max(1000)).default([]),
  followUpQuestions: z.array(z.string().max(1000)).default([]),
  suggestedCriteria: z.array(aiCriterionProposalSchema).default([]),
  suggestedAlternatives: z.array(aiAlternativeProposalSchema).default([]),
  expertRecommendations: z.array(aiExpertRecommendationSchema).default([]),
  rankedSuggestions: z.array(aiRankedSuggestionSchema).default([]),
});
