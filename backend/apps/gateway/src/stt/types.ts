/**
 * Streaming STT provider interface (ARCHITECTURE §7.1, AGENTS rule 3): vendor code lives only in
 * modules implementing it. Times are milliseconds of audio sent on this stream; the session maps
 * them to the session clock.
 * TODO(S2-03): move to backend/packages/providers with the registry and the Google adapter.
 */
export interface SttWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  /** Provider diarization index within this stream (0, 1, …), when diarization is on. */
  speaker?: number;
}

export interface SttResult {
  final: boolean;
  text: string;
  startMs: number;
  endMs: number;
  /** Provider-reported language, e.g. "hi" or "en"; undefined when not reported. */
  language?: string;
  words?: SttWord[];
}

/**
 * What the session sends: raw 16 kHz mono PCM16, or an Ogg Opus byte stream (header pages first)
 * built from the client's packets without decoding (ADR-0003).
 */
export type SttInput = 'pcm16' | 'ogg_opus';

export interface SttStream {
  /** Audio bytes in the stream's input format, in order. */
  send(bytes: Uint8Array): void;
  /** Closes after the provider has returned its last results. */
  close(): Promise<void>;
}

export interface SttStreamHandlers {
  onResult(result: SttResult): void;
  /** The provider stream ended unexpectedly; the session may open a new one. */
  onClosed(reason: string): void;
}

export interface SttProvider {
  readonly name: string;
  /** Streaming list price for cost tracking (AGENTS §3 rule 10); null when unknown. */
  readonly usdPerMinute: number | null;
  open(
    input: SttInput,
    handlers: SttStreamHandlers,
    options?: { diarize?: boolean },
  ): Promise<SttStream>;
}
