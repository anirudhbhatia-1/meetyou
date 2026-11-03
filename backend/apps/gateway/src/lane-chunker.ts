import type { AudioFrame } from '@meetyou/contracts';

import type { ChunkFrame } from './chunk-store.ts';

/** 100 frames × 100 ms = 10 s chunks (ARCHITECTURE §6.1). */
export const FRAMES_PER_CHUNK = 100;

export type AcceptResult = 'accepted' | 'duplicate' | 'gap';

export interface PendingChunk {
  frames: ChunkFrame[];
  audio: Uint8Array;
}

/**
 * Per-lane ordering and chunking. Frames must arrive as `durable + 1, + 2, …` (the client replays
 * from `durableUpTo`); anything at or below the last accepted seq is a duplicate and ignored
 * (§5.3); a jump is a gap, which the session answers by asking the client to reconnect.
 */
export class LaneChunker {
  #durable: number;
  #lastAccepted: number;
  #pending: AudioFrame[] = [];
  readonly #framesPerChunk: number;

  constructor(durableUpTo: number, framesPerChunk: number = FRAMES_PER_CHUNK) {
    this.#durable = durableUpTo;
    this.#lastAccepted = durableUpTo;
    this.#framesPerChunk = framesPerChunk;
  }

  get durableUpTo(): number {
    return this.#durable;
  }

  accept(frame: AudioFrame): AcceptResult {
    if (frame.seq <= this.#lastAccepted) return 'duplicate';
    if (frame.seq !== this.#lastAccepted + 1) return 'gap';
    this.#pending.push({ ...frame, payload: frame.payload.slice() });
    this.#lastAccepted = frame.seq;
    return 'accepted';
  }

  /** Returns the next chunk to write when full, or whatever is pending when `force` is set. */
  take(force = false): PendingChunk | null {
    if (this.#pending.length === 0) return null;
    if (!force && this.#pending.length < this.#framesPerChunk) return null;
    const frames = this.#pending.splice(0, this.#framesPerChunk);
    const audio = new Uint8Array(frames.reduce((n, f) => n + f.payload.byteLength, 0));
    let offset = 0;
    for (const f of frames) {
      audio.set(f.payload, offset);
      offset += f.payload.byteLength;
    }
    return { frames: frames.map(({ seq, captureMs }) => ({ seq, captureMs })), audio };
  }

  committed(lastSeq: number): void {
    this.#durable = Math.max(this.#durable, lastSeq);
  }

  /** On disconnect: frames not yet durable are dropped; the client replays them. */
  dropPending(): void {
    this.#pending = [];
    this.#lastAccepted = this.#durable;
  }
}
