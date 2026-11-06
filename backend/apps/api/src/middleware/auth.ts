import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { authenticate, AuthError, type AccessClaims, type TokenService } from '@meetyou/auth';
import type { Db, WorkspaceTx } from '@meetyou/db';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessClaims;
    workspaceId?: string;
    userId?: string;
    inWorkspace?: <T>(work: (tx: WorkspaceTx) => Promise<T>) => Promise<T>;
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    tryAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthPluginOptions {
  tokens: TokenService;
  db?: Db;
}

const authPluginAsync: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const { tokens, db } = options;

  fastify.decorateRequest('user', undefined);
  fastify.decorateRequest('workspaceId', undefined);
  fastify.decorateRequest('userId', undefined);
  fastify.decorateRequest('inWorkspace', undefined);

  // Helper hook to enforce authentication on routes that require it
  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    const claims = await authenticate(request.headers.authorization, tokens);
    request.user = claims;
    request.workspaceId = claims.workspaceId;
    request.userId = claims.userId;

    if (db) {
      request.inWorkspace = <T>(work: (tx: WorkspaceTx) => Promise<T>) =>
        db.inWorkspace(claims.workspaceId, work);
    }
  });

  // Optional auth helper: inspects credentials if present, but doesn't fail if absent
  fastify.decorate('tryAuth', async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return;
    try {
      const claims = await authenticate(authHeader, tokens);
      request.user = claims;
      request.workspaceId = claims.workspaceId;
      request.userId = claims.userId;
      if (db) {
        request.inWorkspace = <T>(work: (tx: WorkspaceTx) => Promise<T>) =>
          db.inWorkspace(claims.workspaceId, work);
      }
    } catch (err) {
      // If authorization was explicitly supplied but invalid, propagate the auth error
      if (err instanceof AuthError) {
        throw err;
      }
    }
  });
};

export const authPlugin = fp(authPluginAsync, {
  name: 'auth-plugin',
  fastify: '5.x',
});
