import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import {
  saveContributionSchema,
  adoptContributionSchema,
  rejectContributionSchema,
  type SaveContributionInput,
  type AdoptContributionInput,
  type RejectContributionInput,
} from '../models/index.js';
import { contributionService } from '../services/contribution.service.js';
import { decisionRepository } from '../repositories/decision.repository.js';
import { authorizeDecisionAction } from '../services/authorization.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  ContributionNotFoundError,
  ContributionRoundLockedError,
  InvalidOptionReferenceError,
  InvalidCriterionReferenceError,
  DecisionConflictError,
  DecisionQuarantinedError,
  InvalidContributionStatusError,
  EngineValidationError,
  ConcurrencyFencingError,
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
    err instanceof InvalidCriterionReferenceError ||
    err instanceof InvalidContributionStatusError
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

  if (err instanceof DecisionConflictError) {
    reply.status(409).send({
      statusCode: 409,
      error: 'Conflict',
      message: err.message,
      currentVersion: err.currentVersion,
      requestId,
    });
    return;
  }

  if (err instanceof ConcurrencyFencingError) {
    reply.status(409).send({
      statusCode: 409,
      error: 'Conflict',
      message: err.message,
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

  if (err instanceof DecisionQuarantinedError) {
    reply.status(423).send({
      statusCode: 423,
      error: 'DecisionQuarantinedError',
      message: err.message,
      decisionId: err.decisionId,
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

  // POST /decisions/:id/contributions/:contributionId/reject — Reject contribution with rationale (Owner only)
  app.post(
    '/decisions/:id/contributions/:contributionId/reject',
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
        const decision = await decisionRepository.findById(id);
        if (!decision) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: `Decision with id '${id}' not found`,
            requestId,
          });
        }

        // Authorize action first: owner or admin only
        await authorizeDecisionAction(decision, 'reject_contribution', request.user);

        const body = (request.body as Record<string, unknown>) || {};
        const parsed = rejectContributionSchema.safeParse(body);
        if (!parsed.success) {
          const messages = parsed.error.errors.map((e) => e.message).join('; ');
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: messages,
            requestId,
          });
        }

        const rejected = await contributionService.rejectContribution(
          id,
          contributionId,
          parsed.data as RejectContributionInput,
          request.user
        );
        return reply.status(200).send(rejected);
      } catch (err) {
        return handleContributionError(err, request, reply);
      }
    }
  );

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
        const decision = await decisionRepository.findById(id);
        if (!decision) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: `Decision with id '${id}' not found`,
            requestId,
          });
        }

        // Authorize action FIRST: owner or admin only (rejects non-owner with 403 Forbidden)
        await authorizeDecisionAction(decision, 'adopt', request.user);

        // Body validation
        const body = (request.body as Record<string, unknown>) || {};
        const parsed = adoptContributionSchema.safeParse(body);
        if (!parsed.success) {
          const messages = parsed.error.errors.map((e) => e.message).join('; ');
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: messages,
            requestId,
          });
        }

        const result = await contributionService.adoptExpertScores(
          id,
          contributionId,
          parsed.data as AdoptContributionInput,
          request.user
        );

        if (result.isIdempotentReplay) {
          reply.header('X-Decision-Idempotent-Replay', 'true');
        }

        return reply.status(200).send(result.decision);
      } catch (err) {
        return handleContributionError(err, request, reply);
      }
    }
  );
};
