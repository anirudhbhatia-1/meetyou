import type { Lane } from '@meetyou/contracts';

/**
 * Pure alignment steps of the batch pass (S3-04, ARCHITECTURE §8.3 and §9.2 steps 7–8): name
 * diarized clusters from Meet's active-speaker signal, map old segment IDs to the new segments so
 * citations survive, and measure whether the transcript changed enough to rewrite the notes.
 */

export interface TimedSegment {
  id: string;
  lane: Lane;
  startMs: number;
  endMs: number;
}

const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

/**
 * Old segment → the new segment of the same lane that overlaps it most (nearest by midpoint when
 * none overlaps). Every old ID with any new segment on its lane gets a target.
 */
export function mapSegmentIds(
  previous: readonly TimedSegment[],
  next: readonly TimedSegment[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const old of previous) {
    const candidates = next.filter((n) => n.lane === old.lane);
    let best: TimedSegment | undefined;
    let bestOverlap = 0;
    for (const n of candidates) {
      const o = overlap(old, n);
      if (o > bestOverlap) {
        best = n;
        bestOverlap = o;
      }
    }
    if (best === undefined) {
      const mid = (old.startMs + old.endMs) / 2;
      let bestDistance = Infinity;
      for (const n of candidates) {
        const d = Math.abs((n.startMs + n.endMs) / 2 - mid);
        if (d < bestDistance) {
          best = n;
          bestDistance = d;
        }
      }
    }
    if (best !== undefined) result.set(old.id, best.id);
  }
  return result;
}

/** Meet's `speaker.active` signal: someone became the active speaker at `atMs` (session clock). */
export interface SpeakerSignal {
  externalId: string;
  atMs: number;
}

/** A speaker stays active until the next signal, for at most this long. */
const MAX_TURN_MS = 15_000;

export function speakerTurns(
  signals: readonly SpeakerSignal[],
): { externalId: string; startMs: number; endMs: number }[] {
  const sorted = [...signals].sort((a, b) => a.atMs - b.atMs);
  return sorted.map((s, i) => ({
    externalId: s.externalId,
    startMs: s.atMs,
    endMs: Math.min(sorted[i + 1]?.atMs ?? Infinity, s.atMs + MAX_TURN_MS),
  }));
}

/** At least this share of a cluster's signal-covered time must point to one person. */
const NAME_SHARE = 0.6;
/** And at least this much speech of the cluster must be covered by signals. */
const MIN_COVERED_MS = 2_000;

/**
 * FR-SPK-03: each `them` cluster gets the participant who was the active speaker for most of its
 * speech, when the signal is clear enough; otherwise it stays unnamed ("Speaker N").
 */
export function nameClusters(
  segments: readonly { cluster: string; startMs: number; endMs: number }[],
  signals: readonly SpeakerSignal[],
): Map<string, string> {
  const turns = speakerTurns(signals);
  const byCluster = new Map<string, Map<string, number>>();
  for (const s of segments) {
    const votes = byCluster.get(s.cluster) ?? new Map<string, number>();
    for (const t of turns) {
      const o = overlap(s, t);
      if (o > 0) votes.set(t.externalId, (votes.get(t.externalId) ?? 0) + o);
    }
    byCluster.set(s.cluster, votes);
  }
  const names = new Map<string, string>();
  for (const [cluster, votes] of byCluster) {
    const total = [...votes.values()].reduce((a, b) => a + b, 0);
    const [top, ms] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [undefined, 0];
    if (top !== undefined && total >= MIN_COVERED_MS && ms / total >= NAME_SHARE) {
      names.set(cluster, top);
    }
  }
  return names;
}

const words = (texts: readonly string[]) =>
  texts
    .join(' ')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/**
 * Share of words that differ between two transcripts, ignoring order (0 = same words, 1 = none
 * shared). Linear in length, so a two-hour meeting costs nothing; order changes are rare and do
 * not change what the notes can say.
 */
export function transcriptChange(before: readonly string[], after: readonly string[]): number {
  const a = words(before);
  const b = words(after);
  if (a.length + b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(w, n - 1);
    }
  }
  return 1 - (2 * shared) / (a.length + b.length);
}

/** Above this the notes are rewritten from the improved transcript (FR-PROC-02 "materially"). */
export const MATERIAL_CHANGE = 0.05;

/** Token-set similarity of two action items (ARCHITECTURE §9.3 status carry-over). */
export function textSimilarity(a: string, b: string): number {
  const x = new Set(words([a]));
  const y = new Set(words([b]));
  if (x.size + y.size === 0) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}
