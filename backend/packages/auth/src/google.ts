import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { AuthError } from './errors.ts';

/**
 * Google OpenID Connect, verified against Google's docs (2026-11-05):
 * developers.google.com/identity/openid-connect/openid-connect (token endpoint, JWKS, issuers,
 * aud/exp checks) and .../protocols/oauth2/native-app (PKCE `code_verifier` at the token endpoint).
 * [Verify] in ADR-0004 check 2: a Web application client accepts the `chromiumapp.org` redirect
 * with PKCE plus the client secret.
 */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const EXCHANGE_TIMEOUT_MS = 10_000;

export interface GoogleConfig {
  clientId: string;
  /** From Secret Manager; never logged. */
  clientSecret: string;
  /**
   * Exact redirect URIs we accept: the extension's `https://<id>.chromiumapp.org/oauth2` per build
   * (ADR-0004 §4.1) and later the web app's. Anything else is refused before calling Google.
   */
  allowedRedirectUris: readonly string[];
}

export interface GoogleProfile {
  googleSub: string;
  email: string;
  displayName: string;
}

export interface GoogleDeps {
  fetch?: typeof fetch;
  /** Google's signing keys; injectable for tests. */
  keys?: JWTVerifyGetKey;
  now?: () => number;
}

let googleKeys: JWTVerifyGetKey | null = null;

/**
 * Steps 4–5 of ADR-0004 §4.1: exchanges the authorization code (with the PKCE verifier) and
 * verifies the returned ID token: signature, issuer, audience, expiry, and a verified email.
 */
export async function exchangeGoogleCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  config: GoogleConfig,
  deps: GoogleDeps = {},
): Promise<GoogleProfile> {
  if (!config.allowedRedirectUris.includes(input.redirectUri)) {
    throw new AuthError('redirect_uri_not_allowed', 403);
  }
  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('google_exchange_failed');
  }
  if (!response.ok) throw new AuthError('google_exchange_failed');
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new AuthError('google_exchange_failed');

  let payload: Record<string, unknown>;
  try {
    googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
    const verified = await jwtVerify(body.id_token, deps.keys ?? googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience: config.clientId,
      algorithms: ['RS256'],
      currentDate: new Date((deps.now ?? Date.now)()),
    });
    payload = verified.payload;
  } catch {
    throw new AuthError('google_token_invalid');
  }

  const { sub, email, email_verified: emailVerified, name } = payload;
  if (typeof sub !== 'string' || sub === '' || typeof email !== 'string') {
    throw new AuthError('google_token_invalid');
  }
  // Google lists email_verified as informational; we require it because the email names the account.
  if (emailVerified !== true) throw new AuthError('email_not_verified', 403);
  const displayName = typeof name === 'string' && name.trim() !== '' ? name.trim() : email;
  return { googleSub: sub, email, displayName: displayName.slice(0, 200) };
}
