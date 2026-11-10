import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from '@meetyou/auth';
import type { ErrorBody } from '@meetyou/contracts';

/** Base application error with standard HTTP status, machine code, and retry hint. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(statusCode: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'bad request', code = 'bad_request') {
    super(400, code, message, false);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'unauthorized', code = 'unauthorized') {
    super(401, code, message, false);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'not found', code = 'not_found') {
    super(404, code, message, false);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'conflict', code = 'conflict') {
    super(409, code, message, false);
  }
}

export class IdempotencyInFlightError extends AppError {
  constructor(
    message = 'request with this idempotency key is already in flight',
    code = 'in_flight',
  ) {
    super(409, code, message, true);
  }
}

/** Formats an error response conforming to `shared/contracts` `ErrorBody`. */
export function formatError(code: string, message: string, retryable: boolean): ErrorBody {
  return {
    error: {
      code,
      message,
      retryable,
    },
  };
}

/**
 * Fastify global error handler (ARCHITECTURE §12.2).
 * Formats all client and server errors into `{ error: { code, message, retryable } }`.
 * Never leaks internal stacks, tokens, or sensitive information in production (AGENTS §7).
 */
export function handleFastifyError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // 1. Known AppError instances
  if (error instanceof AppError) {
    reply.status(error.statusCode).send(formatError(error.code, error.message, error.retryable));
    return;
  }

  // 2. Auth service errors (@meetyou/auth)
  if (error instanceof AuthError) {
    reply.status(error.status).send(formatError(error.code, error.code, false));
    return;
  }

  // 3. Fastify schema validation errors
  const fastifyErr = error as FastifyError;
  if (fastifyErr.validation !== undefined) {
    reply.status(400).send(formatError('validation_error', fastifyErr.message, false));
    return;
  }

  // 4. Fastify route/content-type/parsing errors
  if (typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode < 500) {
    const code = fastifyErr.code ?? 'bad_request';
    reply.status(fastifyErr.statusCode).send(formatError(code, fastifyErr.message, false));
    return;
  }

  // 5. Unhandled / internal server errors (500)
  request.log.error({ err: error, reqId: request.id }, 'Unhandled server error');
  reply.status(500).send(formatError('internal_error', 'internal server error', true));
}

/** Fastify not found (404) handler. */
export function handleNotFound(_request: FastifyRequest, reply: FastifyReply): void {
  reply.status(404).send(formatError('not_found', 'route not found', false));
}
