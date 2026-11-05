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

/** ADR-0011 §3.3 / S2-14: signed fragment URLs expire after 15 minutes. */
export const VIDEO_URL_TTL_MS = 15 * 60 * 1000;

export interface VideoUpload {
  sessionId: string;
  partId: string;
  index: number;
  contentType: string;
}

/**
 * Local-dev stand-in for Cloud Storage signed PUT URLs: a random token per fragment, reusable until
 * it expires so a retried PUT overwrites the same object. TODO(S2-14): V4 signed URLs with the
 * content type and size bound in the signature.
 */
export class DevVideoSigner {
  readonly #uploads = new Map<string, VideoUpload & { expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  sign(upload: VideoUpload): { token: string; expiresAt: number } {
    const now = this.#now();
    for (const [token, entry] of this.#uploads) {
      if (entry.expiresAt < now) this.#uploads.delete(token);
    }
    const token = randomBytes(24).toString('base64url');
    const expiresAt = now + VIDEO_URL_TTL_MS;
    this.#uploads.set(token, { ...upload, expiresAt });
    return { token, expiresAt };
  }

  /** The upload a token allows; null if unknown or expired. */
  resolve(token: string): VideoUpload | null {
    const entry = this.#uploads.get(token);
    if (entry === undefined || entry.expiresAt < this.#now()) return null;
    return {
      sessionId: entry.sessionId,
      partId: entry.partId,
      index: entry.index,
      contentType: entry.contentType,
    };
  }
}
