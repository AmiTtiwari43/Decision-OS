import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import mongoose from 'mongoose';
import { auditService } from '../services/audit.service.js';
import { snapshotService } from '../services/snapshot.service.js';
import { exportService } from '../services/export.service.js';
import {
  DecisionNotFoundError,
  SnapshotNotFoundError,
  ForbiddenError,
} from '../errors/domain.errors.js';

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().optional(),
  entityType: z.enum([
    'decision',
    'criterion',
    'option',
    'score',
    'sharing',
    'contribution',
    'evidence',
    'ai',
    'disagreement',
    'prediction',
    'snapshot',
    'export',
  ]).optional(),
  actorId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const createSnapshotSchema = z.object({
  reason: z.enum(['calculation', 'milestone', 'manual', 'round_lock']).default('manual'),
  note: z.string().max(500).optional(),
});

const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'html']).default('json'),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // All audit and export routes require authentication
  app.addHook('onRequest', app.authenticate);

  /**
   * GET /api/decisions/:id/audit
   * Retrieves paginated, chronological audit history for a decision.
   */
  app.get('/decisions/:id/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    const queryParse = auditQuerySchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: queryParse.error.errors[0]?.message || 'Invalid query parameters',
        requestId: (request.id as string) || 'unknown',
      });
    }

    const { page, limit, ...filter } = queryParse.data;

    try {
      const history = await auditService.getDecisionHistory(
        id,
        filter,
        { page, limit },
        request.user
      );
      return reply.status(200).send(history);
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
  });

  /**
   * GET /api/decisions/:id/audit/verify
   * Verifies the SHA-256 hash chain integrity of all events in the decision history.
   */
  app.get('/decisions/:id/audit/verify', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const verification = await auditService.verifyChainIntegrity(id, request.user);
      return reply.status(200).send(verification);
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
  });

  /**
   * GET /api/decisions/:id/snapshots
   * Lists historical snapshots for a decision.
   */
  app.get('/decisions/:id/snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const snapshots = await snapshotService.listSnapshots(id, request.user);
      return reply.status(200).send({ items: snapshots });
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
  });

  /**
   * POST /api/decisions/:id/snapshots
   * Creates an immutable milestone snapshot of the current decision state and analysis.
   */
  app.post('/decisions/:id/snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    const parseResult = createSnapshotSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid snapshot payload',
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const snapshot = await snapshotService.createSnapshot({
        decisionId: id,
        reason: parseResult.data.reason,
        note: parseResult.data.note,
        requester: request.user,
      });
      return reply.status(201).send(snapshot);
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
  });

  /**
   * GET /api/decisions/:id/snapshots/:snapshotId
   * Retrieves full preserved details of a specific snapshot.
   */
  app.get('/decisions/:id/snapshots/:snapshotId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, snapshotId } = request.params as { id: string; snapshotId: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      const snapshot = await snapshotService.getSnapshotById(snapshotId, request.user);
      if (snapshot.decisionId !== id) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Snapshot "${snapshotId}" does not belong to decision "${id}"`,
          requestId: (request.id as string) || 'unknown',
        });
      }
      return reply.status(200).send(snapshot);
    } catch (err) {
      if (err instanceof SnapshotNotFoundError || err instanceof DecisionNotFoundError) {
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
  });

  /**
   * GET /api/decisions/:id/export
   * Generates and downloads a portable decision export package in JSON, CSV, or HTML format.
   */
  app.get('/decisions/:id/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!isValidObjectId(id)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid decision ID: "${id}" is not a valid 24-character hexadecimal string`,
        requestId: (request.id as string) || 'unknown',
      });
    }

    const parseQuery = exportQuerySchema.safeParse(request.query);
    if (!parseQuery.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseQuery.error.errors[0]?.message || 'Invalid export format parameter',
        requestId: (request.id as string) || 'unknown',
      });
    }

    const { format } = parseQuery.data;

    try {
      const pkg = await exportService.generateExport(id, format, request.user);

      return reply
        .header('Content-Type', pkg.contentType)
        .header('Content-Disposition', `attachment; filename="${pkg.filename}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .status(200)
        .send(pkg.content);
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
  });
};

