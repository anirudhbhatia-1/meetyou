import type { FastifyPluginAsync } from 'fastify';
import { AuthService, TokenService } from '@meetyou/auth';
import type { Db } from '@meetyou/db';
import { GoogleSignInRequest, RefreshRequest, type TokenResponse } from '@meetyou/contracts';

import type { ApiConfig } from '../config.ts';
import { BadRequestError } from '../errors.ts';

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
