import type { VideoFragmentRow } from '../offscreen/video-recorder.ts';

export interface VideoPartFile {
  partId: string;
  /** Session-clock start of the part; parts after a pause start later (ADR-0011 §3.2). */
  startMs: number;
  mimeType: string;
  fragments: VideoFragmentRow[];
}

/**
 * Every part of the newest recording, in session order. Pause/resume starts a new part, so a
 * recording with pauses has several; each part is a self-contained file (its fragments concatenate),
 * and the server's `video.finalize` joins them (ADR-0011 §3.4).
 */
export function latestSessionParts(rows: readonly VideoFragmentRow[]): VideoPartFile[] {
  const newest = rows.reduce<VideoFragmentRow | null>(
    (best, row) => (best === null || row.createdAt > best.createdAt ? row : best),
    null,
  );
  if (newest === null) return [];
  const parts = new Map<string, VideoPartFile>();
  for (const row of rows) {
    if (row.sessionId !== newest.sessionId) continue;
    let part = parts.get(row.partId);
    if (part === undefined) {
      part = { partId: row.partId, startMs: row.startMs, mimeType: row.mimeType, fragments: [] };
      parts.set(row.partId, part);
    }
    part.fragments.push(row);
  }
  const ordered = [...parts.values()].sort((a, b) => a.startMs - b.startMs);
  for (const part of ordered) part.fragments.sort((a, b) => a.index - b.index);
  return ordered;
}
