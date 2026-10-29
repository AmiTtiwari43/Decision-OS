import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import {
  createEvidenceSchema,
  updateEvidenceSchema,
  type EvidenceTargetType,
} from '../models/index.js';
import { evidenceService } from '../services/evidence.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  EvidenceNotFoundError,
  InvalidEvidenceTargetError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

function handleEvidenceError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply
): void {
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

  if (
    err instanceof InvalidDecisionIdError ||
    err instanceof InvalidEvidenceTargetError
  ) {
    reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: err.message,
      requestId,
    });
    return;
  }

  if (
    err instanceof DecisionNotFoundError ||
    err instanceof EvidenceNotFoundError
  ) {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: err.message,
      requestId,
    });
    return;
  }

  throw err;
}

export const evidenceRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All evidence routes require authentication
  app.addHook('preHandler', app.authenticate);

  // GET /decisions/:id/evidence — List evidence for a decision
  app.get('/decisions/:id/evidence', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { targetType, targetId } = request.query as {
      targetType?: EvidenceTargetType;
      targetId?: string;
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
      const items = await evidenceService.listEvidence(
        {
          decisionId: id,
          targetType,
          targetId,
        },
        request.user
      );
      return reply.status(200).send({ items });
    } catch (err) {
      return handleEvidenceError(err, request, reply);
    }
  });

  // POST /decisions/:id/evidence — Create evidence
  app.post('/decisions/:id/evidence', async (request: FastifyRequest, reply: FastifyReply) => {
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
    const parsed = createEvidenceSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId,
      });
    }

    try {
      const item = await evidenceService.createEvidence(id, parsed.data, request.user);
      return reply.status(201).send(item);
    } catch (err) {
      return handleEvidenceError(err, request, reply);
    }
  });

  // GET /decisions/:id/evidence/:evidenceId — Get single evidence record
  app.get('/decisions/:id/evidence/:evidenceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, evidenceId } = request.params as { id: string; evidenceId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `'${id}' is not a valid decision ID`,
        requestId,
      });
    }

    if (!isValidObjectId(evidenceId)) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `'${evidenceId}' is not a valid evidence ID`,
        requestId,
      });
    }

    try {
      const item = await evidenceService.getEvidence(id, evidenceId, request.user);
      return reply.status(200).send(item);
    } catch (err) {
      return handleEvidenceError(err, request, reply);
    }
  });

  // PATCH /decisions/:id/evidence/:evidenceId — Update evidence record
  app.patch('/decisions/:id/evidence/:evidenceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, evidenceId } = request.params as { id: string; evidenceId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `'${id}' is not a valid decision ID`,
        requestId,
      });
    }

    if (!isValidObjectId(evidenceId)) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `'${evidenceId}' is not a valid evidence ID`,
        requestId,
      });
    }

    const body = request.body as Record<string, unknown>;
    const parsed = updateEvidenceSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId,
      });
    }

    try {
      const item = await evidenceService.updateEvidence(id, evidenceId, parsed.data, request.user);
      return reply.status(200).send(item);
    } catch (err) {
      return handleEvidenceError(err, request, reply);
    }
  });

  // DELETE /decisions/:id/evidence/:evidenceId — Delete evidence record
  app.delete('/decisions/:id/evidence/:evidenceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, evidenceId } = request.params as { id: string; evidenceId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `'${id}' is not a valid decision ID`,
        requestId,
      });
    }

    if (!isValidObjectId(evidenceId)) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `'${evidenceId}' is not a valid evidence ID`,
        requestId,
      });
    }

    try {
      await evidenceService.deleteEvidence(id, evidenceId, request.user);
      return reply.status(204).send();
    } catch (err) {
      return handleEvidenceError(err, request, reply);
    }
  });
};

