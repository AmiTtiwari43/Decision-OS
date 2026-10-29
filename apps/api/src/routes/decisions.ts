import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { createDecisionSchema, updateDecisionSchema } from '../models/index.js';
import {
  createDecision,
  getDecision,
  listDecisions,
  updateDecision,
  deleteDecision,
  analyzeDecision,
} from '../services/decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  IncompleteScoresError,
  EngineValidationError,
} from '../errors/domain.errors.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

function handleServiceError(
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

  if (err instanceof DecisionNotFoundError) {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof IncompleteScoresError) {
    reply.status(422).send({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: err.message,
      missingPairs: err.missingPairs,
      requestId,
    });
    return;
  }

  if (err instanceof EngineValidationError) {
    reply.status(422).send({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: err.message,
      requestId,
    });
    return;
  }

  // Re-throw for Fastify's global error handler
  throw err;
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export const decisionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Enforce authentication on all /api/decisions routes
  app.addHook('preHandler', app.authenticate);

  // POST /api/decisions — Create a new decision
  app.post('/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;

    const parsed = createDecisionSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const doc = await createDecision(parsed.data as Record<string, unknown>, request.user);
      return reply.status(201).send(doc);
    } catch (err) {
      return handleServiceError(err, request, reply);
    }
  });

  // GET /api/decisions — List decisions with pagination
  app.get('/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;

    const rawPage = parseInt(query.page ?? '1', 10);
    const rawLimit = parseInt(query.limit ?? '20', 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20;
    const search = query.search?.trim() || undefined;

    try {
      const result = await listDecisions(
        search ? { search } : undefined,
        { page, limit },
        request.user
      );
      return reply.status(200).send(result);
    } catch (err) {
      return handleServiceError(err, request, reply);
    }
  });

  // GET /api/decisions/:id — Get a single decision
  app.get('/decisions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const doc = await getDecision(id, request.user);
      const docWithJson = doc as unknown as { toJSON?: () => Record<string, unknown> };
      const payload: Record<string, unknown> =
        typeof docWithJson.toJSON === 'function' ? docWithJson.toJSON() : { ...(doc as unknown as Record<string, unknown>) };
      if (doc.currentUserRole) {
        payload.currentUserRole = doc.currentUserRole;
      }
      return reply.status(200).send(payload);
    } catch (err) {
      return handleServiceError(err, request, reply);
    }
  });

  // PUT /api/decisions/:id — Update a decision
  app.put('/decisions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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
    const parsed = updateDecisionSchema.safeParse(body);
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
      const doc = await updateDecision(id, parsed.data as Record<string, unknown>, request.user);
      return reply.status(200).send(doc);
    } catch (err) {
      return handleServiceError(err, request, reply);
    }
  });

  // DELETE /api/decisions/:id — Delete a decision
  app.delete('/decisions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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
      await deleteDecision(id, request.user);
      return reply.status(204).send();
    } catch (err) {
      return handleServiceError(err, request, reply);
    }
  });

  // POST /api/decisions/:id/analyze — Run server-side MCDA analysis
  app.post('/decisions/:id/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const doc = await analyzeDecision(id, request.user);
      return reply.status(200).send(doc);
    } catch (err) {
      return handleServiceError(err, request, reply);
    }
  });
};
