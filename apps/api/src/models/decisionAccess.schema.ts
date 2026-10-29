import { z } from 'zod';

export const decisionCollaboratorRoleSchema = z.enum(['editor', 'viewer', 'contributor'], {
  errorMap: () => ({ message: "Role must be either 'editor' or 'viewer' or 'contributor'" }),
});

export const createDecisionAccessGrantSchema = z.object({
  decisionId: z.string().min(1, 'decisionId is required'),
  userId: z.string().min(1, 'userId is required'),
  role: decisionCollaboratorRoleSchema,
  grantedBy: z.string().min(1, 'grantedBy is required'),
});

export const updateDecisionAccessGrantSchema = z.object({
  role: decisionCollaboratorRoleSchema,
});

