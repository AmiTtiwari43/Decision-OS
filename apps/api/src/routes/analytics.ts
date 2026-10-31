import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { analyticsService } from '../services/analytics.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

const decisionAnalyticsQuerySchema = z.object({
  includeMonteCarlo: z
    .enum(['true', 'false'])
    .optional()
    .transform(val => val !== 'false'),
  iterations: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : undefined))
    .refine(val => val === undefined || (!Number.isNaN(val) && val >= 100 && val <= 10000), {
      message: 'iterations must be an integer between 100 and 10000',
    }),
  seed: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : undefined))
    .refine(val => val === undefined || (!Number.isNaN(val) && Number.isInteger(val)), {
      message: 'seed must be an integer',
    }),
  sigmaRelative: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : undefined))
    .refine(val => val === undefined || (!Number.isNaN(val) && val >= 0.01 && val <= 0.5), {
      message: 'sigmaRelative must be a number between 0.01 and 0.50',
    }),
});

const workspaceAnalyticsQuerySchema = z
  .object({
    startDate: z
      .string()
      .optional()
      .refine(val => !val || !Number.isNaN(Date.parse(val)), {
        message: 'startDate must be a valid ISO 8601 date string',
      }),
    endDate: z
      .string()
      .optional()
      .refine(val => !val || !Number.isNaN(Date.parse(val)), {
        message: 'endDate must be a valid ISO 8601 date string',
      }),
  })
  .refine(
    data => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate).getTime() <= new Date(data.endDate).getTime();
      }
      return true;
    },
    { message: 'startDate cannot be after endDate' }
  );

export const analyticsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Enforce authentication on all analytics routes
  app.addHook('preHandler', app.authenticate);

  /**
   * GET /api/analytics/overview
   * Portfolio-level analytics across decisions accessible to the authenticated user.
   */
  app.get('/analytics/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedQuery = workspaceAnalyticsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      const messages = parsedQuery.error.errors.map(e => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId: (request.id as string) || 'unknown',
      });
    }

    const data = await analyticsService.getWorkspaceAnalytics(parsedQuery.data, request.user);
    return reply.status(200).send(data);
  });

  /**
   * GET /api/decisions/:id/analytics
   * Detailed analytical breakdown for a single decision.
   */
  app.get('/decisions/:id/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    const parsedQuery = decisionAnalyticsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      const messages = parsedQuery.error.errors.map(e => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const analytics = await analyticsService.getDecisionAnalytics(id, parsedQuery.data, request.user);
      return reply.status(200).send(analytics);
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
};

