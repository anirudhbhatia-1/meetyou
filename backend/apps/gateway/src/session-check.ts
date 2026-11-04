import type { ChunkFrame } from './chunk-store.ts';

/** Captures within this much of the expected time count as contiguous (frame rounding). */
const CONTIGUOUS_TOLERANCE_MS = 50;

export interface LaneReport {
  frames: number;
  firstSeq: number | null;
  lastSeq: number | null;
  /** Sequence numbers absent between first and last: audio that never became durable. */
  missingSeqs: number[];
  duplicateSeqs: number[];
  audioMs: number;
  /** Jumps in captureMs (pauses, or frames dropped before sending). */
  gaps: { atMs: number; lengthMs: number }[];
  spanMs: number;
}

/**
 * Checks one lane's stored frames for loss (M1 exit: "no audio loss"). A missing seq is real loss;
 * a captureMs gap is a pause unless the client dropped frames, which it never does while recording.
 */
export function checkLane(frames: readonly ChunkFrame[]): LaneReport {
  const sorted = [...frames].sort((a, b) => a.seq - b.seq);
  const missingSeqs: number[] = [];
  const duplicateSeqs: number[] = [];
  const gaps: LaneReport['gaps'] = [];
  let audioMs = 0;
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    if (f === undefined) continue;
    audioMs += f.durationMs;
    const prev = sorted[i - 1];
    if (prev === undefined) continue;
    if (f.seq === prev.seq) {
      duplicateSeqs.push(f.seq);
      continue;
    }
    for (let s = prev.seq + 1; s < f.seq; s++) missingSeqs.push(s);
    const expected = prev.captureMs + prev.durationMs;
    if (f.captureMs - expected > CONTIGUOUS_TOLERANCE_MS) {
      gaps.push({ atMs: expected, lengthMs: f.captureMs - expected });
    }
  }
  const first = sorted[0];
  const last = sorted.at(-1);
  return {
    frames: sorted.length,
    firstSeq: first?.seq ?? null,
    lastSeq: last?.seq ?? null,
    missingSeqs,
    duplicateSeqs,
    audioMs,
    gaps,
    spanMs: first && last ? last.captureMs + last.durationMs - first.captureMs : 0,
  };
}
