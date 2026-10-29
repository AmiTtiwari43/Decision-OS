import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { aiService } from '../services/ai/ai.service.js';
import {
  aiAnalyzeRequestSchema,
  applyProposalSchema,
} from '../models/ai.schema.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  InvalidEvidenceTargetError,
  ForbiddenError,
  AIProviderUnavailableError,
  AITimeoutError,
  AIOutputValidationError,
  AIRateLimitError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

function handleAiError(err: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const requestId = (request.id as string) || 'unknown';

  if (err instanceof ForbiddenError) {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof InvalidDecisionIdError || err instanceof InvalidEvidenceTargetError) {
    reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof DecisionNotFoundError) {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof AIRateLimitError) {
    reply.status(429).send({
      statusCode: 429,
      error: 'Too Many Requests',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof AIOutputValidationError) {
    reply.status(502).send({
      statusCode: 502,
      error: 'Bad Gateway',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof AIProviderUnavailableError) {
    reply.status(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof AITimeoutError) {
    reply.status(504).send({
      statusCode: 504,
      error: 'Gateway Timeout',
      message: err.message,
      requestId,
    });
    return;
  }

  throw err;
}

export const aiRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All AI routes require authentication
  app.addHook('preHandler', app.authenticate);

  // POST /decisions/:id/ai/analyze — Request AI analysis
  app.post('/decisions/:id/ai/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const body = (request.body as Record<string, unknown>) || {};
    const parsed = aiAnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        requestId,
      });
    }

    try {
      const result = await aiService.analyzeDecision(id, parsed.data.capability, request.user);
      return reply.status(200).send(result);
    } catch (err) {
      return handleAiError(err, request, reply);
    }
  });

  // POST /decisions/:id/ai/proposals/apply — Explicitly apply an advisory proposal
  app.post('/decisions/:id/ai/proposals/apply', async (request: FastifyRequest, reply: FastifyReply) => {
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
    const parsed = applyProposalSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        requestId,
      });
    }

    try {
      const updated = await aiService.applyProposal(id, parsed.data, request.user);
      const docWithJson = updated as unknown as { toJSON?: () => Record<string, unknown> };
      const payload: Record<string, unknown> =
        typeof docWithJson.toJSON === 'function'
          ? docWithJson.toJSON()
          : { ...(updated as unknown as Record<string, unknown>) };
      return reply.status(200).send(payload);
    } catch (err) {
      return handleAiError(err, request, reply);
    }
  });
};
