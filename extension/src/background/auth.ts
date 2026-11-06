import { MeResponse, TokenResponse } from '@meetyou/contracts';

/**
 * Extension sign-in (ADR-0004 §4.1–4.3): Google authorization code + PKCE through
 * `chrome.identity.launchWebAuthFlow`, exchanged by the API for its own tokens. The refresh token
 * lives in `chrome.storage.local` (ADR-0004 §5 risk note); the access token only in
 * `chrome.storage.session` (memory, cleared with the browser session) so a restarted service worker
 * does not refresh needlessly. Only this module refreshes: rotation reuse revokes the family.
 */

export const ACCOUNT_KEY = 'minutes.account';
const REFRESH_KEY = 'minutes.refresh';
const ACCESS_KEY = 'minutes.access';
/** Refresh this long before the access token expires. */
const EARLY_MS = 60_000;
const TIMEOUT_MS = 10_000;

/** What the side panel shows; never the tokens. */
export interface Account {
  email: string;
}

export function parseAccount(items: Record<string, unknown>): Account | null {
  const value = items[ACCOUNT_KEY];
  if (typeof value !== 'object' || value === null) return null;
  const email = (value as Record<string, unknown>).email;
  return typeof email === 'string' ? { email } : null;
}

interface StoredAccess {
  token: string;
  expiresAt: number;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const randomString = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

export interface AuthOptions {
  apiUrl: string;
  googleClientId: string;
}

export class ExtensionAuth {
  readonly #options: AuthOptions;
  #refreshing: Promise<string | null> | null = null;

  constructor(options: AuthOptions) {
    this.#options = options;
  }

  /** Interactive Google sign-in; the panel's click is the user gesture Chrome asks for. */
  async signIn(): Promise<Account> {
    const redirectUri = chrome.identity.getRedirectURL('oauth2');
    const verifier = randomString();
    const state = randomString();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.#options.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      // FR-ONB-02: name and email only.
      scope: 'openid email profile',
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    }).toString();
    const result = await chrome.identity.launchWebAuthFlow({
      url: url.toString(),
      interactive: true,
    });
    if (result === undefined) throw new SignInError('sign-in cancelled');
    const back = new URL(result);
    const code = back.searchParams.get('code');
    if (code === null || back.searchParams.get('state') !== state) {
      throw new SignInError('sign-in did not finish');
    }
    const tokens = TokenResponse.parse(
      await this.#post('/v1/auth/google', { code, codeVerifier: verifier, redirectUri }),
    );
    await this.#save(tokens);
    const account = { email: await this.#email(tokens.accessToken) };
    await chrome.storage.local.set({ [ACCOUNT_KEY]: account });
    return account;
  }

  /** A valid access token, refreshed when needed; null when signed out. */
  async accessToken(): Promise<string | null> {
    const stored = (await chrome.storage.session.get(ACCESS_KEY))[ACCESS_KEY] as
      StoredAccess | undefined;
    if (stored !== undefined && Date.now() < stored.expiresAt - EARLY_MS) return stored.token;
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async signOut(): Promise<void> {
    const refreshToken = (await chrome.storage.local.get(REFRESH_KEY))[REFRESH_KEY];
    await this.#clear();
    if (typeof refreshToken === 'string') {
      // Best effort: the token is already gone from this browser.
      await this.#post('/v1/auth/logout', { refreshToken }).catch(() => undefined);
    }
  }

  async #refresh(): Promise<string | null> {
    const refreshToken = (await chrome.storage.local.get(REFRESH_KEY))[REFRESH_KEY];
    if (typeof refreshToken !== 'string') return null;
    let body: unknown;
    try {
      body = await this.#post('/v1/auth/refresh', { refreshToken });
    } catch (error: unknown) {
      // 400/401: expired, revoked or reused — sign in again. Anything else may pass.
      if (error instanceof HttpError && (error.status === 400 || error.status === 401)) {
        await this.#clear();
        return null;
      }
      throw error;
    }
    const tokens = TokenResponse.parse(body);
    await this.#save(tokens);
    return tokens.accessToken;
  }

  async #email(accessToken: string): Promise<string> {
    const response = await fetch(new URL('/v1/me', this.#options.apiUrl).href, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new HttpError('/v1/me', response.status);
    return MeResponse.parse(await response.json()).email;
  }

  async #save(tokens: TokenResponse): Promise<void> {
    await chrome.storage.local.set({ [REFRESH_KEY]: tokens.refreshToken });
    const access: StoredAccess = {
      token: tokens.accessToken,
      expiresAt: Date.parse(tokens.accessExpiresAt),
    };
    await chrome.storage.session.set({ [ACCESS_KEY]: access });
  }

  async #clear(): Promise<void> {
    await chrome.storage.local.remove([REFRESH_KEY, ACCOUNT_KEY]);
    await chrome.storage.session.remove(ACCESS_KEY);
  }

  async #post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.#options.apiUrl).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new HttpError(path, response.status);
    return response.status === 204 ? null : response.json();
  }
}

export class HttpError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`${path} failed (HTTP ${status})`);
    this.name = 'HttpError';
    this.status = status;
  }
}
