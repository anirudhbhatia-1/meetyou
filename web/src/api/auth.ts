/**
 * Web sign-in (ADR-0004 §4.5): Google authorization code + PKCE with a redirect to
 * `/auth/callback`. The API keeps the refresh token in an HttpOnly cookie on `/v1/auth` (the web
 * server proxies `/v1` on the same origin), so the page only ever holds the short-lived access token,
 * in memory. Every auth call sends `X-Minutes-Client: web`; a cross-site form cannot set it.
 */

export const CALLBACK_PATH = '/auth/callback';
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const PENDING_KEY = 'minutes.signin';
const WEB_HEADERS = { 'x-minutes-client': 'web' };
/** Refresh this long before the access token expires. */
const EARLY_MS = 30_000;

export class SignedOutError extends Error {
  constructor() {
    super('signed out');
  }
}

interface Pending {
  state: string;
  verifier: string;
  /** Hash route to return to after sign-in. */
  returnTo: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** RFC 7636 S256 challenge. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function callbackUri(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

interface TokenBody {
  accessToken: string;
  accessExpiresAt: string;
}

function isTokenBody(value: unknown): value is TokenBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.accessToken === 'string' && typeof v.accessExpiresAt === 'string';
}

export class WebAuth {
  #token: string | null = null;
  #expiresAt = 0;
  #refreshing: Promise<boolean> | null = null;
  readonly #fetch: typeof fetch;
  readonly #onSignedOut: () => void;

  constructor(options: { fetch?: typeof fetch; onSignedOut?: () => void } = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#onSignedOut = options.onSignedOut ?? (() => undefined);
  }

  /** Sends the browser to Google; the callback page finishes with `completeSignIn`. */
  async startSignIn(clientId: string, returnTo: string): Promise<void> {
    const pending: Pending = { state: randomString(), verifier: randomString(), returnTo };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    const url = new URL(GOOGLE_AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUri(window.location.origin),
      response_type: 'code',
      // FR-ONB-02: name and email only.
      scope: 'openid email profile',
      code_challenge: await pkceChallenge(pending.verifier),
      code_challenge_method: 'S256',
      state: pending.state,
      prompt: 'select_account',
    }).toString();
    window.location.assign(url.toString());
  }

  /** Exchanges the code from the callback URL; returns the hash route to go back to. */
  async completeSignIn(callback: URL): Promise<string> {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const pending = raw === null ? null : (JSON.parse(raw) as Pending);
    const code = callback.searchParams.get('code');
    if (pending === null || code === null || callback.searchParams.get('state') !== pending.state) {
      throw new Error('sign-in did not finish');
    }
    const res = await this.#fetch('/v1/auth/google', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...WEB_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: pending.verifier,
        redirectUri: callbackUri(callback.origin),
      }),
    });
    const body: unknown = res.ok ? await res.json() : null;
    if (!isTokenBody(body)) throw new Error(`sign-in failed (${res.status})`);
    this.#set(body);
    return pending.returnTo;
  }

  /** True when the refresh cookie gave a new access token. One refresh at a time. */
  refresh(): Promise<boolean> {
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<boolean> {
    const res = await this.#fetch('/v1/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: WEB_HEADERS,
    });
    if (res.status === 401 || res.status === 400) {
      this.#token = null;
      return false;
    }
    const body: unknown = res.ok ? await res.json() : null;
    if (!isTokenBody(body)) throw new Error(`refresh failed (${res.status})`);
    this.#set(body);
    return true;
  }

  async signOut(): Promise<void> {
    this.#token = null;
    await this.#fetch('/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: WEB_HEADERS,
    });
  }

  /** `fetch` with the access token; refreshes before expiry and once more on a 401. */
  async authorized(path: string, init: RequestInit = {}): Promise<Response> {
    if (this.#token === null || Date.now() > this.#expiresAt - EARLY_MS) {
      if (!(await this.refresh())) this.#signedOut();
    }
    const send = () =>
      this.#fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: { ...init.headers, authorization: `Bearer ${this.#token ?? ''}` },
      });
    const res = await send();
    if (res.status !== 401) return res;
    if (!(await this.refresh())) this.#signedOut();
    return send();
  }

  /** The refresh cookie expired or was revoked: the app shows sign-in again. */
  #signedOut(): never {
    this.#onSignedOut();
    throw new SignedOutError();
  }

  #set(body: TokenBody): void {
    this.#token = body.accessToken;
    this.#expiresAt = Date.parse(body.accessExpiresAt);
  }
}
