import { randomBytes } from 'node:crypto';

/**
 * Local-dev stream tokens: random, bound to one session, single use, 10 minutes to connect
 * (ADR-0004 §4.4 rules). TODO(S2): JWT (`aud=gateway`, `sid`, `jti`, `exp`) signed by the API with
 * `jose`, used-JTI cache in Redis.
 */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

export class DevTokenIssuer {
  readonly #tokens = new Map<string, { sessionId: string; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(sessionId: string): string {
    const token = randomBytes(24).toString('base64url');
    this.#tokens.set(token, { sessionId, expiresAt: this.#now() + TOKEN_TTL_MS });
    return token;
  }

  /** Returns the session the token was issued for, and consumes it; null if unknown or expired. */
  consume(token: string): string | null {
    const entry = this.#tokens.get(token);
    this.#tokens.delete(token);
    if (entry === undefined || entry.expiresAt < this.#now()) return null;
    return entry.sessionId;
  }
}
