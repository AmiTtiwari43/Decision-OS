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

const SENSITIVE_QUERY_PARAMS = /([?&](?:token|access_token)=)[^&#]*/gi;

/** Replaces credential-bearing query parameter values with a redaction marker. */
export function redactUrlCredentials(url: string): string {
  return url.replace(SENSITIVE_QUERY_PARAMS, '$1[REDACTED]');
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const currentEnv = options.env ?? defaultEnv;

  const app = fastify({
    logger: {
      level: currentEnv.LOG_LEVEL,
      ...(currentEnv.NODE_ENV === 'test' ? { level: 'silent' } : {}),
      serializers: {
        // EventSource cannot send an Authorization header, so the collaboration
        // stream accepts ?token=<jwt>. Never write that credential to logs.
        req: (req: { method: string; url: string; host?: string; ip?: string; socket?: { remotePort?: number } }) => ({
          method: req.method,
          url: redactUrlCredentials(req.url),
          host: req.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        }),
      },
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

  // CORS: Dynamic origin matcher supporting localhost, Vercel deployments, and configured origins
  const configuredOrigins = currentEnv.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
  const staticAllowedOrigins = new Set([
    ...configuredOrigins,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://decision-os-lac-six.vercel.app',
  ]);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server health checks)
      if (!origin) {
        return cb(null, true);
      }
      if (staticAllowedOrigins.has(origin) || staticAllowedOrigins.has('*')) {
        return cb(null, true);
      }
      try {
        const url = new URL(origin);
        if (
          url.hostname.endsWith('.vercel.app') ||
          url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1'
        ) {
          return cb(null, true);
        }
      } catch {
        // Invalid origin format
      }
      return cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    credentials: true,
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
