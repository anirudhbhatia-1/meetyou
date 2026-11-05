import { createTestDb } from '@meetyou/db/testing';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthError } from './errors.ts';
import { exchangeGoogleCode, GOOGLE_TOKEN_ENDPOINT, type GoogleConfig } from './google.ts';
import { generateSigningJwk, loadKeyRing } from './keys.ts';
import { authenticate } from './middleware.ts';
import { AuthService, hashRefreshToken } from './service.ts';
import { TokenService } from './tokens.ts';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const REDIRECT = 'https://abcdefghijklmnop.chromiumapp.org/oauth2';
const google: GoogleConfig = {
  clientId: CLIENT_ID,
  clientSecret: 'test-secret',
  allowedRedirectUris: [REDIRECT],
};

/** A stand-in for Google: our own RS256 key, published as Google's JWKS would be. */
let googleKey: CryptoKey;
let googleKeys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  googleKey = pair.privateKey;
  googleKeys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'g1', alg: 'RS256' }],
  });
});

async function idToken(
  claims: Record<string, unknown>,
  options: { aud?: string; iss?: string } = {},
) {
  return new SignJWT({
    email: 'asha@example.com',
    email_verified: true,
    name: 'Asha Rao',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
    .setIssuer(options.iss ?? 'https://accounts.google.com')
    .setAudience(options.aud ?? CLIENT_ID)
    .setSubject(typeof claims.sub === 'string' ? claims.sub : 'google-sub-1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(googleKey);
}

function googleFetch(token: Promise<string> | string, requests: URLSearchParams[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(GOOGLE_TOKEN_ENDPOINT);
    requests.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify({ id_token: await token, access_token: 'unused' }));
  }) as typeof fetch;
}

const code = {
  code: 'auth-code',
  codeVerifier: 'verifier-43-chars-long-xxxxxxxxxxxxxxxxxxxx',
  redirectUri: REDIRECT,
};

async function tokenService(now?: () => number) {
  return new TokenService(await loadKeyRing([await generateSigningJwk('k1')]), now);
}

describe('TokenService (ADR-0004 §4.2)', () => {
  it('issues and verifies access tokens', async () => {
    const tokens = await tokenService();
    const { token, expiresAt } = await tokens.issueAccessToken({
      userId: 'usr_1',
      workspaceId: 'ws_1',
      scope: 'user',
    });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(await tokens.verifyAccessToken(token)).toEqual({
      userId: 'usr_1',
      workspaceId: 'ws_1',
      scope: 'user',
    });
  });

  it('rejects expired, tampered, foreign-key and wrong-audience tokens', async () => {
    let now = Date.now();
    const tokens = await tokenService(() => now);
    const access = (await tokens.issueAccessToken({ userId: 'u', workspaceId: 'w', scope: 'user' }))
      .token;
    const stream = (await tokens.issueStreamToken({ sessionId: 'ses_1', lanes: ['me', 'them'] }))
      .token;

    await expect(tokens.verifyAccessToken(stream)).rejects.toMatchObject({ code: 'invalid_token' });
    await expect(tokens.verifyStreamToken(access)).rejects.toMatchObject({ code: 'invalid_token' });
    const [h, p, s] = access.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'other', wsid: 'w2', scope: 'user', aud: 'api', iss: 'minutes-api', exp: 9e9 })).toString('base64url')}.${s}`;
    expect(p).toBeDefined();
    await expect(tokens.verifyAccessToken(forged)).rejects.toMatchObject({ code: 'invalid_token' });
    const otherKeys = await tokenService();
    await expect(otherKeys.verifyAccessToken(access)).rejects.toMatchObject({
      code: 'invalid_token',
    });

    now += 16 * 60 * 1000;
    await expect(tokens.verifyAccessToken(access)).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('keeps verifying tokens signed with the previous key after a rotation', async () => {
    const oldJwk = await generateSigningJwk('2026-08');
    const before = new TokenService(await loadKeyRing([oldJwk]));
    const { token } = await before.issueAccessToken({
      userId: 'u',
      workspaceId: 'w',
      scope: 'user',
    });
    const after = new TokenService(
      await loadKeyRing([await generateSigningJwk('2026-11'), oldJwk]),
    );
    expect((await after.verifyAccessToken(token)).userId).toBe('u');
    expect(after.jwks.keys.map((k) => k.kid)).toEqual(['2026-11', '2026-08']);
    expect(after.jwks.keys.every((k) => k.d === undefined)).toBe(true);
  });

  it('issues single-use stream tokens bound to a session (ADR-0004 §4.4)', async () => {
    const tokens = await tokenService();
    const a = await tokens.issueStreamToken({ sessionId: 'ses_1', lanes: ['me', 'them'] });
    const b = await tokens.issueStreamToken({ sessionId: 'ses_1', lanes: ['them'] });
    const claims = await tokens.verifyStreamToken(a.token);
    expect(claims).toMatchObject({ sessionId: 'ses_1', lanes: ['me', 'them'] });
    expect(claims.jti).not.toBe((await tokens.verifyStreamToken(b.token)).jti);
  });
});

describe('exchangeGoogleCode', () => {
  it('sends the PKCE verifier and secret, and returns the verified profile', async () => {
    const requests: URLSearchParams[] = [];
    const profile = await exchangeGoogleCode(code, google, {
      fetch: googleFetch(idToken({}), requests),
      keys: googleKeys,
    });
    expect(profile).toEqual({
      googleSub: 'google-sub-1',
      email: 'asha@example.com',
      displayName: 'Asha Rao',
    });
    expect(Object.fromEntries(requests[0] ?? [])).toEqual({
      code: 'auth-code',
      client_id: CLIENT_ID,
      client_secret: 'test-secret',
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code_verifier: code.codeVerifier,
    });
  });

  it('refuses tokens for another client, another issuer, or an unverified email', async () => {
    const deps = (t: Promise<string>) => ({ fetch: googleFetch(t), keys: googleKeys });
    await expect(
      exchangeGoogleCode(code, google, deps(idToken({}, { aud: 'someone-else' }))),
    ).rejects.toMatchObject({ code: 'google_token_invalid' });
    await expect(
      exchangeGoogleCode(code, google, deps(idToken({}, { iss: 'https://evil.example' }))),
    ).rejects.toMatchObject({ code: 'google_token_invalid' });
    await expect(
      exchangeGoogleCode(code, google, deps(idToken({ email_verified: false }))),
    ).rejects.toMatchObject({ code: 'email_not_verified', status: 403 });
  });

  it('refuses a redirect URI we did not register, without calling Google', async () => {
    let called = false;
    const fetchSpy = (() => {
      called = true;
      return Promise.reject(new Error('should not be called'));
    }) as typeof fetch;
    await expect(
      exchangeGoogleCode({ ...code, redirectUri: 'https://evil.example/cb' }, google, {
        fetch: fetchSpy,
      }),
    ).rejects.toMatchObject({ code: 'redirect_uri_not_allowed' });
    expect(called).toBe(false);
  });
});

describe('AuthService with the database', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let service: AuthService;
  let tokens: TokenService;

  beforeEach(async () => {
    env = await createTestDb();
    tokens = await tokenService();
    service = new AuthService({
      db: env.db,
      tokens,
      google,
      googleDeps: { fetch: googleFetch(idToken({})), keys: googleKeys },
    });
  });

  afterEach(async () => {
    await env.close();
  });

  it('signs in, authenticates requests, refreshes, and detects a replayed refresh token', async () => {
    const first = await service.signInWithGoogle(code);
    const caller = await authenticate(`Bearer ${first.accessToken}`, tokens);
    expect(caller).toEqual({ userId: first.userId, workspaceId: first.workspaceId, scope: 'user' });

    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.workspaceId).toBe(first.workspaceId);

    // A stolen copy of the first token comes back after the 30 s retry grace: the family dies and
    // the real holder signs in again.
    await env.pg.exec(`RESET ROLE;
      UPDATE refresh_tokens SET used_at = used_at - interval '1 minute' WHERE used_at IS NOT NULL;
      SET ROLE meetyou_app;`);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'refresh_reused',
    });
    await expect(service.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'refresh_revoked',
    });
  });

  it('signing in again keeps the same user and workspace; logout ends the family', async () => {
    const first = await service.signInWithGoogle(code);
    const again = await service.signInWithGoogle(code);
    expect([again.userId, again.workspaceId]).toEqual([first.userId, first.workspaceId]);
    await service.logout(again.refreshToken);
    await expect(service.refresh(again.refreshToken)).rejects.toMatchObject({
      code: 'refresh_revoked',
    });
    // The first sign-in's family is separate (another device) and still works.
    expect((await service.refresh(first.refreshToken)).userId).toBe(first.userId);
    await service.logout('not-a-real-token');
  });

  it('stores only the hash of refresh tokens', async () => {
    const pair = await service.signInWithGoogle(code);
    expect(hashRefreshToken(pair.refreshToken)).toMatch(/^[0-9a-f]{64}$/);
    await env.pg.query(`select set_config('app.refresh_hash', $1, false)`, [
      hashRefreshToken(pair.refreshToken),
    ]);
    const { rows } = await env.pg.query<{ token_hash: string }>(
      'SELECT token_hash FROM refresh_tokens',
    );
    expect(rows.map((r) => r.token_hash)).toEqual([hashRefreshToken(pair.refreshToken)]);
    expect(JSON.stringify(rows)).not.toContain(pair.refreshToken);
  });
});

describe('authenticate', () => {
  it('requires a bearer access token', async () => {
    const tokens = await tokenService();
    await expect(authenticate(undefined, tokens)).rejects.toBeInstanceOf(AuthError);
    await expect(authenticate('Basic abc', tokens)).rejects.toMatchObject({
      code: 'missing_token',
    });
    await expect(authenticate('Bearer a.b.c', tokens)).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });
});
