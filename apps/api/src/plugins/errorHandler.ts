import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  requestId: string;
  decisionId?: string;
  currentVersion?: number;
}

export function registerErrorHandler(app: FastifyInstance, nodeEnv: string): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? (error.validation ? 400 : 500);
    const requestId = (request.id as string) || 'unknown';

    let errorName = 'Internal Server Error';
    if (statusCode === 400) errorName = 'Bad Request';
    else if (statusCode === 401) errorName = 'Unauthorized';
    else if (statusCode === 403) errorName = 'Forbidden';
    else if (statusCode === 404) errorName = 'Not Found';
    else if (statusCode === 409) errorName = 'Conflict';
    else if (statusCode === 422) errorName = 'Unprocessable Entity';
    else if (statusCode === 423) errorName = error.name || 'Locked';
    else if (error.name && error.name !== 'Error') errorName = error.name;

    const isProd = nodeEnv === 'production';
    const message = isProd && statusCode === 500 ? 'An unexpected error occurred' : error.message;

    request.log.error({
      err: error,
      requestId,
      statusCode,
    });

    const response: ErrorResponse = {
      statusCode,
      error: errorName,
      message,
      requestId,
    };

    if ((error as unknown as { decisionId?: string }).decisionId) {
      response.decisionId = (error as unknown as { decisionId?: string }).decisionId;
    }
    if ((error as unknown as { currentVersion?: number }).currentVersion !== undefined) {
      response.currentVersion = (error as unknown as { currentVersion?: number }).currentVersion;
    }

    reply.status(statusCode).send(response);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || 'unknown';
    const response: ErrorResponse = {
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      requestId,
    };
    reply.status(404).send(response);
  });
}
