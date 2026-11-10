import { idbDone, idbRequest, VIDEO_STORE } from './idb.ts';
import type { VideoFragmentRow } from './video-recorder.ts';

/** ADR-0011 §3.3: video waits while the audio backlog is above 5 s or the stream is reconnecting. */
export const AUDIO_BACKLOG_LIMIT_MS = 5_000;
/** D-02 default retention: local video older than this is deleted even if it never uploaded. */
export const VIDEO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** ADR-0011 §3.3: one signing request covers at most 50 fragments. */
export const SIGN_BATCH = 50;
const GATE_POLL_MS = 1_000;
const IDLE_POLL_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
/** Re-sign a little before the URL expires, so a slow PUT does not start on a dead URL. */
const URL_MARGIN_MS = 60_000;

export type FragmentFilter = (sessionId: string, partId: string, index: number) => boolean;

/** Fragments waiting in IndexedDB, oldest first (session, part and index are all time-ordered). */
export interface FragmentQueue {
  /** Oldest fragment that `include` accepts, or null. */
  next(include: FragmentFilter): Promise<VideoFragmentRow | null>;
  /** Fragment indices still waiting for one part, ascending, at most `limit`. */
  indices(sessionId: string, partId: string, limit: number): Promise<number[]>;
  count(include: FragmentFilter): Promise<number>;
  remove(row: VideoFragmentRow): Promise<void>;
}

export interface SignedFragment {
  index: number;
  url: string;
  expiresAt: number;
  /** Signed headers the PUT must carry, e.g. Cloud Storage's size range (S2-14). */
  headers?: Record<string, string>;
}

/**
 * The server refused this one fragment for good (e.g. 413 too large, 400 type mismatch). It stays
 * in IndexedDB (pruned with the 7-day retention) and the uploader moves on to the next one.
 */
export class FragmentRejected extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`fragment refused (HTTP ${status})`);
    this.status = status;
  }
}

export class UploadRejected extends Error {
  readonly sessionId: string;

  constructor(sessionId = '') {
    super('video session rejected');
    this.sessionId = sessionId;
  }
}

export interface VideoUploaderOptions {
  queue: FragmentQueue;
  sign(
    sessionId: string,
    partId: string,
    indices: number[],
    contentType: string,
  ): Promise<SignedFragment[]>;
  put(
    url: string,
    blob: Blob,
    contentType: string,
    headers?: Record<string, string>,
  ): Promise<void>;
  /** False while audio needs the link (reconnecting, or backlog above 5 s). */
  canUpload(): boolean;
  /** Sessions that never upload, e.g. recordings made without the gateway (`local_…`). */
  isUploadable(sessionId: string): boolean;
  onProgress(progress: { pending: number; uploaded: number }): void;
  /** Nothing uploadable is left. */
  onIdle(): void;
  onError(context: string, error: unknown): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Fragments of server sessions upload; local-only recordings (no session ID yet) stay put. */
export function uploadableSession(sessionId: string): boolean {
  return sessionId.startsWith('ses_');
}

export function baseContentType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim() ?? mimeType;
}

/**
 * Uploads video fragments one at a time at the lowest priority (ADR-0011 §3.3): audio first, one
 * signed PUT per 10 s fragment, the local copy deleted only after the PUT succeeded. It keeps
 * going after the meeting ends and resumes leftovers from earlier recordings.
 */
export class VideoUploader {
  readonly #o: VideoUploaderOptions;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #skip = new Set<string>();
  /** Fragments the server refused for good; retrying them forever would block every later one. */
  readonly #skipFragments = new Set<string>();
  readonly #urls = new Map<string, SignedFragment>();
  #uploaded = 0;
  #failures = 0;
  #running = false;
  #stopped = false;
  #wake: (() => void) | null = null;
  /** Key of the fragment being uploaded, for per-fragment refusals. */
  #current: string | null = null;

