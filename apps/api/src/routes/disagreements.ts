import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { disagreementService } from '../services/disagreement.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  DisagreementNotFoundError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

const updateResolutionSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
  resolutionExplanation: z.string().max(5000).optional(),
});

export const disagreementRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Enforce authentication on all disagreement routes
  app.addHook('preHandler', app.authenticate);

  /**
   * GET /decisions/:id/disagreements
   * Retrieves structured disagreement intelligence and human resolution states.
   */
  app.get('/decisions/:id/disagreements', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const data = await disagreementService.getDecisionDisagreements(id, request.user);
      return reply.status(200).send(data);
    } catch (err) {
      if (err instanceof DecisionNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
          requestId: (request.id as string) || 'unknown',
        });
      }
      if (err instanceof InvalidDecisionIdError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
          requestId: (request.id as string) || 'unknown',
        });
      }
      throw err;
    }
  });

  /**
   * PATCH /decisions/:id/disagreements/:disagreementId/resolution
   * Updates human governance resolution status and rationale.
   */
  app.patch(
    '/decisions/:id/disagreements/:disagreementId/resolution',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, disagreementId } = request.params as { id: string; disagreementId: string };

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
          requestId: (request.id as string) || 'unknown',
        });
      }

      if (!disagreementId || typeof disagreementId !== 'string' || disagreementId.trim().length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'disagreementId must be a non-empty string',
          requestId: (request.id as string) || 'unknown',
        });
      }

      const parsed = updateResolutionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.errors.map(e => e.message).join('; '),
          requestId: (request.id as string) || 'unknown',
        });
      }

      try {
        const result = await disagreementService.updateResolution(
          id,
          disagreementId,
          parsed.data,
          request.user
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof DecisionNotFoundError) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: err.message,
            requestId: (request.id as string) || 'unknown',
          });
        }
        if (err instanceof ForbiddenError) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: err.message,
            requestId: (request.id as string) || 'unknown',
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /decisions/:id/disagreements/:disagreementId/ai-explain
   * Generates advisory neutral AI explanation and clarification questions.
   */
  app.post(
    '/decisions/:id/disagreements/:disagreementId/ai-explain',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, disagreementId } = request.params as { id: string; disagreementId: string };

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
          requestId: (request.id as string) || 'unknown',
        });
      }

      try {
        const result = await disagreementService.explainDisagreementWithAi(
          id,
          disagreementId,
          request.user
        );
        return reply.status(200).send(result);
      } catch (err: unknown) {
        if (err instanceof DecisionNotFoundError || err instanceof DisagreementNotFoundError) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: err.message,
            requestId: (request.id as string) || 'unknown',
          });
        }
        throw err;
      }
    }
  );
};
