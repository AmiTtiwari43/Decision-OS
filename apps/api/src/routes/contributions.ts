import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import {
  saveContributionSchema,
  type SaveContributionInput,
} from '../models/index.js';
import { contributionService } from '../services/contribution.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  ContributionNotFoundError,
  ContributionRoundLockedError,
  InvalidOptionReferenceError,
  InvalidCriterionReferenceError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

function handleContributionError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = (request.id as string) || 'unknown';

  if (
    err instanceof InvalidDecisionIdError ||
    err instanceof InvalidOptionReferenceError ||
    err instanceof InvalidCriterionReferenceError
  ) {
    reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof ForbiddenError || err instanceof ContributionRoundLockedError) {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof DecisionNotFoundError || err instanceof ContributionNotFoundError) {
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

export const contributionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All contribution routes require authentication
  app.addHook('preHandler', app.authenticate);

  // GET /decisions/:id/contributions — List contributions for a decision
  app.get('/decisions/:id/contributions', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const items = await contributionService.listContributions(id, request.user);
      return reply.status(200).send({ items });
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // GET /decisions/:id/contributions/mine — Get current user's contribution
  app.get('/decisions/:id/contributions/mine', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const item = await contributionService.getMineContribution(id, request.user);
      return reply.status(200).send({ item });
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // POST /decisions/:id/contributions — Save/update draft contribution
  app.post('/decisions/:id/contributions', async (request: FastifyRequest, reply: FastifyReply) => {
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
    const parsed = saveContributionSchema.safeParse(body);
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
      const item = await contributionService.saveContribution(
        id,
        parsed.data as SaveContributionInput,
        request.user
      );
      return reply.status(200).send(item);
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // POST /decisions/:id/contributions/submit — Finalize and submit contribution
  app.post('/decisions/:id/contributions/submit', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const item = await contributionService.submitContribution(id, request.user);
      return reply.status(200).send(item);
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // POST /decisions/:id/contributions/withdraw — Withdraw submitted contribution
  app.post('/decisions/:id/contributions/withdraw', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const item = await contributionService.withdrawContribution(id, request.user);
      return reply.status(200).send(item);
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // POST /decisions/:id/contributions/lock — Lock contribution round (Owner only)
  app.post('/decisions/:id/contributions/lock', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const decision = await contributionService.lockRound(id, request.user);
      return reply.status(200).send(decision);
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // POST /decisions/:id/contributions/unlock — Unlock contribution round (Owner only)
  app.post('/decisions/:id/contributions/unlock', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const decision = await contributionService.unlockRound(id, request.user);
      return reply.status(200).send(decision);
    } catch (err) {
      return handleContributionError(err, request, reply);
    }
  });

  // POST /decisions/:id/contributions/:contributionId/adopt — Adopt expert scores into decision (Owner only)
  app.post(
    '/decisions/:id/contributions/:contributionId/adopt',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, contributionId } = request.params as { id: string; contributionId: string };
      const requestId = (request.id as string) || 'unknown';

      if (!isValidObjectId(id) || !isValidObjectId(contributionId)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid decision ID or contribution ID',
          requestId,
        });
      }

      try {
        const decision = await contributionService.adoptExpertScores(id, contributionId, request.user);
        return reply.status(200).send(decision);
      } catch (err) {
        return handleContributionError(err, request, reply);
      }
    }
  );
};

