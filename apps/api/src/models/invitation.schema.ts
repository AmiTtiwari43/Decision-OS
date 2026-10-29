import { z } from 'zod';
import { decisionCollaboratorRoleSchema } from './decisionAccess.schema.js';

export const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('A valid email address is required')
    .max(255, 'Email cannot exceed 255 characters'),
  role: decisionCollaboratorRoleSchema,
});

export const acceptInvitationSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, 'Invitation token is required'),
});

export const invitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

