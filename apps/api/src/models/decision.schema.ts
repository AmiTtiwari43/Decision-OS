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
    analysis: z.any().nullable().default(null),
    calculationVersion: z.number().int().min(1).default(1),
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
  });

export const updateDecisionSchema = z
  .object({
    title: z.string().trim().min(1, 'Decision title cannot be empty').max(200, 'Decision title cannot exceed 200 characters').optional(),
    description: z.string().trim().optional(),
    criteria: z.array(criterionSchema).optional(),
    options: z.array(optionSchema).optional(),
    scores: scoresSchema.optional(),
    analysis: z.any().nullable().optional(),
    calculationVersion: z.number().int().min(1).optional(),
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
  });

export type ValidatedCreateDecisionInput = z.infer<typeof createDecisionSchema>;
export type ValidatedUpdateDecisionInput = z.infer<typeof updateDecisionSchema>;
