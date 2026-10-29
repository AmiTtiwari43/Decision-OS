import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { registerSchema, loginSchema } from '../models/user.schema.js';
import { authService } from '../services/auth.service.js';
import {
  UserAlreadyExistsError,
  InvalidCredentialsError,
  UnauthorizedError,
} from '../errors/domain.errors.js';

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /api/auth/register — Register a new user
  app.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || 'unknown';
    const body = request.body as Record<string, unknown>;

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId,
      });
    }

    try {
      const user = await authService.register(parsed.data);
      const token = app.jwt.sign({
        sub: user.id,
        id: user.id,
        email: user.email,
        role: user.role,
      });

      return reply.status(201).send({
        user,
        token,
      });
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: err.message,
          requestId,
        });
      }
      throw err;
    }
  });

  // POST /api/auth/login — Authenticate user
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || 'unknown';
    const body = request.body as Record<string, unknown>;

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join('; ');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
        requestId,
      });
    }

    try {
      const user = await authService.login(parsed.data);
      const token = app.jwt.sign({
        sub: user.id,
        id: user.id,
        email: user.email,
        role: user.role,
      });

      return reply.status(200).send({
        user,
        token,
      });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: err.message,
          requestId,
        });
      }
      throw err;
    }
  });

  // POST /api/auth/logout — Log out (client discards token)
  app.post('/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      message: 'Successfully logged out',
    });
  });

  // GET /api/auth/me — Return current authenticated user profile
  app.get(
    '/me',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = (request.id as string) || 'unknown';
      try {
        const user = await authService.getCurrentUser(request.user.id);
        return reply.status(200).send({ user });
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: err.message,
            requestId,
          });
        }
        throw err;
      }
    }
  );
};

