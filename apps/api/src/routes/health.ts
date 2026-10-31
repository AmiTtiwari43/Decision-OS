import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { checkDatabaseHealth } from '../db/connection.js';
import { evaluationCache } from '../services/evaluationCache.js';
import { collaborationService } from '../services/collaboration.service.js';

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Liveness check: confirms process is responding
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'decision-os-api',
      version: '1.0.0',
    });
  });

  // Readiness check: actively verifies database connectivity
  app.get('/health/ready', async (_request, reply) => {
    const dbHealth = await checkDatabaseHealth();
    const isReady = dbHealth.status === 'connected';

    const statusCode = isReady ? 200 : 503;
    return reply.status(statusCode).send({
      status: isReady ? 'ok' : 'degraded',
      service: 'decision-os-api',
      database: dbHealth.status,
      ...(dbHealth.latencyMs !== undefined ? { latencyMs: dbHealth.latencyMs } : {}),
      ...(dbHealth.error ? { error: dbHealth.error } : {}),
    });
  });

  // Diagnostics check: provides granular operational metrics without exposing sensitive data
  app.get('/health/diagnostics', async (_request, reply) => {
    const dbHealth = await checkDatabaseHealth();
    const mem = process.memoryUsage();

    return reply.status(200).send({
      service: 'decision-os-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      database: {
        status: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
      },
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
      },
      engineCache: evaluationCache.getMetrics(),
      realtimeCollaboration: collaborationService.getMetrics(),
    });
  });
};
