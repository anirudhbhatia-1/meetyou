import type { SummarySegment } from './input.ts';
import { segmentLine } from './prompt.ts';

/**
 * Rough token count for routing only (single pass vs chunks), never for billing: about three
 * characters per token is conservative for mixed Roman Hindi and English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Splits a long transcript into time-ordered windows of about `maxTokens` each (PRD AI-08). Each
 * window after the first also repeats the segments of the previous `overlapMs`, so a thread that
 * crosses a boundary is seen whole by one of the two parts.
 */
export function chunkSegments(
  segments: readonly SummarySegment[],
  maxTokens: number,
  overlapMs: number,
): SummarySegment[][] {
  const visible = segments.filter((s) => !s.echo);
  const windows: SummarySegment[][] = [];
  let current: SummarySegment[] = [];
  let tokens = 0;
  for (const segment of visible) {
    const cost = estimateTokens(segmentLine(segment)) + 1;
    if (current.length > 0 && tokens + cost > maxTokens) {
      windows.push(current);
      const boundary = segment.startMs - overlapMs;
      current = current.filter((s) => s.endMs > boundary);
      tokens = current.reduce((n, s) => n + estimateTokens(segmentLine(s)) + 1, 0);
    }
    current.push(segment);
    tokens += cost;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}
