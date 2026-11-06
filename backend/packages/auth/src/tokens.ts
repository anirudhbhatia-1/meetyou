import { randomUUID } from 'node:crypto';

import {
  createLocalJWKSet,
  errors,
  jwtVerify,
  SignJWT,
  type JSONWebKeySet,
  type JWTPayload,
} from 'jose';

import { AuthError } from './errors.ts';
import { SIGNING_ALG, type KeyRing } from './keys.ts';

/** ADR-0004 §4.2 lifetimes. */
export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const STREAM_TOKEN_TTL_S = 10 * 60;

export const ISSUER = 'minutes-api';
export const ACCESS_AUDIENCE = 'api';
export const STREAM_AUDIENCE = 'gateway';
/** Clock skew tolerated between Cloud Run instances and clients. */
const CLOCK_TOLERANCE_S = 30;

export interface AccessClaims {
  userId: string;
  workspaceId: string;
  scope: 'user';
}

export type Lane = 'me' | 'them';

export interface StreamClaims {
  sessionId: string;
  /** The session's workspace: the gateway scopes its database writes (RLS) to it. */
  workspaceId: string;
  lanes: Lane[];
  /** Single use at connect (ADR-0004 §4.4); the gateway remembers spent IDs until `expiresAt`. */
  jti: string;
  expiresAt: Date;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Our JWTs (ADR-0004 §4.2): ES256 with a `kid` header, verified against our JWKS so the previous
 * key keeps working during rotation. Access tokens (`aud=api`) and stream tokens (`aud=gateway`)
 * cannot stand in for each other.
 */
export class TokenService {
  readonly #keys: KeyRing;
  readonly #verifyKeys: ReturnType<typeof createLocalJWKSet>;
  readonly #now: () => number;

  constructor(keys: KeyRing, now: () => number = Date.now) {
    this.#keys = keys;
    this.#verifyKeys = createLocalJWKSet(keys.jwks);
    this.#now = now;
  }

  /** Public keys for `GET /.well-known/jwks.json`. */
  get jwks(): KeyRing['jwks'] {
    return this.#keys.jwks;
  }

  async issueAccessToken(claims: AccessClaims): Promise<IssuedToken> {
    return this.#sign(
      { wsid: claims.workspaceId, scope: claims.scope },
      claims.userId,
      ACCESS_AUDIENCE,
      ACCESS_TOKEN_TTL_S,
    );
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    const payload = await this.#verify(token, ACCESS_AUDIENCE);
    if (typeof payload.sub !== 'string' || typeof payload.wsid !== 'string') {
      throw new AuthError('invalid_token');
    }
    if (payload.scope !== 'user') throw new AuthError('invalid_token');
    return { userId: payload.sub, workspaceId: payload.wsid, scope: 'user' };
  }

  async issueStreamToken(input: {
    sessionId: string;
    workspaceId: string;
    lanes: Lane[];
  }): Promise<IssuedToken> {
    return this.#sign(
      { sid: input.sessionId, wsid: input.workspaceId, lanes: input.lanes },
      undefined,
      STREAM_AUDIENCE,
      STREAM_TOKEN_TTL_S,
      randomUUID(),
    );
  }

  /** Checks signature, audience and expiry; the caller checks `sessionId` and spends `jti`. */
  async verifyStreamToken(token: string): Promise<StreamClaims> {
    return streamClaims(await this.#verify(token, STREAM_AUDIENCE));
  }

  async #sign(
    claims: JWTPayload,
    subject: string | undefined,
    audience: string,
    ttlSeconds: number,
    jti?: string,
  ): Promise<IssuedToken> {
    const now = Math.floor(this.#now() / 1000);
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: SIGNING_ALG, kid: this.#keys.current.kid, typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds);
    if (subject !== undefined) jwt.setSubject(subject);
    if (jti !== undefined) jwt.setJti(jti);
    return {
      token: await jwt.sign(this.#keys.current.privateKey),
      expiresAt: new Date((now + ttlSeconds) * 1000),
    };
  }

  async #verify(token: string, audience: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.#verifyKeys, {
        issuer: ISSUER,
        audience,
        algorithms: [SIGNING_ALG],
        // A token without `exp` would never expire; ours always carry it.
        requiredClaims: ['exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_S,
        currentDate: new Date(this.#now()),
      });
      return payload;
    } catch (error: unknown) {
      if (error instanceof errors.JWTExpired) throw new AuthError('expired_token');
      throw new AuthError('invalid_token');
    }
  }
}

function streamClaims(payload: JWTPayload): StreamClaims {
  const lanes = payload.lanes;
  if (
    typeof payload.sid !== 'string' ||
    typeof payload.wsid !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.exp !== 'number' ||
    !Array.isArray(lanes) ||
    !lanes.every((l) => l === 'me' || l === 'them')
  ) {
    throw new AuthError('invalid_token');
  }
  return {
    sessionId: payload.sid,
    workspaceId: payload.wsid,
    lanes: lanes as Lane[],
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
  };
}

/** What the gateway needs from stream tokens: verification only. */
export interface StreamTokenVerification {
  verifyStreamToken(token: string): Promise<StreamClaims>;
}

/**
 * Stream-token verification from **public** keys only (the API's JWKS), so the gateway never holds
 * a signing key (ADR-0004 §4.4). Same checks as TokenService.
 */
export class StreamTokenVerifier implements StreamTokenVerification {
  readonly #keys: ReturnType<typeof createLocalJWKSet>;
  readonly #now: () => number;

  constructor(jwks: JSONWebKeySet, now: () => number = Date.now) {
    if (jwks.keys.some((k) => 'd' in k)) throw new Error('JWKS must hold public keys only');
    this.#keys = createLocalJWKSet(jwks);
    this.#now = now;
  }

  async verifyStreamToken(token: string): Promise<StreamClaims> {
    try {
      const { payload } = await jwtVerify(token, this.#keys, {
        issuer: ISSUER,
        audience: STREAM_AUDIENCE,
        algorithms: [SIGNING_ALG],
        requiredClaims: ['exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_S,
        currentDate: new Date(this.#now()),
      });
      return streamClaims(payload);
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error;
      if (error instanceof errors.JWTExpired) throw new AuthError('expired_token');
      throw new AuthError('invalid_token');
    }
  }
}
