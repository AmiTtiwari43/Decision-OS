import { z } from 'zod';

export const criterionSchema = z.object({
  id: z.string({ required_error: 'Criterion id is required' }).trim().min(1, 'Criterion id is required'),
  name: z.string({ required_error: 'Criterion name is required' }).trim().min(1, 'Criterion name is required'),
  shortName: z.string().trim().optional(),
  weight: z.number({ required_error: 'Criterion weight is required' }).finite('Criterion weight must be a finite number').min(0, 'Criterion weight cannot be negative'),
  direction: z.enum(['benefit', 'cost']).default('benefit'),
  isLocked: z.boolean().optional().default(false),
});

export const optionSchema = z.object({
  id: z.string({ required_error: 'Option id is required' }).trim().min(1, 'Option id is required'),
  name: z.string({ required_error: 'Option name is required' }).trim().min(1, 'Option name is required'),
  tagline: z.string().trim().optional(),
  description: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

export const scoreValueSchema = z
  .number({ required_error: 'Score is required' })
  .finite('Score must be a finite number')
  .min(0, 'Score cannot be negative')
  .max(100, 'Score cannot exceed 100');

export const scoresSchema = z.record(
  z.string(),
  z.record(z.string(), scoreValueSchema)
);

export const scoreProvenanceItemSchema = z
  .object({
    isSynthetic: z.literal(true, {
      errorMap: () => ({ message: 'isSynthetic must be true; synthetic provenance cannot be negated via metadata' }),
    }),
    source: z.string().trim().max(100).optional(),
    insertedAt: z.string().trim().optional(),
  })
  .strict();

export const scoreProvenanceSchema = z.record(
  z.string(),
  z.record(z.string(), scoreProvenanceItemSchema)
);

export const createDecisionSchema = z
  .object({
    title: z
      .string({ required_error: 'Decision title is required' })
      .trim()
      .min(1, 'Decision title is required')
      .max(200, 'Decision title cannot exceed 200 characters'),
    description: z.string().trim().default(''),
    criteria: z.array(criterionSchema).default([]),
    options: z.array(optionSchema).default([]),
    scores: scoresSchema.default({}),
    scoreProvenance: scoreProvenanceSchema.default({}),
    analysis: z.any().nullable().default(null),
    calculationVersion: z.number().int().min(1).default(1),
    ownerId: z.any().optional(),
    isContributionRoundLocked: z.boolean().optional().default(false),
    contributionRoundLockedAt: z.coerce.date().nullable().optional().default(null),
  })
  .superRefine((data, ctx) => {
    // Validate duplicate criterion IDs
    const criterionIds = new Set<string>();
    for (let i = 0; i < data.criteria.length; i++) {
      const c = data.criteria[i];
      if (criterionIds.has(c.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate criterion ID '${c.id}' detected`,
          path: ['criteria', i, 'id'],
        });
      }
      criterionIds.add(c.id);
    }

    // Validate duplicate option IDs
    const optionIds = new Set<string>();
    for (let i = 0; i < data.options.length; i++) {
      const opt = data.options[i];
      if (optionIds.has(opt.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate option ID '${opt.id}' detected`,
          path: ['options', i, 'id'],
        });
      }
      optionIds.add(opt.id);
    }

    // Validate score provenance coordinates
    if (data.scoreProvenance) {
      const critIds = new Set(data.criteria.map((c) => c.id));
      const optIds = new Set(data.options.map((o) => o.id));

      for (const [optId, critMap] of Object.entries(data.scoreProvenance)) {
        if (!optIds.has(optId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Synthetic score provenance contains unknown alternative ID '${optId}'`,
            path: ['scoreProvenance', optId],
          });
        }
        for (const [critId, entry] of Object.entries(critMap || {})) {
          if (!critIds.has(critId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Synthetic score provenance contains unknown criterion ID '${critId}'`,
              path: ['scoreProvenance', optId, critId],
            });
          }
          if (entry.isSynthetic && data.scores) {
            const val = data.scores[optId]?.[critId];
            if (val === undefined || val === null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Synthetic score provenance registered for coordinate (${optId}, ${critId}) without a corresponding score value`,
                path: ['scoreProvenance', optId, critId],
              });
            }
          }
        }
      }
    }
  });

export const updateDecisionSchema = z
  .object({
    title: z.string().trim().min(1, 'Decision title cannot be empty').max(200, 'Decision title cannot exceed 200 characters').optional(),
    description: z.string().trim().optional(),
    criteria: z.array(criterionSchema).optional(),
    options: z.array(optionSchema).optional(),
    scores: scoresSchema.optional(),
    scoreProvenance: scoreProvenanceSchema.optional(),
    analysis: z.any().nullable().optional(),
    calculationVersion: z.number().int().min(1).optional(),
    version: z.number().int().min(1).optional(),
    expectedVersion: z.number().int().min(1).optional(),
    ownerId: z.any().optional(),
    isContributionRoundLocked: z.boolean().optional(),
    contributionRoundLockedAt: z.coerce.date().nullable().optional(),
    isAudited: z.boolean().optional(),
    auditIntegrityStatus: z.enum(['healthy', 'pending_reconciliation', 'quarantined']).optional(),
    pendingOperationId: z.string().nullable().optional(),
    quarantineReason: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.criteria) {
      const criterionIds = new Set<string>();
      for (let i = 0; i < data.criteria.length; i++) {
        const c = data.criteria[i];
        if (criterionIds.has(c.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate criterion ID '${c.id}' detected`,
            path: ['criteria', i, 'id'],
          });
        }
        criterionIds.add(c.id);
      }
    }

    if (data.options) {
      const optionIds = new Set<string>();
      for (let i = 0; i < data.options.length; i++) {
        const opt = data.options[i];
        if (optionIds.has(opt.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate option ID '${opt.id}' detected`,
            path: ['options', i, 'id'],
          });
        }
        optionIds.add(opt.id);
      }
    }

    if (data.scoreProvenance) {
      if (data.options) {
        const optIds = new Set(data.options.map((o) => o.id));
        for (const optId of Object.keys(data.scoreProvenance)) {
          if (!optIds.has(optId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Synthetic score provenance contains unknown alternative ID '${optId}'`,
              path: ['scoreProvenance', optId],
            });
          }
        }
      }
      if (data.criteria) {
        const critIds = new Set(data.criteria.map((c) => c.id));
        for (const [optId, critMap] of Object.entries(data.scoreProvenance)) {
          for (const critId of Object.keys(critMap || {})) {
            if (!critIds.has(critId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Synthetic score provenance contains unknown criterion ID '${critId}'`,
                path: ['scoreProvenance', optId, critId],
              });
            }
          }
        }
      }
    }
  });

export const replaceSyntheticScoreSchema = z
  .object({
    optionId: z.string({ required_error: 'Option ID is required' }).trim().min(1, 'Option ID is required'),
    criterionId: z.string({ required_error: 'Criterion ID is required' }).trim().min(1, 'Criterion ID is required'),
    score: z
      .number({ required_error: 'Replacement score is required' })
      .finite('Score must be a finite number')
      .min(0, 'Score cannot be less than 0')
      .max(100, 'Score cannot exceed 100'),
    expectedVersion: z.number().int().min(1).optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();

export const clearSyntheticScoresSchema = z
  .object({
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();

export const populateSyntheticDemoSchema = z
  .object({
    defaultValue: z.number().finite().min(0).max(100).default(75),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();

export type ValidatedCreateDecisionInput = z.infer<typeof createDecisionSchema>;
export type ValidatedUpdateDecisionInput = z.infer<typeof updateDecisionSchema>;
export type ValidatedReplaceSyntheticScoreInput = z.infer<typeof replaceSyntheticScoreSchema>;
export type ValidatedClearSyntheticScoresInput = z.infer<typeof clearSyntheticScoresSchema>;
export type ValidatedPopulateSyntheticDemoInput = z.infer<typeof populateSyntheticDemoSchema>;
