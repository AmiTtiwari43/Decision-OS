import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import {
  createCommentSchema,
  updateCommentSchema,
  resolveCommentSchema,
  type CreateCommentInput,
  type UpdateCommentInput,
  type ResolveCommentInput,
} from '../models/index.js';
import { commentService } from '../services/comment.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  CommentNotFoundError,
  CommentDepthExceededError,
  InvalidCommentResolutionError,
  InvalidCommentTargetError,
  InvalidOptionReferenceError,
  InvalidCriterionReferenceError,
  DecisionQuarantinedError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);
}

function handleCommentError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = (request.id as string) || 'unknown';

  if (
    err instanceof InvalidDecisionIdError ||
    err instanceof InvalidCommentTargetError ||
    err instanceof CommentDepthExceededError ||
    err instanceof InvalidCommentResolutionError ||
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

  if (err instanceof ForbiddenError) {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof DecisionNotFoundError || err instanceof CommentNotFoundError) {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
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

export const commentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All comment routes require authentication
  app.addHook('preHandler', app.authenticate);

  // GET /decisions/:id/comments — List comments for a decision
  app.get('/decisions/:id/comments', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { targetType?: string; targetId?: string; isResolved?: string };
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
      const filter: { targetType?: string; targetId?: string; isResolved?: boolean } = {};
      if (query.targetType) filter.targetType = query.targetType;
      if (query.targetId) filter.targetId = query.targetId;
      if (query.isResolved !== undefined) filter.isResolved = query.isResolved === 'true';

      const comments = await commentService.listComments(id, filter, request.user);
      return reply.status(200).send({ items: comments });
    } catch (err) {
      return handleCommentError(err, request, reply);
    }
  });

  // POST /decisions/:id/comments — Create a root comment or reply
  app.post('/decisions/:id/comments', async (request: FastifyRequest, reply: FastifyReply) => {
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
    const parsed = createCommentSchema.safeParse(body);
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
      const comment = await commentService.createComment(
        id,
        parsed.data as CreateCommentInput,
        request.user
      );
      return reply.status(201).send(comment);
    } catch (err) {
      return handleCommentError(err, request, reply);
    }
  });

  // GET /decisions/:id/comments/:commentId — Get a single comment
  app.get('/decisions/:id/comments/:commentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid decision ID or comment ID',
        requestId,
      });
    }

    try {
      const comment = await commentService.getComment(id, commentId, request.user);
      return reply.status(200).send(comment);
    } catch (err) {
      return handleCommentError(err, request, reply);
    }
  });

  // PATCH /decisions/:id/comments/:commentId — Edit own comment content
  app.patch('/decisions/:id/comments/:commentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid decision ID or comment ID',
        requestId,
      });
    }

    const body = request.body as Record<string, unknown>;
    const parsed = updateCommentSchema.safeParse(body);
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
      const updated = await commentService.updateComment(
        id,
        commentId,
        parsed.data as UpdateCommentInput,
        request.user
      );
      return reply.status(200).send(updated);
    } catch (err) {
      return handleCommentError(err, request, reply);
    }
  });

  // DELETE /decisions/:id/comments/:commentId — Delete comment (tombstone if has replies)
  app.delete('/decisions/:id/comments/:commentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid decision ID or comment ID',
        requestId,
      });
    }

    try {
      const result = await commentService.deleteComment(id, commentId, request.user);
      return reply.status(200).send(result);
    } catch (err) {
      return handleCommentError(err, request, reply);
    }
  });

  // POST /decisions/:id/comments/:commentId/resolve — Resolve or reopen thread (Root only)
  app.post('/decisions/:id/comments/:commentId/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const requestId = (request.id as string) || 'unknown';

    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid decision ID or comment ID',
        requestId,
      });
    }

    const body = request.body as Record<string, unknown>;
    const parsed = resolveCommentSchema.safeParse(body);
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
      const resolved = await commentService.resolveThread(
        id,
        commentId,
        parsed.data as ResolveCommentInput,
        request.user
      );
      return reply.status(200).send(resolved);
    } catch (err) {
      return handleCommentError(err, request, reply);
    }
  });
};
