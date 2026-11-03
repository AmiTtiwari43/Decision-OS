import { z } from 'zod';

export const commentTargetTypeSchema = z.enum([
  'decision',
  'option',
  'criterion',
  'cell',
  'contribution',
]);

export const cellCoordinatesSchema = z.object({
  optionId: z.string().trim().min(1, 'optionId is required'),
  criterionId: z.string().trim().min(1, 'criterionId is required'),
});

export const createCommentSchema = z
  .object({
    content: z
      .string({ required_error: 'Comment content is required' })
      .trim()
      .min(1, 'Comment content cannot be empty')
      .max(2000, 'Comment content cannot exceed 2000 characters'),
    parentCommentId: z.string().trim().nullable().optional(),
    targetType: commentTargetTypeSchema.optional(),
    targetId: z.string().trim().optional(),
    cellCoordinates: cellCoordinatesSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // If not a reply, targetType and targetId are required
    if (!data.parentCommentId) {
      if (!data.targetType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetType is required for root comments',
          path: ['targetType'],
        });
      }
      if (!data.targetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetId is required for root comments',
          path: ['targetId'],
        });
      }
      if (data.targetType === 'cell' && !data.cellCoordinates) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cellCoordinates is required when targetType is cell',
          path: ['cellCoordinates'],
        });
      }
    }
  });

export const updateCommentSchema = z.object({
  content: z
    .string({ required_error: 'Comment content is required' })
    .trim()
    .min(1, 'Comment content cannot be empty')
    .max(2000, 'Comment content cannot exceed 2000 characters'),
});

export const resolveCommentSchema = z.object({
  isResolved: z.boolean({ required_error: 'isResolved must be a boolean' }),
});

export type ValidatedCreateCommentInput = z.infer<typeof createCommentSchema>;
export type ValidatedUpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ValidatedResolveCommentInput = z.infer<typeof resolveCommentSchema>;