  constructor(options: VideoUploaderOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)));
  }

  /** A fragment was written or the gate may have opened: start or wake the loop. */
  kick(): void {
    if (this.#stopped) return;
    if (!this.#running) {
      this.#running = true;
      void this.#run();
      return;
    }
    this.#wake?.();
  }

  stop(): void {
    this.#stopped = true;
    this.#wake?.();
  }

  /** Fragments uploaded since this uploader started. */
  get uploaded(): number {
    return this.#uploaded;
  }

  /** Fragments still waiting, counting only sessions that can upload. */
  pending(): Promise<number> {
    return this.#o.queue.count(this.#include);
  }

  readonly #include: FragmentFilter = (sessionId, partId, index) =>
    !this.#skip.has(sessionId) &&
    !this.#skipFragments.has(fragmentKey(sessionId, partId, index)) &&
    this.#o.isUploadable(sessionId);

  async #run(): Promise<void> {
    while (!this.#stopped) {
      try {
        if (!this.#o.canUpload()) {
          await this.#pause(GATE_POLL_MS);
          continue;
        }
        const row = await this.#o.queue.next(this.#include);
        if (row === null) {
          this.#o.onProgress({ pending: 0, uploaded: this.#uploaded });
          this.#o.onIdle();
          await this.#pause(IDLE_POLL_MS);
          continue;
        }
        await this.#upload(row);
        this.#failures = 0;
        this.#uploaded += 1;
        this.#o.onProgress({ pending: await this.pending(), uploaded: this.#uploaded });
      } catch (error: unknown) {
        if (error instanceof FragmentRejected && this.#current !== null) {
          this.#o.onError('video fragment refused', error);
          this.#skipFragments.add(this.#current);
          continue;
        }
        if (error instanceof UploadRejected) {
          // Its fragments stay in IndexedDB (never deleted without a successful PUT).
          this.#o.onError('video session rejected', error);
          this.#skip.add(error.sessionId);
          continue;
        }
        this.#failures += 1;
        this.#o.onError('video upload failed', error);
        await this.#pause(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (this.#failures - 1)));
      }
    }
    this.#running = false;
  }

  async #upload(row: VideoFragmentRow): Promise<void> {
    const contentType = baseContentType(row.mimeType);
    const key = fragmentKey(row.sessionId, row.partId, row.index);
    this.#current = key;
    const signed = await this.#urlFor(row, contentType);
    try {
      await this.#o.put(signed.url, row.blob, contentType, signed.headers ?? {});
    } finally {
      // Retries re-sign: a failed PUT may mean the URL expired or was refused.
      this.#urls.delete(key);
    }
    await this.#o.queue.remove(row);
  }

  async #urlFor(row: VideoFragmentRow, contentType: string): Promise<SignedFragment> {
    const key = fragmentKey(row.sessionId, row.partId, row.index);
    const cached = this.#urls.get(key);
    if (cached !== undefined && cached.expiresAt - URL_MARGIN_MS > this.#now()) return cached;

    const indices = await this.#o.queue.indices(row.sessionId, row.partId, SIGN_BATCH);
    if (!indices.includes(row.index)) indices.unshift(row.index);
    let signed: SignedFragment[];
    try {
      signed = await this.#o.sign(
        row.sessionId,
        row.partId,
        indices.slice(0, SIGN_BATCH),
        contentType,
      );
    } catch (error: unknown) {
      if (error instanceof UploadRejected) throw new UploadRejected(row.sessionId);
      throw error;
    }
    for (const fragment of signed) {
      this.#urls.set(fragmentKey(row.sessionId, row.partId, fragment.index), fragment);
    }
    const fragment = this.#urls.get(key);
    if (fragment === undefined) throw new Error('fragment was not signed');
    return fragment;
  }

  async #pause(ms: number): Promise<void> {
    await Promise.race([
      this.#sleep(ms),
      new Promise<void>((resolve) => {
        this.#wake = resolve;
      }),
    ]);
    this.#wake = null;
  }
}

function fragmentKey(sessionId: string, partId: string, index: number): string {
  return `${sessionId}/${partId}/${index}`;
}

/** The `video_buffer` store (key `[sessionId, partId, index]`) as an upload queue. */
export class IdbFragmentQueue implements FragmentQueue {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async next(include: FragmentFilter): Promise<VideoFragmentRow | null> {
    const store = this.#db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE);
    for (const key of await idbRequest(store.getAllKeys())) {
      if (!Array.isArray(key)) continue;
      const [sessionId, partId, index] = key as unknown[];
      if (typeof sessionId !== 'string' || typeof partId !== 'string') continue;
      if (typeof index !== 'number' || !include(sessionId, partId, index)) continue;
      const row = (await idbRequest(
        this.#db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE).get(key),
      )) as VideoFragmentRow | undefined;
      if (row !== undefined) return row;
    }
    return null;
  }

  async indices(sessionId: string, partId: string, limit: number): Promise<number[]> {
    const store = this.#db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE);
    const range = IDBKeyRange.bound([sessionId, partId, 0], [sessionId, partId, Infinity]);
    const keys = await idbRequest(store.getAllKeys(range, limit));
    return keys.flatMap((key) =>
      Array.isArray(key) && typeof key[2] === 'number' ? [key[2]] : [],
    );
  }

  async count(include: FragmentFilter): Promise<number> {
    const store = this.#db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE);
    const keys = await idbRequest(store.getAllKeys());
    return keys.filter(
      (key) => Array.isArray(key) && include(String(key[0]), String(key[1]), Number(key[2])),
    ).length;
  }

  async remove(row: VideoFragmentRow): Promise<void> {
    const tx = this.#db.transaction(VIDEO_STORE, 'readwrite');
    tx.objectStore(VIDEO_STORE).delete([row.sessionId, row.partId, row.index]);
    await idbDone(tx);
  }
}

/** Deletes `video_buffer` rows written before `cutoffMs`; returns how many were deleted. */
export async function pruneStaleFragments(db: IDBDatabase, cutoffMs: number): Promise<number> {
  const tx = db.transaction(VIDEO_STORE, 'readwrite');
  const store = tx.objectStore(VIDEO_STORE);
  // Listen before the cursor runs: the transaction may complete as soon as the last request does.
  const done = idbDone(tx);
  let deleted = 0;
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve();
        return;
      }
      const row = cursor.value as VideoFragmentRow;
      if (row.createdAt < cutoffMs) {
        cursor.delete();
        deleted += 1;
      }
      cursor.continue();
    };
  });
  await done;
  return deleted;
}
