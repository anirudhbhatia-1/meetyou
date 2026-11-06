import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Web app sign-in (ADR-0004 §4.5): the refresh token lives in an `HttpOnly; Secure; SameSite=Lax`
 * cookie scoped to the auth routes, the access token only in the page's memory. The web app is
 * served from the same origin as the API (its Cloud Run service forwards `/v1/*`), so the cookie
 * is first-party.
 *
 * CSRF: only the refresh and logout routes read the cookie. They require the `X-Minutes-Client:
 * web` header, which a cross-site form cannot send and a cross-site fetch cannot send without a
 * CORS preflight that the API refuses for other origins; SameSite=Lax also keeps the cookie off
 * cross-site POSTs. (This stands in for the separate CSRF token ADR-0004 §4.5 mentions.)
 */
export const WEB_CLIENT_HEADER = 'x-minutes-client';
export const REFRESH_COOKIE = 'minutes_rt';
const COOKIE_PATH = '/v1/auth';

export function isWebClient(request: FastifyRequest): boolean {
  return request.headers[WEB_CLIENT_HEADER] === 'web';
}

/** The refresh cookie's value, if the request carries it. */
export function readRefreshCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) {
      const value = rest.join('=');
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.header(
    'set-cookie',
    `${REFRESH_COOKIE}=${token}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
  );
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.header(
    'set-cookie',
    `${REFRESH_COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
}
