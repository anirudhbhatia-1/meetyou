import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { AppError } from '../errors.ts';

/**
 * Small fixed-window rate limiter (2026-11-09 audit: auth, sessions, exports, search and
 * regenerate were unmetered). Per instance and in memory — enough to blunt abuse and runaway
 * clients in alpha; the Redis-backed shared version is Stage-5 work (AUDIT S5-H2). No dependency
 * on purpose (AGENTS §6.7).
 */
export interface RateRule {
  /** Separate buckets per rule name. */
  name: string;
  limit: number;
  windowMs: number;
  /** `workspace` needs requireAuth before this hook; it falls back to the IP. */
  by: 'ip' | 'workspace';
}

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    rateLimit: (rule: RateRule) => Hook;
  }
}

/** Above this many live buckets, expired ones are swept on the next hit. */
const SWEEP_AT = 10_000;

class TooManyRequestsError extends AppError {
  constructor(retryAfterS: number) {
    super(429, 'rate_limited', `rate limited, retry in ${retryAfterS}s`, true);
  }
}

const rateLimitPluginAsync: FastifyPluginAsync<{ now?: () => number }> = async (
  fastify,
  options,
) => {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();

  fastify.decorate('rateLimit', (rule: RateRule): Hook => {
    return async (request, reply) => {
      const scope = rule.by === 'workspace' ? (request.workspaceId ?? request.ip) : request.ip;
      const key = `${rule.name}:${scope}`;
      const at = now();
      if (windows.size > SWEEP_AT) {
        for (const [k, w] of windows) if (w.resetAt <= at) windows.delete(k);
      }
      const current = windows.get(key);
      if (current === undefined || current.resetAt <= at) {
        windows.set(key, { count: 1, resetAt: at + rule.windowMs });
        return;
      }
      current.count += 1;
      if (current.count > rule.limit) {
        const retryAfterS = Math.max(1, Math.ceil((current.resetAt - at) / 1000));
        reply.header('retry-after', String(retryAfterS));
        throw new TooManyRequestsError(retryAfterS);
      }
    };
  });
};

export const rateLimitPlugin = fp(rateLimitPluginAsync, { name: 'rate-limit' });
