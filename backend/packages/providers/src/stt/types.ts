/**
 * STT provider interfaces (ARCHITECTURE §7.1, AGENTS rule 3): vendor code lives only in modules
 * implementing them. Streaming times are milliseconds of audio sent on that stream; the caller
 * maps them to the session clock.
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

/**
 * What a provider can do (ARCHITECTURE §7.3): callers adapt to it (keep-alive, rotation, whether a
 * batch diarization pass is needed) instead of naming vendors.
 */
export interface SttCapabilities {
  /** The stream closes after this long without audio unless kept alive. */
  idleTimeoutMs: number | null;
  /** Longest single stream before it must be rotated; null = no limit. */
  maxStreamMs: number | null;
  interim: boolean;
  diarization: boolean;
  wordTimestamps: boolean;
  /** Script of Hindi output: the assembler transliterates to Roman when needed (D-01). */
  hindiScript: 'devanagari' | 'roman' | 'mixed';
  vocabulary: { maxTerms: number | null; maxTokens: number | null; midStreamUpdate: boolean };
  inputs: readonly SttInput[];
}

export interface SttOpenOptions {
  /** Speaker diarization (the `them` lane only, FR-SPK-02). */
  diarize?: boolean;
  /** Workspace glossary terms to boost; the adapter trims them to its vocabulary limits. */
  keyterms?: readonly string[];
}

export interface SttStreamingProvider {
  readonly name: string;
  readonly capabilities: SttCapabilities;
  /** Streaming list price for cost tracking (AGENTS §3 rule 10); null when unknown. */
  readonly usdPerMinute: number | null;
  open(input: SttInput, handlers: SttStreamHandlers, options?: SttOpenOptions): Promise<SttStream>;
}

/** @deprecated Kept for the gateway's existing name; use SttStreamingProvider. */
export type SttProvider = SttStreamingProvider;

/** One speaker turn of a batch transcription (ARCHITECTURE §7.2), times in ms from audio start. */
export interface BatchSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Provider language for the turn, e.g. "hi" or "en". */
  language?: string;
  confidence?: number;
  /** Provider diarization index within this file. */
  speaker?: number;
  words: SttWord[];
}

export interface BatchResult {
  segments: BatchSegment[];
  durationMs: number;
  provider: string;
  model: string;
  /** Vendor request ID for support cases; never contains content. */
  requestId: string | null;
}

/** Audio for a batch pass: bytes in a container the provider reads, or a short-lived URL. */
export type BatchAudio =
  | { kind: 'bytes'; bytes: Uint8Array; contentType: 'audio/ogg' | 'audio/wav' }
  | { kind: 'url'; url: string };

export interface SttBatchProvider {
  readonly name: string;
  readonly usdPerMinute: number | null;
  transcribe(audio: BatchAudio, options?: { diarize?: boolean }): Promise<BatchResult>;
}
