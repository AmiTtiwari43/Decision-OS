import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { calibrationService } from '../services/calibration.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  PredictionNotFoundError,
  RetrospectivePredictionError,
  InvalidOutcomeDateError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

const createPredictionSchema = z.object({
  statement: z.string().min(1, 'Statement cannot be empty').max(2000),
  probability: z.number().min(0).max(1),
  targetDate: z.string().min(1, 'targetDate is required'),
  domain: z.string().max(100).optional(),
  evidenceReferences: z.array(z.string()).optional(),
});

const recordOutcomeSchema = z.object({
  observedOutcome: z.number().int().min(0).max(1),
  outcomeDate: z.string().min(1, 'outcomeDate is required'),
  verificationSource: z.string().min(1, 'verificationSource is required').max(2000),
  verificationStatus: z.enum(['verified', 'unverified']).optional(),
});

const disputeOutcomeSchema = z.object({
  disputeReason: z.string().min(1, 'disputeReason is required').max(2000),
});

export const calibrationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Enforce authentication on all calibration routes
  app.addHook('preHandler', app.authenticate);

  /**
   * GET /decisions/:id/predictions
   * Lists predictions for a decision.
   */
  app.get('/decisions/:id/predictions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { contributorId?: string; status?: string; domain?: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const items = await calibrationService.listPredictions(id, query, request.user);
      return reply.status(200).send({ items });
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
   * POST /decisions/:id/predictions
   * Submits a new prospective empirical prediction.
   */
  app.post('/decisions/:id/predictions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    const parsed = createPredictionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parsed.error.errors.map(e => e.message).join('; '),
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const created = await calibrationService.createPrediction(id, parsed.data, request.user);
      return reply.status(201).send(created);
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
      if (err instanceof RetrospectivePredictionError) {
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
   * POST /decisions/:id/predictions/:predictionId/outcome
   * Records observed outcome and verification metadata.
   */
  app.post(
    '/decisions/:id/predictions/:predictionId/outcome',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, predictionId } = request.params as { id: string; predictionId: string };

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
          requestId: (request.id as string) || 'unknown',
        });
      }

      if (!predictionId || typeof predictionId !== 'string' || predictionId.trim().length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'predictionId must be a non-empty string',
          requestId: (request.id as string) || 'unknown',
        });
      }

      const parsed = recordOutcomeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.errors.map(e => e.message).join('; '),
          requestId: (request.id as string) || 'unknown',
        });
      }

      try {
        const updated = await calibrationService.recordOutcome(id, predictionId, parsed.data, request.user);
        return reply.status(200).send(updated);
      } catch (err) {
        if (err instanceof DecisionNotFoundError || err instanceof PredictionNotFoundError) {
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
        if (err instanceof InvalidOutcomeDateError) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: err.message,
            requestId: (request.id as string) || 'unknown',
          });
        }
        throw err;
      }
    }
  );

  /**
   * PATCH /decisions/:id/predictions/:predictionId/dispute
   * Disputes an outcome, removing it from calibration calculations.
   */
  app.patch(
    '/decisions/:id/predictions/:predictionId/dispute',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, predictionId } = request.params as { id: string; predictionId: string };

      if (!isValidObjectId(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
          requestId: (request.id as string) || 'unknown',
        });
      }

      if (!predictionId || typeof predictionId !== 'string' || predictionId.trim().length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'predictionId must be a non-empty string',
          requestId: (request.id as string) || 'unknown',
        });
      }

      const parsed = disputeOutcomeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.errors.map(e => e.message).join('; '),
          requestId: (request.id as string) || 'unknown',
        });
      }

      try {
        const updated = await calibrationService.disputeOutcome(id, predictionId, parsed.data, request.user);
        return reply.status(200).send(updated);
      } catch (err) {
        if (err instanceof DecisionNotFoundError || err instanceof PredictionNotFoundError) {
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
   * GET /decisions/:id/calibration
   * Calculates decision and expert calibration metrics with separated dimensions.
   */
  app.get('/decisions/:id/calibration', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const data = await calibrationService.getDecisionCalibration(id, request.user);
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
   * GET /users/:userId/calibration
   * Retrieves global calibration metrics for an expert.
   */
  app.get('/users/:userId/calibration', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };

    if (!isValidObjectId(userId)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid user ID: "${userId}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const profile = await calibrationService.getUserCalibration(userId, request.user);
      return reply.status(200).send(profile);
    } catch (err) {
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
};

