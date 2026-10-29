import { z } from 'zod';

export const evidenceTargetTypeSchema = z.enum([
  'decision',
  'option',
  'criterion',
  'contribution',
]);

export const evidenceTypeSchema = z.enum(['url', 'document', 'excerpt']);

// Helper to strictly validate http(s) URLs without unsafe schemes
export const safeHttpUrlSchema = z
  .string()
  .trim()
  .max(2048, 'URL cannot exceed 2048 characters')
  .refine(
    (val) => {
      if (!val) return true;
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: "Source URL must use 'http://' or 'https://' scheme" }
  );

export const createEvidenceSchema = z
  .object({
    targetType: evidenceTargetTypeSchema,
    targetId: z
      .string()
      .trim()
      .min(1, 'Target ID is required')
      .max(128, 'Target ID cannot exceed 128 characters'),
    type: evidenceTypeSchema,
    title: z
      .string()
      .trim()
      .min(1, 'Evidence title is required')
      .max(255, 'Title cannot exceed 255 characters'),
    sourceUrl: safeHttpUrlSchema.nullable().optional(),
    documentReference: z
      .string()
      .trim()
      .max(500, 'Document reference cannot exceed 500 characters')
      .nullable()
      .optional(),
    sourceExcerpt: z
      .string()
      .trim()
      .max(5000, 'Source excerpt cannot exceed 5000 characters')
      .nullable()
      .optional(),
    userSummary: z
      .string()
      .trim()
      .max(5000, 'User interpretation summary cannot exceed 5000 characters')
      .nullable()
      .optional(),
    publicationDate: z.coerce.date().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // If evidence type is 'url', sourceUrl is strongly required
    if (data.type === 'url' && (!data.sourceUrl || data.sourceUrl.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: "A valid 'http://' or 'https://' sourceUrl is required when evidence type is 'url'",
      });
    }
  });

export const updateEvidenceSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Evidence title cannot be empty')
      .max(255, 'Title cannot exceed 255 characters')
      .optional(),
    sourceUrl: safeHttpUrlSchema.nullable().optional(),
    documentReference: z
      .string()
      .trim()
      .max(500, 'Document reference cannot exceed 500 characters')
      .nullable()
      .optional(),
    sourceExcerpt: z
      .string()
      .trim()
      .max(5000, 'Source excerpt cannot exceed 5000 characters')
      .nullable()
      .optional(),
    userSummary: z
      .string()
      .trim()
      .max(5000, 'User interpretation summary cannot exceed 5000 characters')
      .nullable()
      .optional(),
    publicationDate: z.coerce.date().nullable().optional(),
  });

