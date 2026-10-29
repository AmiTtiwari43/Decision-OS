import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { checkDatabaseHealth } from '../db/connection.js';

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
};
