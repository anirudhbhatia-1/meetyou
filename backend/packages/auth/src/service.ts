import { createHash, randomBytes } from 'node:crypto';

import { newUlid } from '@meetyou/contracts';
import type { Db } from '@meetyou/db';

import { AuthError } from './errors.ts';
import { exchangeGoogleCode, type GoogleConfig, type GoogleDeps } from './google.ts';
import type { TokenService } from './tokens.ts';

/** ADR-0004 §4.2: refresh tokens live 30 days, sliding (each rotation starts a new 30 days). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  userId: string;
  workspaceId: string;
}

/** Refresh tokens are opaque 256-bit values; the database keeps only the SHA-256 hash. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

const id = (prefix: string) => `${prefix}_${newUlid()}`;

/**
 * The three auth endpoints of ARCHITECTURE §12.1 as plain functions; the API service (S2-08) maps
 * them to `POST /v1/auth/google`, `/refresh` and `/logout` and `AuthError.status` to the response.
 */
export class AuthService {
  readonly #db: Db;
  readonly #tokens: TokenService;
  readonly #google: GoogleConfig;
  readonly #googleDeps: GoogleDeps;
  readonly #now: () => number;

  constructor(options: {
    db: Db;
    tokens: TokenService;
    google: GoogleConfig;
    googleDeps?: GoogleDeps;
    now?: () => number;
  }) {
    this.#db = options.db;
    this.#tokens = options.tokens;
    this.#google = options.google;
    this.#googleDeps = options.googleDeps ?? {};
    this.#now = options.now ?? Date.now;
  }

  /** Sign-in (ADR-0004 §4.1 steps 4–7): Google code → user and workspace → our tokens. */
  async signInWithGoogle(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenPair> {
    const profile = await exchangeGoogleCode(input, this.#google, this.#googleDeps);
    const account = await this.#db.signInGoogleUser(profile, {
      userId: id('usr'),
      workspaceId: id('ws'),
      membershipId: id('mem'),
      settingsId: id('set'),
    });
    if (account.workspaceId === null) throw new AuthError('no_workspace', 403);
    const refreshToken = newRefreshToken();
    const refreshExpiresAt = new Date(this.#now() + REFRESH_TOKEN_TTL_MS);
    await this.#db.issueRefreshToken({
      userId: account.userId,
      workspaceId: account.workspaceId,
      familyId: id('rtf'),
      tokenId: id('rt'),
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
    });
    return this.#pair(account.userId, account.workspaceId, refreshToken, refreshExpiresAt);
  }

  /** Rotation with reuse detection (ADR-0004 §4.3): a replayed token revokes its family. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const next = newRefreshToken();
    const nextExpiresAt = new Date(this.#now() + REFRESH_TOKEN_TTL_MS);
    const result = await this.#db.rotateRefreshToken({
      tokenHash: hashRefreshToken(refreshToken),
      newTokenId: id('rt'),
      newTokenHash: hashRefreshToken(next),
      newExpiresAt: nextExpiresAt,
    });
    switch (result.status) {
      case 'ok':
        if (result.userId === null || result.workspaceId === null) {
          throw new AuthError('refresh_invalid');
        }
        return this.#pair(result.userId, result.workspaceId, next, nextExpiresAt);
      case 'reused':
        throw new AuthError('refresh_reused');
      case 'revoked':
        throw new AuthError('refresh_revoked');
      case 'expired':
        throw new AuthError('refresh_expired');
      case 'unknown':
        throw new AuthError('refresh_invalid');
    }
  }

  /** Logout revokes the family; an unknown token is not an error (logout is idempotent). */
  async logout(refreshToken: string): Promise<void> {
    await this.#db.revokeRefreshFamily(hashRefreshToken(refreshToken), 'logout');
  }

  async #pair(
    userId: string,
    workspaceId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<TokenPair> {
    const access = await this.#tokens.issueAccessToken({ userId, workspaceId, scope: 'user' });
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      refreshExpiresAt,
      userId,
      workspaceId,
    };
  }
}
