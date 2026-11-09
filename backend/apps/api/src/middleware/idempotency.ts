import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { IdempotencyInFlightError } from '../errors.ts';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedResponse {
  statusCode: number;
  headers: Record<string, string | number | string[] | undefined>;
  payload: string;
}

export type IdempotencyRecord =
  | { status: 'in_flight'; startedAt: number }
  | { status: 'completed'; completedAt: number; response: CachedResponse };

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  setInFlight(key: string, ttlMs?: number): Promise<boolean>;
  setCompleted(key: string, response: CachedResponse, ttlMs?: number): Promise<void>;
  clear(key: string): Promise<void>;
}

/** In-memory store suitable for single-instance deployments and automated tests. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #records = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const entry = this.#records.get(key);
    if (!entry) return null;
    if (entry.expiresAt < this.#now()) {
      this.#records.delete(key);
      return null;
    }
    return entry.record;
  }

  async setInFlight(key: string, ttlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS): Promise<boolean> {
    const existing = await this.get(key);
    if (existing) {
      return false;
    }
    this.#records.set(key, {
      record: { status: 'in_flight', startedAt: this.#now() },
      expiresAt: this.#now() + ttlMs,
    });
    return true;
  }

  async setCompleted(
    key: string,
    response: CachedResponse,
    ttlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS,
  ): Promise<void> {
    this.#records.set(key, {
      record: { status: 'completed', completedAt: this.#now(), response },
      expiresAt: this.#now() + ttlMs,
    });
  }

  async clear(key: string): Promise<void> {
    this.#records.delete(key);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyCompositeKey?: string;
  }
}

export interface IdempotencyOptions {
  store?: IdempotencyStore;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const idempotencyPluginAsync: FastifyPluginAsync<IdempotencyOptions> = async (fastify, options) => {
  const store = options.store ?? new MemoryIdempotencyStore();

  fastify.decorateRequest('idempotencyKey', undefined);
  fastify.decorateRequest('idempotencyCompositeKey', undefined);

  // 1. Pre-handler hook: check if idempotency key was supplied
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;

    const rawHeader = request.headers[IDEMPOTENCY_HEADER];
    if (!rawHeader || typeof rawHeader !== 'string') return;

    const key = rawHeader.trim();
    if (key === '') return;

    request.idempotencyKey = key;
    // The key is only ever scoped to the caller's workspace. The instance-level hook runs before
    // the route's `requireAuth`, so authenticate here; without a workspace (public routes such as
    // /v1/auth/google) nothing is cached — an IP scope would let one NAT user replay another's
    // response (found in the 2026-11-09 audit).
    if (request.workspaceId === undefined && typeof request.headers.authorization === 'string') {
      await fastify.requireAuth(request, reply);
    }
    if (request.workspaceId === undefined) return;
    const compositeKey = `${request.workspaceId}:${key}`;
    request.idempotencyCompositeKey = compositeKey;

    const existing = await store.get(compositeKey);
    if (existing) {
      if (existing.status === 'in_flight') {
        throw new IdempotencyInFlightError();
      }
      if (existing.status === 'completed') {
        // Return identical cached response
        const { statusCode, headers, payload } = existing.response;
        for (const [headerName, headerVal] of Object.entries(headers)) {
          if (headerVal !== undefined) {
            reply.header(headerName, headerVal);
          }
        }
        reply.header('x-idempotent-replay', 'true');
        return reply.status(statusCode).send(payload);
      }
    }

    const acquired = await store.setInFlight(compositeKey);
    if (!acquired) {
      throw new IdempotencyInFlightError();
    }
  });

  // 2. onSend hook: capture payload and cache response if request succeeded
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const compositeKey = request.idempotencyCompositeKey;
    if (!compositeKey) return payload;

    // Only cache successful or client error responses (status < 500)
    if (reply.statusCode < 500) {
      const payloadString =
        typeof payload === 'string'
          ? payload
          : Buffer.isBuffer(payload)
            ? payload.toString('utf8')
            : JSON.stringify(payload);

      await store.setCompleted(compositeKey, {
        statusCode: reply.statusCode,
        headers: {
          'content-type': reply.getHeader('content-type'),
        },
        payload: payloadString,
      });
    } else {
      // 5xx error: clear lock so client can retry
      await store.clear(compositeKey);
    }

    return payload;
  });

  // 3. onError hook: clear lock if an unhandled error occurred
  fastify.addHook('onError', async (request: FastifyRequest) => {
    const compositeKey = request.idempotencyCompositeKey;
    if (compositeKey) {
      await store.clear(compositeKey);
    }
  });
};

export const idempotencyPlugin = fp(idempotencyPluginAsync, {
  name: 'idempotency-plugin',
  fastify: '5.x',
});
