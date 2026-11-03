import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import { env as defaultEnv, type Env } from './config/env.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { decisionRoutes } from './routes/decisions.js';
import { sharingRoutes } from './routes/sharing.js';
import { contributionRoutes } from './routes/contributions.js';
import { evidenceRoutes } from './routes/evidence.js';
import { aiRoutes } from './routes/ai.js';
import { analyticsRoutes } from './routes/analytics.js';
import { disagreementRoutes } from './routes/disagreements.js';
import { calibrationRoutes } from './routes/calibration.js';
import { auditRoutes } from './routes/audit.js';
import { collaborationRoutes } from './routes/collaboration.js';
import { commentRoutes } from './routes/comments.js';
import crypto from 'node:crypto';

export interface BuildAppOptions extends FastifyServerOptions {
  env?: Env;
  enableRateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const currentEnv = options.env ?? defaultEnv;

  const app = fastify({
    logger: {
      level: currentEnv.LOG_LEVEL,
      ...(currentEnv.NODE_ENV === 'test' ? { level: 'silent' } : {}),
    },
    bodyLimit: 1048576, // 1MB payload limit protects against unbounded memory ingestion
    genReqId: req => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    ...options,
  });

  // Payload Compression (gzip & deflate with 1KB threshold)
  await app.register(compress, {
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
  });

  // Global Rate Limiting
  if (options.enableRateLimit !== false && currentEnv.NODE_ENV !== 'test' && !process.env.BENCHMARK) {
    await app.register(rateLimit, {
      max: 1000,
      timeWindow: '1 minute',
    });
  }

  // CORS
  await app.register(cors, {
    origin: currentEnv.CORS_ORIGIN.split(',').map(o => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Echo request ID in response header
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Centralized Error & Not Found Handlers
  registerErrorHandler(app, currentEnv.NODE_ENV);

  // Authentication Plugin (JWT & Auth hooks)
  await registerAuthPlugin(app, { env: currentEnv });

  // Public Health Routes
  await app.register(healthRoutes);

  // Auth Routes
  await app.register(authRoutes, { prefix: '/api/auth' });

  // Protected Decision Routes
  await app.register(decisionRoutes, { prefix: '/api' });

  // Decision Sharing & Invitation Routes
  await app.register(sharingRoutes, { prefix: '/api' });

  // Expert Contribution Routes
  await app.register(contributionRoutes, { prefix: '/api' });

  // Deliberation Comment Routes
  await app.register(commentRoutes, { prefix: '/api' });

  // Evidence & Provenance Routes
  await app.register(evidenceRoutes, { prefix: '/api' });

  // AI Analyst Routes
  await app.register(aiRoutes, { prefix: '/api' });

  // Analytics Routes
  await app.register(analyticsRoutes, { prefix: '/api' });

  // Disagreement Intelligence Routes
  await app.register(disagreementRoutes, { prefix: '/api' });

  // Expert Calibration Routes
  await app.register(calibrationRoutes, { prefix: '/api' });

  // Audit, History and Export Routes
  await app.register(auditRoutes, { prefix: '/api' });

  // Real-Time Collaboration Routes
  await app.register(collaborationRoutes, { prefix: '/api' });

  return app;
}
