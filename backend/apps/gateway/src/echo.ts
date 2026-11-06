import type { Lane } from '@meetyou/contracts';

/**
 * Probable-echo detection (ARCHITECTURE §8.1 step 7): on laptop speakers the mic can pick up
 * remote voices, so the same words appear in `me` and `them`. The `me` copy is flagged, never
 * deleted; summaries exclude it. Counts also answer §26.2 Q2 (does echo cancellation suffice?).
 * Used by the transcript assembler (S2-05) before segments are stored.
 */
export const ECHO_WINDOW_MS = 3_000;
export const ECHO_SIMILARITY = 0.6;
const MIN_TOKENS = 2;
const KEEP_MS = 20_000;

/** Lowercased words without punctuation; works for Latin and Devanagari text. */
export function echoTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Dice coefficient over word multisets: 1 = same words, 0 = nothing shared. */
export function wordSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of b) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      common += 1;
      counts.set(t, n - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

interface Recent {
  lane: Lane;
  startMs: number;
  endMs: number;
  tokens: string[];
}

export interface EchoVerdict {
  /** This `me` segment repeats a recent `them` segment: flag it as echo. */
  flag: boolean;
  /** This `them` segment repeats a `me` segment already sent unflagged (counted, not flagged). */
  late: boolean;
}

export class EchoDetector {
  #recent: Recent[] = [];

  check(lane: Lane, startMs: number, endMs: number, text: string): EchoVerdict {
    const tokens = echoTokens(text);
    this.#recent = this.#recent.filter((r) => r.endMs > endMs - KEEP_MS);
    const other: Lane = lane === 'me' ? 'them' : 'me';
    const match =
      tokens.length >= MIN_TOKENS &&
      this.#recent.some(
        (r) =>
          r.lane === other &&
          r.startMs <= endMs + ECHO_WINDOW_MS &&
          startMs <= r.endMs + ECHO_WINDOW_MS &&
          wordSimilarity(tokens, r.tokens) >= ECHO_SIMILARITY,
      );
    this.#recent.push({ lane, startMs, endMs, tokens });
    return { flag: match && lane === 'me', late: match && lane === 'them' };
  }
}
