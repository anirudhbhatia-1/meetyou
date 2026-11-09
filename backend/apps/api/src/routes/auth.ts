import type { FastifyPluginAsync } from 'fastify';
import { AuthService, type TokenService } from '@meetyou/auth';
import type { Db } from '@meetyou/db';
import { GoogleSignInRequest, RefreshRequest, type TokenResponse } from '@meetyou/contracts';

import type { ApiConfig } from '../config.ts';
import { BadRequestError, UnauthorizedError } from '../errors.ts';
import {
  clearRefreshCookie,
  isWebClient,
  readRefreshCookie,
  setRefreshCookie,
} from '../web-session.ts';

export interface AuthRoutesOptions {
  tokens: TokenService;
  db?: Db;
  config: ApiConfig;
  authService?: AuthService;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, options) => {
  const { tokens, db, config } = options;

  let authService = options.authService;
  if (!authService && db && config.googleClientId) {
    if (!config.googleClientSecret) {
      // A silent '' secret made every Google exchange fail with an opaque error (2026-11-09 audit).
      fastify.log.warn('GOOGLE_CLIENT_SECRET is not set: Google sign-in will fail');
    }
    authService = new AuthService({
      db,
      tokens,
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret ?? '',
        allowedRedirectUris: config.allowedRedirectUris,
      },
    });
  }

  // 1. Public JWKS (ARCHITECTURE §12.1, ADR-0004 §4.2)
  fastify.get(
    '/.well-known/jwks.json',
    {
      schema: {
        description: 'Get public JSON Web Key Set for token verification',
        tags: ['auth'],
        response: {
          200: {
            type: 'object',
            properties: {
              keys: { type: 'array' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const jwks = tokens.jwks;
      return reply.header('Cache-Control', 'public, max-age=3600').send(jwks);
    },
  );

  // 2. Google OAuth sign-in exchange (ADR-0004 §4.1)
  fastify.post(
    '/v1/auth/google',
    {
      preHandler: fastify.rateLimit({ name: 'auth', limit: 10, windowMs: 60_000, by: 'ip' }),
      schema: {
        description: 'Exchange Google authorization code with PKCE for access and refresh tokens',
        tags: ['auth'],
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              accessExpiresAt: { type: 'string' },
              refreshToken: { type: 'string' },
              refreshExpiresAt: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!authService) {
        throw new BadRequestError('Google authentication is not configured on this server');
      }

      const parseResult = GoogleSignInRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const pair = await authService.signInWithGoogle(parseResult.data);
      if (isWebClient(request)) {
        // Web app: the refresh token never reaches page script (ADR-0004 §4.5).
        setRefreshCookie(reply, pair.refreshToken, pair.refreshExpiresAt);
        return reply.send({
          accessToken: pair.accessToken,
          accessExpiresAt: pair.accessExpiresAt.toISOString(),
        });
      }
      const response: TokenResponse = {
        accessToken: pair.accessToken,
        accessExpiresAt: pair.accessExpiresAt.toISOString(),
        refreshToken: pair.refreshToken,
        refreshExpiresAt: pair.refreshExpiresAt.toISOString(),
      };

      return reply.send(response);
    },
  );

  // 3. Refresh token rotation (ADR-0004 §4.3)
  fastify.post(
    '/v1/auth/refresh',
    {
      preHandler: fastify.rateLimit({ name: 'refresh', limit: 60, windowMs: 60_000, by: 'ip' }),
      schema: {
        description: 'Rotate refresh token to obtain a new access and refresh token pair',
        tags: ['auth'],
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              accessExpiresAt: { type: 'string' },
              refreshToken: { type: 'string' },
              refreshExpiresAt: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!authService) {
        throw new BadRequestError('Authentication service is not configured');
      }

      if (isWebClient(request)) {
        const cookie = readRefreshCookie(request);
        if (cookie === null) throw new UnauthorizedError('not signed in', 'not_signed_in');
        const rotated = await authService.refresh(cookie);
        setRefreshCookie(reply, rotated.refreshToken, rotated.refreshExpiresAt);
        return reply.send({
          accessToken: rotated.accessToken,
          accessExpiresAt: rotated.accessExpiresAt.toISOString(),
        });
      }

      const parseResult = RefreshRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError('Invalid refresh token');
      }

      const pair = await authService.refresh(parseResult.data.refreshToken);
      const response: TokenResponse = {
        accessToken: pair.accessToken,
        accessExpiresAt: pair.accessExpiresAt.toISOString(),
        refreshToken: pair.refreshToken,
        refreshExpiresAt: pair.refreshExpiresAt.toISOString(),
      };

      return reply.send(response);
    },
  );

  // 4. Logout (revokes token family, ADR-0004 §4.4)
  fastify.post(
    '/v1/auth/logout',
    {
      schema: {
        description: 'Revoke refresh token and end session',
        tags: ['auth'],
        response: {
          204: { type: 'null', description: 'Session ended' },
        },
      },
    },
    async (request, reply) => {
      if (isWebClient(request)) {
        const cookie = readRefreshCookie(request);
        if (cookie !== null && authService) await authService.logout(cookie);
        clearRefreshCookie(reply);
        return reply.status(204).send();
      }

      if (!authService) {
        return reply.status(204).send();
      }

      const parseResult = RefreshRequest.safeParse(request.body);
      if (parseResult.success) {
        await authService.logout(parseResult.data.refreshToken);
      }

      return reply.status(204).send();
    },
  );
};
