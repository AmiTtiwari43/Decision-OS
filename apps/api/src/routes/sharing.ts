import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import {
  createInvitationSchema,
  acceptInvitationSchema,
  updateDecisionAccessGrantSchema,
  type DecisionCollaboratorRole,
} from '../models/index.js';
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  listAccessGrants,
  updateAccessGrant,
  revokeAccessGrant,
  acceptInvitation,
  getInvitationDetails,
  listPendingInvitationsForUser,
} from '../services/sharing.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationRevokedError,
  InvitationAlreadyAcceptedError,
  InvitationRecipientMismatchError,
  ActiveInvitationExistsError,
  UserAlreadyHasAccessError,
  CannotInviteOwnerError,
  AccessGrantNotFoundError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

function handleSharingServiceError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = (request.id as string) || 'unknown';

  if (err instanceof InvalidDecisionIdError) {
    reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof CannotInviteOwnerError) {
    reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof ForbiddenError || err instanceof InvitationRecipientMismatchError) {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof DecisionNotFoundError || err instanceof InvitationNotFoundError || err instanceof AccessGrantNotFoundError) {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof ActiveInvitationExistsError || err instanceof UserAlreadyHasAccessError || err instanceof InvitationAlreadyAcceptedError) {
    reply.status(409).send({
      statusCode: 409,
      error: 'Conflict',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof InvitationExpiredError || err instanceof InvitationRevokedError) {
    reply.status(410).send({
      statusCode: 410,
      error: 'Gone',
      message: err.message,
      requestId,
    });
    return;
  }

  throw err;
}

export const sharingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ─── Decision-Scoped Sharing Endpoints ─────────────────────────────────────

  // POST /api/decisions/:id/invitations — Create invitation
  app.post(
    '/decisions/:id/invitations',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `'${id}' is not a valid decision ID`,
          requestId,
        });
      }

      const body = request.body as Record<string, unknown>;
      const parsed = createInvitationSchema.safeParse(body);
      if (!parsed.success) {
        const messages = parsed.error.errors.map(e => e.message).join('; ');
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: messages,
          requestId,
        });
      }

      try {
        const result = await createInvitation(
          id,
          parsed.data.email,
          parsed.data.role as DecisionCollaboratorRole,
          request.user
        );
        return reply.status(201).send(result);
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // GET /api/decisions/:id/invitations — List invitations for a decision
  app.get(
    '/decisions/:id/invitations',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `'${id}' is not a valid decision ID`,
          requestId,
        });
      }

      try {
        const items = await listInvitations(id, request.user);
        return reply.status(200).send({ items });
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // DELETE /api/decisions/:id/invitations/:invitationId — Revoke invitation
  app.delete(
    '/decisions/:id/invitations/:invitationId',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, invitationId } = request.params as {
        id: string;
        invitationId: string;
      };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `'${id}' is not a valid decision ID`,
          requestId,
        });
      }

      try {
        const revoked = await revokeInvitation(id, invitationId, request.user);
        return reply.status(200).send({
          message: 'Invitation revoked successfully',
          invitation: revoked,
        });
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // GET /api/decisions/:id/access — List users with access to decision
  app.get(
    '/decisions/:id/access',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `'${id}' is not a valid decision ID`,
          requestId,
        });
      }

      try {
        const result = await listAccessGrants(id, request.user);
        return reply.status(200).send(result);
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // PUT /api/decisions/:id/access/:grantId — Update collaborator role
  app.put(
    '/decisions/:id/access/:grantId',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, grantId } = request.params as {
        id: string;
        grantId: string;
      };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `'${id}' is not a valid decision ID`,
          requestId,
        });
      }

      const body = request.body as Record<string, unknown>;
      const parsed = updateDecisionAccessGrantSchema.safeParse(body);
      if (!parsed.success) {
        const messages = parsed.error.errors.map(e => e.message).join('; ');
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: messages,
          requestId,
        });
      }

      try {
        const updated = await updateAccessGrant(
          id,
          grantId,
          parsed.data.role as DecisionCollaboratorRole,
          request.user
        );
        return reply.status(200).send(updated);
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // DELETE /api/decisions/:id/access/:grantId — Revoke collaborator access
  app.delete(
    '/decisions/:id/access/:grantId',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, grantId } = request.params as {
        id: string;
        grantId: string;
      };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `'${id}' is not a valid decision ID`,
          requestId,
        });
      }

      try {
        await revokeAccessGrant(id, grantId, request.user);
        return reply.status(204).send();
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // ─── Global Invitation Endpoints ──────────────────────────────────────────

  // POST /api/invitations/accept — Authenticated recipient accepts invitation via token
  app.post(
    '/invitations/accept',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = (request.id as string) || 'unknown';
      const body = request.body as Record<string, unknown>;
      const parsed = acceptInvitationSchema.safeParse(body);

      if (!parsed.success) {
        const messages = parsed.error.errors.map(e => e.message).join('; ');
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: messages,
          requestId,
        });
      }

      try {
        const result = await acceptInvitation(parsed.data.token, request.user);
        return reply.status(200).send(result);
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // GET /api/invitations/details — Retrieve invitation details by token (optional auth)
  app.get(
    '/invitations/details',
    { preHandler: [app.optionalAuthenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = (request.id as string) || 'unknown';
      const query = request.query as { token?: string };

      if (!query.token || !query.token.trim()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: "Query parameter 'token' is required",
          requestId,
        });
      }

      try {
        const details = await getInvitationDetails(query.token.trim());
        return reply.status(200).send(details);
      } catch (err) {
        return handleSharingServiceError(err, request, reply);
      }
    }
  );

  // GET /api/invitations/pending — List pending invitations for the signed-in user
  app.get(
    '/invitations/pending',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const items = await listPendingInvitationsForUser(request.user.email);
      return reply.status(200).send({ items });
    }
  );
};

