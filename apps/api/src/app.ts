import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { env as defaultEnv, type Env } from './config/env.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { healthRoutes } from './routes/health.js';
import crypto from 'node:crypto';

export interface BuildAppOptions extends FastifyServerOptions {
  env?: Env;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const currentEnv = options.env ?? defaultEnv;

  const app = fastify({
    logger: {
      level: currentEnv.LOG_LEVEL,
      ...(currentEnv.NODE_ENV === 'test' ? { level: 'silent' } : {}),
    },
    genReqId: req => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    ...options,
  });

  // CORS
  await app.register(cors, {
    origin: currentEnv.CORS_ORIGIN.split(',').map(o => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Echo request ID in response header
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Centralized Error & Not Found Handlers
  registerErrorHandler(app, currentEnv.NODE_ENV);

  // Health Route
  await app.register(healthRoutes);

  return app;
}
