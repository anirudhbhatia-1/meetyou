import type { Lane } from '../messages.ts';
import { AUDIO_STORE, idbDone, idbRequest } from './idb.ts';

export interface StoredFrame {
  lane: Lane;
  seq: number;
  captureMs: number;
  payload: Uint8Array;
}

/**
 * Local audio buffer (FR-CAP-07): every frame is written here before it is sent, and removed only
 * once the gateway acknowledges it as durable (ARCHITECTURE §5.3).
 */
export interface FrameStore {
  put(frame: StoredFrame): Promise<void>;
  /** Frames of one lane with `seq > afterSeq`, ascending, at most `limit`. */
  after(lane: Lane, afterSeq: number, limit: number): Promise<StoredFrame[]>;
  /** Removes frames of one lane with `seq <= upToSeq`. */
  prune(lane: Lane, upToSeq: number): Promise<void>;
  count(): Promise<number>;
}

export class MemoryFrameStore implements FrameStore {
  readonly frames: Record<Lane, Map<number, StoredFrame>> = { me: new Map(), them: new Map() };

  put(frame: StoredFrame): Promise<void> {
    this.frames[frame.lane].set(frame.seq, frame);
    return Promise.resolve();
  }

  after(lane: Lane, afterSeq: number, limit: number): Promise<StoredFrame[]> {
    const out = [...this.frames[lane].values()]
      .filter((f) => f.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    return Promise.resolve(out);
  }

  prune(lane: Lane, upToSeq: number): Promise<void> {
    for (const seq of this.frames[lane].keys()) if (seq <= upToSeq) this.frames[lane].delete(seq);
    return Promise.resolve();
  }

  count(): Promise<number> {
    return Promise.resolve(this.frames.me.size + this.frames.them.size);
  }
}

interface FrameRow extends StoredFrame {
  sessionId: string;
}

export class IdbFrameStore implements FrameStore {
  readonly #db: IDBDatabase;
  readonly #sessionId: string;

  constructor(db: IDBDatabase, sessionId: string) {
    this.#db = db;
    this.#sessionId = sessionId;
  }

  async put(frame: StoredFrame): Promise<void> {
    const tx = this.#db.transaction(AUDIO_STORE, 'readwrite');
    const row: FrameRow = { ...frame, sessionId: this.#sessionId };
    tx.objectStore(AUDIO_STORE).put(row);
    await idbDone(tx);
  }

  async after(lane: Lane, afterSeq: number, limit: number): Promise<StoredFrame[]> {
    const tx = this.#db.transaction(AUDIO_STORE, 'readonly');
    const range = IDBKeyRange.bound(
      [this.#sessionId, lane, afterSeq + 1],
      [this.#sessionId, lane, Number.MAX_SAFE_INTEGER],
    );
    const rows = (await idbRequest(tx.objectStore(AUDIO_STORE).getAll(range, limit))) as FrameRow[];
    return rows.map(({ lane: l, seq, captureMs, payload }) => ({
      lane: l,
      seq,
      captureMs,
      payload,
    }));
  }

  async prune(lane: Lane, upToSeq: number): Promise<void> {
    if (upToSeq < 0) return;
    const tx = this.#db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).delete(
      IDBKeyRange.bound([this.#sessionId, lane, 0], [this.#sessionId, lane, upToSeq]),
    );
    await idbDone(tx);
  }

  async count(): Promise<number> {
    const tx = this.#db.transaction(AUDIO_STORE, 'readonly');
    const range = IDBKeyRange.bound(
      [this.#sessionId, 'me', 0],
      [this.#sessionId, 'them', Number.MAX_SAFE_INTEGER],
    );
    return idbRequest(tx.objectStore(AUDIO_STORE).count(range));
  }
}
