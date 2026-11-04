import type { Lane } from '@meetyou/contracts';

/**
 * Per-session usage and cost (AGENTS §3 rule 10: track cost per meeting from the first working
 * version). Counts only — no audio or text. Written next to the session's chunks and logged at the
 * end; the database table replaces the file in S2.
 */
export interface SessionUsage {
  sessionId: string;
  workspaceId: string;
  codec: 'pcm16' | 'opus' | null;
  startedAt: string;
  updatedAt: string;
  connections: number;
  framesReceived: Record<Lane, number>;
  duplicateFrames: number;
  /** Audio durably stored, in ms; frames received again after a reconnect count once. */
  audioMs: Record<Lane, number>;
  bytesStored: number;
  chunksWritten: number;
  /** Final segments per lane and probable echo (§8.1 step 7; §26.2 Q2). */
  segments: {
    me: number;
    them: number;
    /** `me` segments flagged as echo of `them`. */
    echoFlagged: number;
    /** Echo found only when the `them` copy arrived after the `me` copy was already sent. */
    echoLate: number;
  };
  stt: {
    provider: string | null;
    /** Audio sent to the provider (what it bills), in ms. */
    audioMs: Record<Lane, number>;
    streamsOpened: number;
    usdPerMinute: number | null;
  };
  estimatedCostUsd: number;
}

export class UsageMeter {
  readonly #usage: SessionUsage;

  constructor(options: {
    sessionId: string;
    workspaceId: string;
    provider: string | null;
    usdPerMinute: number | null;
    now?: Date;
  }) {
    const at = (options.now ?? new Date()).toISOString();
    this.#usage = {
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      codec: null,
      startedAt: at,
      updatedAt: at,
      connections: 0,
      framesReceived: { me: 0, them: 0 },
      duplicateFrames: 0,
      audioMs: { me: 0, them: 0 },
      bytesStored: 0,
      chunksWritten: 0,
      segments: { me: 0, them: 0, echoFlagged: 0, echoLate: 0 },
      stt: {
        provider: options.provider,
        audioMs: { me: 0, them: 0 },
        streamsOpened: 0,
        usdPerMinute: options.usdPerMinute,
      },
      estimatedCostUsd: 0,
    };
  }

  connected(codec: 'pcm16' | 'opus'): void {
    this.#usage.connections += 1;
    this.#usage.codec = codec;
  }

  frame(lane: Lane): void {
    this.#usage.framesReceived[lane] += 1;
  }

  duplicate(): void {
    this.#usage.duplicateFrames += 1;
  }

  chunk(lane: Lane, bytes: number, durationMs: number): void {
    this.#usage.chunksWritten += 1;
    this.#usage.bytesStored += bytes;
    this.#usage.audioMs[lane] += durationMs;
  }

  segment(lane: Lane, echo: { flag: boolean; late: boolean }): void {
    this.#usage.segments[lane] += 1;
    if (echo.flag) this.#usage.segments.echoFlagged += 1;
    if (echo.late) this.#usage.segments.echoLate += 1;
  }

  sttStreamOpened(): void {
    this.#usage.stt.streamsOpened += 1;
  }

  sttSent(lane: Lane, durationMs: number): void {
    this.#usage.stt.audioMs[lane] += durationMs;
  }

  snapshot(now: Date = new Date()): SessionUsage {
    const sttMinutes = (this.#usage.stt.audioMs.me + this.#usage.stt.audioMs.them) / 60_000;
    const rate = this.#usage.stt.usdPerMinute ?? 0;
    return structuredClone({
      ...this.#usage,
      updatedAt: now.toISOString(),
      estimatedCostUsd: Math.round(sttMinutes * rate * 10_000) / 10_000,
    });
  }
}
