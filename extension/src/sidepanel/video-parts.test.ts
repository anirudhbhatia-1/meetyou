import { describe, expect, it } from 'vitest';

import type { VideoFragmentRow } from '../offscreen/video-recorder.ts';
import { latestSessionParts } from './video-parts.ts';

function row(
  sessionId: string,
  partId: string,
  index: number,
  startMs: number,
  createdAt: number,
): VideoFragmentRow {
  return {
    sessionId,
    partId,
    index,
    startMs,
    mimeType: 'video/mp4;codecs=avc1,opus',
    createdAt,
    blob: new Blob([`${partId}-${index}`]),
  };
}

describe('latestSessionParts', () => {
  it('keeps the part from before a pause next to the part after it', () => {
    const rows = [
      row('s2', 'vp_after', 1, 90_000, 105),
      row('s2', 'vp_before', 0, 0, 101),
      row('s2', 'vp_before', 1, 0, 102),
      row('s2', 'vp_after', 0, 90_000, 104),
      row('s1', 'vp_old', 0, 0, 50),
    ];
    const parts = latestSessionParts(rows);
    expect(parts.map((p) => p.partId)).toEqual(['vp_before', 'vp_after']);
    expect(parts[0]?.fragments.map((f) => f.index)).toEqual([0, 1]);
    expect(parts[1]?.startMs).toBe(90_000);
  });

  it('returns nothing when no video is stored', () => {
    expect(latestSessionParts([])).toEqual([]);
  });
});
