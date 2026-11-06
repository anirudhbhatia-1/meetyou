import { Redis } from 'ioredis';
import { z } from 'zod';

/**
 * Shared session state (S2-04, ARCHITECTURE §6.2): what any gateway instance needs to take over a
 * session after the instance that held it died. Durable audio itself is in the chunk store; this
 * holds the rest (workspace, meeting, codec, ended, STT health, batch-needed) and the spent stream
 * token IDs (ADR-0004 §4.4 single use). Redis in staging/production, memory in local dev and tests.
 */
export const SessionRecord = z.object({
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  meetingId: z.string().min(1),
  codec: z.enum(['pcm16', 'opus']).nullable(),
  ended: z.boolean(),
  /** Epoch ms when the recording ended; video fragments may still be signed for a grace period. */
  endedAt: z.number().int().nullable(),
  /** STT health as last reported to the client (ws-protocol `health`). */
  stt: z.enum(['ok', 'degraded', 'down']),
  /** Live STT missed audio: the batch pass must transcribe the whole meeting (§6.3). */
  needsBatch: z.boolean(),
  /** Workspace glossary for provider key terms, read once at session start. */
  keyterms: z.array(z.string()),
  createdAt: z.number().int(),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

export type SessionPatch = Partial<
  Pick<SessionRecord, 'codec' | 'ended' | 'endedAt' | 'stt' | 'needsBatch'>
>;

export interface SessionRegistry {
  create(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  update(sessionId: string, patch: SessionPatch): Promise<void>;
  /** Marks a stream token ID spent; false when it was spent before (a replay). */
  spendTokenId(jti: string, ttlMs: number): Promise<boolean>;
  close(): Promise<void>;
}

/** A live session's record outlives the meeting by this much (late video uploads, §ENDED TTL). */
export const SESSION_RECORD_TTL_MS = 48 * 60 * 60 * 1000;

export class MemorySessionRegistry implements SessionRegistry {
  readonly #records = new Map<string, SessionRecord>();
  readonly #spent = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  create(record: SessionRecord): Promise<void> {
    this.#records.set(record.sessionId, { ...record });
    return Promise.resolve();
  }

  get(sessionId: string): Promise<SessionRecord | null> {
    const record = this.#records.get(sessionId);
    return Promise.resolve(record === undefined ? null : { ...record });
  }

  update(sessionId: string, patch: SessionPatch): Promise<void> {
    const record = this.#records.get(sessionId);
    if (record !== undefined) this.#records.set(sessionId, { ...record, ...patch });
    return Promise.resolve();
  }

  spendTokenId(jti: string, ttlMs: number): Promise<boolean> {
    const now = this.#now();
    for (const [id, expiresAt] of this.#spent) if (expiresAt <= now) this.#spent.delete(id);
    if (this.#spent.has(jti)) return Promise.resolve(false);
    this.#spent.set(jti, now + ttlMs);
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Redis (Memorystore in staging). A record is a hash, one field per value, so a patch from one
 * instance (`HSET` of its fields) never overwrites fields another instance just changed.
 */
export class RedisSessionRegistry implements SessionRegistry {
  readonly #redis: Redis;
  readonly #prefix: string;

  constructor(url: string, prefix = 'minutes:') {
    // Commands fail fast instead of queueing forever while Redis is unreachable.
    this.#redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    this.#prefix = prefix;
  }

  /** Startup check: the gateway refuses to serve without its shared state. */
  async ready(): Promise<void> {
    await this.#redis.connect();
  }

  #key(sessionId: string): string {
    return `${this.#prefix}session:${sessionId}`;
  }

  async create(record: SessionRecord): Promise<void> {
    const key = this.#key(record.sessionId);
    await this.#redis
      .multi()
      .del(key)
      .hset(key, toHash(SessionRecord.parse(record)))
      .pexpire(key, SESSION_RECORD_TTL_MS)
      .exec();
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const hash = await this.#redis.hgetall(this.#key(sessionId));
    if (Object.keys(hash).length === 0) return null;
    return fromHash(hash);
  }

  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    const fields = Object.entries(toHash(patch)).flat();
    if (fields.length === 0) return;
    // Only an existing record is patched; HSET alone would create a partial one without a TTL.
    await this.#redis.eval(
      "if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('HSET', KEYS[1], unpack(ARGV)) end return 0",
      1,
      this.#key(sessionId),
      ...fields,
    );
  }

  async spendTokenId(jti: string, ttlMs: number): Promise<boolean> {
    const result = await this.#redis.set(
      `${this.#prefix}jti:${jti}`,
      '1',
      'PX',
      Math.max(1, Math.ceil(ttlMs)),
      'NX',
    );
    return result === 'OK';
  }

  async close(): Promise<void> {
    await this.#redis.quit();
  }
}

/** Hash field values are strings: booleans as 0/1, null codec as '', lists as JSON. */
function toHash(record: SessionPatch | SessionRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean') out[key] = value ? '1' : '0';
    else if (value === null) out[key] = '';
    else if (Array.isArray(value)) out[key] = JSON.stringify(value);
    else out[key] = String(value);
  }
  return out;
}

function fromHash(hash: Record<string, string>): SessionRecord | null {
  let keyterms: unknown;
  try {
    keyterms = JSON.parse(hash.keyterms ?? '[]');
  } catch {
    return null;
  }
  const parsed = SessionRecord.safeParse({
    sessionId: hash.sessionId,
    workspaceId: hash.workspaceId,
    meetingId: hash.meetingId,
    codec: hash.codec === '' || hash.codec === undefined ? null : hash.codec,
    ended: hash.ended === '1',
    endedAt: hash.endedAt === '' || hash.endedAt === undefined ? null : Number(hash.endedAt),
    stt: hash.stt,
    needsBatch: hash.needsBatch === '1',
    keyterms,
    createdAt: Number(hash.createdAt),
  });
  return parsed.success ? parsed.data : null;
}
