/**
 * Streaming STT provider interface (ARCHITECTURE §7.1, AGENTS rule 3): vendor code lives only in
 * modules implementing it. Times are milliseconds of audio sent on this stream; the session maps
 * them to the session clock.
 * TODO(S2-03): move to backend/packages/providers with the registry and the Google adapter.
 */
export interface SttResult {
  final: boolean;
  text: string;
  startMs: number;
  endMs: number;
  /** Provider-reported language, e.g. "hi" or "en"; undefined when not reported. */
  language?: string;
  words?: { text: string; startMs: number; endMs: number; confidence?: number }[];
}

export interface SttStream {
  /** One 100 ms frame of 16 kHz mono PCM16. */
  send(pcm: Uint8Array): void;
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
  open(handlers: SttStreamHandlers): Promise<SttStream>;
}
