import { z } from 'zod';

export const aiCapabilityEnum = z.enum([
  'all',
  'executive_summary',
  'tradeoff_analysis',
  'evidence_gaps',
  'expert_perspectives',
  'assumptions_questions',
  'suggest_criteria',
]);

export const aiAnalyzeRequestSchema = z.object({
  capability: aiCapabilityEnum.default('all'),
});

export const aiCriterionProposalSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  suggestedWeight: z.number().min(1).max(100),
  direction: z.enum(['benefit', 'cost']).default('benefit'),
  rationale: z.string().max(1000).default(''),
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
});

export const aiAnalystOutputSchema = z.object({
  executiveSummary: z.string().min(10).max(4000),
  tradeoffAnalysis: aiTradeoffAnalysisSchema.optional(),
  evidenceGaps: z.array(aiEvidenceGapSchema).default([]),
  expertSummary: aiExpertPerspectiveSummarySchema.optional(),
  assumptions: z.array(z.string().max(1000)).default([]),
  followUpQuestions: z.array(z.string().max(1000)).default([]),
  suggestedCriteria: z.array(aiCriterionProposalSchema).default([]),
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
  direction: z.enum(['benefit', 'cost']).default('benefit'),
  isLocked: z.boolean().default(false),
});

export const applyProposalSchema = z.object({
  type: z.literal('add_criterion'),
  criterion: applyProposalCriterionSchema,
});

