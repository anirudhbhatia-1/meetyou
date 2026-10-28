import type { Hypothesis, ProviderOptions, StreamLogLine } from '../schemas.ts';

export interface RunContext {
  clipId: string;
  lane: 'me' | 'them';
  /** Names and terms for vocabulary boosting (used only when the run enables it). */
  vocabulary: string[];
  /** Number of speakers, if known (diarization hint). */
  speakers?: number;
}

/** Emits a stream log line; the runner stamps `t`. */
export type Emit = (line: DistributiveOmit<StreamLogLine, 't'>) => void;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface StreamSession {
  /** 100 ms of 16 kHz mono PCM16. */
  send(chunk: Buffer): void;
  /** Signals end of audio and resolves when the provider has delivered its last results. */
  end(): Promise<void>;
}

export interface StreamProvider<O extends ProviderOptions = ProviderOptions> {
  /** Hard session limit, if the provider has one; the runner rotates sessions before it. */
  maxSessionMs?: number;
  open(options: O, ctx: RunContext, emit: Emit): Promise<StreamSession>;
}

export interface BatchProvider<O extends ProviderOptions = ProviderOptions> {
  transcribe(options: O, wavPath: string, ctx: RunContext): Promise<unknown>;
  toHypothesis(raw: unknown): Hypothesis;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Vendor data-use rules (STT_PREFLIGHT.md §6) are enforced here, not left to callers. */
export function requireConfirmed(name: string, why: string): void {
  if (process.env[name] !== 'true') {
    throw new Error(`Refusing to send audio: set ${name}=true after you have ${why}.`);
  }
}

export async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${new URL(url).pathname} → ${res.status}: ${text.slice(0, 500)}`,
    );
  return text ? (JSON.parse(text) as unknown) : null;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
