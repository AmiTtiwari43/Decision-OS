import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import mongoose from 'mongoose';
import { collaborationService } from '../services/collaboration.service.js';
import { decisionRepository } from '../repositories/decision.repository.js';
import { authorizeDecisionAction } from '../services/authorization.service.js';
import {
  DecisionNotFoundError,
  ForbiddenError,
} from '../errors/domain.errors.js';
import type { RequesterContext } from '../services/decision.service.js';
import type { TokenPayload } from '../plugins/auth.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

const presenceHeartbeatSchema = z.object({
  status: z.enum(['active', 'idle']).default('active'),
  currentView: z.string().optional(),
});

const streamQuerySchema = z.object({
  token: z.string().optional(),
  lastEventId: z.string().optional(),
});

export const collaborationRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Helper to authenticate requests that support either Authorization header or ?token=<jwt>
   */
  async function resolveUserFromRequest(request: FastifyRequest): Promise<RequesterContext> {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await request.jwtVerify();
      const user = request.user;
      return { id: user.id || user.sub, email: user.email, role: user.role };
    }

    const query = request.query as { token?: string };
    if (query?.token) {
      const decoded = app.jwt.verify<TokenPayload>(query.token);
      request.user = decoded;
      return { id: decoded.id || decoded.sub, email: decoded.email, role: decoded.role };
    }

    throw new Error('Authentication required');
  }

  /**
   * GET /api/decisions/:id/collaboration/stream
   * Real-time Server-Sent Events stream for live decision updates, presence, and calculations.
   */
  app.get('/decisions/:id/collaboration/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    let user: RequesterContext;
    try {
      user = await resolveUserFromRequest(request);
    } catch {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Valid JWT authentication required to connect to real-time collaboration stream',
      });
    }

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
      });
    }

    const decision = await decisionRepository.findById(id);
    if (!decision) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Decision with ID "${id}" not found`,
      });
    }

    try {
      await authorizeDecisionAction(decision, 'read', user);
    } catch (err) {
      if (err instanceof DecisionNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }
      if (err instanceof ForbiddenError) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: err.message,
        });
      }
      throw err;
    }

    const parsedQuery = streamQuerySchema.safeParse(request.query);
    const lastEventId =
      (request.headers['last-event-id'] as string) ||
      (parsedQuery.success ? parsedQuery.data.lastEventId : undefined);

    // Hijack Fastify response to manage long-lived SSE stream natively
    reply.hijack();
    collaborationService.registerClient(id, user, reply.raw, lastEventId);
  });

  /**
   * POST /api/decisions/:id/collaboration/presence
   * Collaborator presence heartbeat / status update.
   */
  app.post(
    '/decisions/:id/collaboration/presence',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        });
      }

      const decision = await decisionRepository.findById(id);
      if (!decision) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Decision with ID "${id}" not found`,
        });
      }

      try {
        await authorizeDecisionAction(decision, 'read', request.user);
      } catch (err) {
        if (err instanceof DecisionNotFoundError) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: err.message,
          });
        }
        if (err instanceof ForbiddenError) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: err.message,
          });
        }
        throw err;
      }

      const parseResult = presenceHeartbeatSchema.safeParse(request.body || {});
      const status = parseResult.success ? parseResult.data.status : 'active';
      const currentView = parseResult.success ? parseResult.data.currentView : undefined;

      const activeParticipants = collaborationService.updatePresence(id, request.user, status, currentView);

      return reply.status(200).send({
        status: 'ok',
        decisionId: id,
        items: activeParticipants,
        participants: activeParticipants,
        activeParticipants,
      });
    }
  );

  /**
   * GET /api/decisions/:id/collaboration/presence
   * Retrieves active participants currently collaborating on this decision.
   */
  app.get(
    '/decisions/:id/collaboration/presence',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        });
      }

      const decision = await decisionRepository.findById(id);
      if (!decision) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Decision with ID "${id}" not found`,
        });
      }

      try {
        await authorizeDecisionAction(decision, 'read', request.user);
      } catch (err) {
        if (err instanceof DecisionNotFoundError) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: err.message,
          });
        }
        if (err instanceof ForbiddenError) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: err.message,
          });
        }
        throw err;
      }

      const items = collaborationService.getPresence(id);
      return reply.status(200).send({
        decisionId: id,
        items,
        participants: items,
      });
    }
  );
};
