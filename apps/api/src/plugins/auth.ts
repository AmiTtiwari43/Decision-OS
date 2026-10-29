import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { env as defaultEnv, type Env } from '../config/env.js';

export interface TokenPayload {
  sub: string;
  id: string;
  email: string;
  role: 'user' | 'admin';
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuthenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerAuthPlugin(
  app: FastifyInstance,
  options: { env?: Env } = {}
): Promise<void> {
  const currentEnv = options.env ?? defaultEnv;

  await app.register(fastifyJwt, {
    secret: currentEnv.JWT_SECRET,
    sign: {
      expiresIn: '7d',
    },
  });

  // Strict authentication preHandler
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required: missing or invalid Authorization header',
        requestId: (request.id as string) || 'unknown',
      });
    }

    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required: invalid or expired token',
        requestId: (request.id as string) || 'unknown',
      });
    }
  });

  // Optional authentication preHandler (attaches user if valid token present)
  app.decorate('optionalAuthenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        await request.jwtVerify();
      } catch {
        // Silently ignore invalid tokens for optional auth
      }
    }
  });

  // Role-based access control: Admin required
  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user?.role !== 'admin') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Administrative privileges required',
        requestId: (request.id as string) || 'unknown',
      });
    }
  });
}

