import { z } from 'zod';

export const contributionStatusSchema = z.enum([
  'draft',
  'submitted',
  'withdrawn',
  'adopted',
  'rejected',
]);

export const contributionPredictionSchema = z.object({
  statement: z.string().trim().max(500, 'Prediction statement cannot exceed 500 characters').optional(),
  targetDate: z.coerce.date().optional(),
  probability: z.number().finite().min(0, 'Probability must be at least 0').max(1, 'Probability cannot exceed 1').optional(),
});

export const saveContributionSchema = z.object({
  preferredOptionId: z
    .string({ required_error: 'Preferred option is required' })
    .trim()
    .min(1, 'Preferred option is required'),
  rationale: z.string().trim().max(3000, 'Rationale cannot exceed 3000 characters').default(''),
  criterionScores: z
    .record(
      z.string().trim().min(1),
      z
        .number({ required_error: 'Score must be a number' })
        .finite('Score must be a finite number')
        .min(0, 'Score cannot be negative')
        .max(100, 'Score cannot exceed 100')
    )
    .default({}),
  criterionReasoning: z
    .record(
      z.string().trim().min(1),
      z.string().trim().max(1000, 'Criterion reasoning cannot exceed 1000 characters')
    )
    .default({}),
  confidence: z
    .number()
    .finite('Confidence must be a finite number')
    .min(0, 'Confidence must be between 0 and 1')
    .max(1, 'Confidence must be between 0 and 1')
    .default(1),
  prediction: contributionPredictionSchema.optional(),
  evidenceReferences: z.array(z.string().trim().min(1)).default([]),
});

export const adoptContributionSchema = z.object({
  expectedVersion: z
    .number({ required_error: 'expectedVersion is required' })
    .int('expectedVersion must be an integer')
    .positive('expectedVersion must be a positive integer'),
  confirmation: z.literal(true, {
    errorMap: () => ({ message: 'Explicit confirmation (confirmation: true) is required to adopt scores' }),
  }),
  selectedCriterionIds: z.array(z.string().trim().min(1)).optional(),
});

export const rejectContributionSchema = z.object({
  rejectionReason: z
    .string({ required_error: 'rejectionReason is required' })
    .trim()
    .min(1, 'rejectionReason cannot be empty')
    .max(1000, 'rejectionReason cannot exceed 1000 characters'),
});

export type ValidatedSaveContributionInput = z.infer<typeof saveContributionSchema>;
export type ValidatedAdoptContributionInput = z.infer<typeof adoptContributionSchema>;
export type ValidatedRejectContributionInput = z.infer<typeof rejectContributionSchema>;
