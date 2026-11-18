import { AuthError } from './errors.ts';
import {
  GOOGLE_TOKEN_ENDPOINT,
  verifyGoogleIdToken,
  type GoogleConfig,
  type GoogleDeps,
  type GoogleProfile,
} from './google.ts';

/**
 * Google OAuth for calendar access (ADR-0013), verified against Google's docs on 2026-11-18:
 * developers.google.com/identity/protocols/oauth2/web-server (token exchange, refresh, revoke,
 * granular consent) and .../oauth2 ("Refresh token expiration", `invalid_grant`). The web app runs
 * the authorization request with PKCE (`access_type=offline`, `prompt=consent`,
 * `include_granted_scopes=true`); the API exchanges the code with the client secret, as sign-in does.
 */
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const TIMEOUT_MS = 10_000;

export interface CalendarGrant {
  profile: GoogleProfile;
  refreshToken: string;
  /** Space-separated scopes the user actually granted (granular consent can drop some). */
  scope: string;
}

/** Google refused the stored grant (revoked, expired, 7-day Testing limit): reconnect needed. */
export class CalendarAccessRevokedError extends Error {
  constructor() {
    super('calendar access revoked');
    this.name = 'CalendarAccessRevokedError';
  }
}

export async function exchangeCalendarCode(
  input: { code: string; codeVerifier: string; redirectUri: string; requiredScope: string },
  config: GoogleConfig,
  deps: GoogleDeps = {},
): Promise<CalendarGrant> {
  if (!config.allowedRedirectUris.includes(input.redirectUri)) {
    throw new AuthError('redirect_uri_not_allowed', 403);
  }
  const doFetch = deps.fetch ?? fetch;
  let body: { id_token?: unknown; refresh_token?: unknown; scope?: unknown };
  try {
    const response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new AuthError('google_exchange_failed');
    body = (await response.json()) as typeof body;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('google_exchange_failed');
  }
  if (typeof body.id_token !== 'string') throw new AuthError('google_exchange_failed');
  const profile = await verifyGoogleIdToken(body.id_token, config, deps);
  const scope = typeof body.scope === 'string' ? body.scope : '';
  // Granular consent: the user may untick the calendar box; then there is nothing to store.
  if (!scope.split(' ').includes(input.requiredScope)) throw new AuthError('scope_denied', 403);
  // Only sent with access_type=offline on a fresh consent (prompt=consent).
  if (typeof body.refresh_token !== 'string' || body.refresh_token === '') {
    throw new AuthError('google_exchange_failed');
  }
  return { profile, refreshToken: body.refresh_token, scope };
}

/** A short-lived access token for one sync. `invalid_grant` means the grant is gone. */
export async function refreshCalendarAccess(
  refreshToken: string,
  config: Pick<GoogleConfig, 'clientId' | 'clientSecret'>,
  deps: Pick<GoogleDeps, 'fetch'> = {},
): Promise<string> {
  const response = await (deps.fetch ?? fetch)(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    if (body.error === 'invalid_grant') throw new CalendarAccessRevokedError();
    throw new Error(`google token refresh failed (${response.status})`);
  }
  if (typeof body.access_token !== 'string') throw new Error('google token refresh: no token');
  return body.access_token;
}

/** Best effort on disconnect: revoking a refresh token removes every scope the user granted us. */
export async function revokeGoogleToken(
  token: string,
  deps: Pick<GoogleDeps, 'fetch'> = {},
): Promise<boolean> {
  try {
    const response = await (deps.fetch ?? fetch)(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
