import { describe, expect, it } from 'vitest';

import { fileToSession, sessionToFile } from './audio.ts';

// 0–10 s recorded, paused until 40 s, then 40–50 s recorded.
const spans = [
  { fileMs: 0, sessionMs: 0, durationMs: 10_000 },
  { fileMs: 10_000, sessionMs: 40_000, durationMs: 10_000 },
];

describe('audio time map', () => {
  it('maps meeting time into the file, skipping the pause', () => {
    expect(sessionToFile(spans, 4_000)).toBe(4_000);
    expect(sessionToFile(spans, 41_500)).toBe(11_500);
    // Inside the pause: start of the next recorded stretch.
    expect(sessionToFile(spans, 20_000)).toBe(10_000);
    expect(sessionToFile(spans, 60_000)).toBeNull();
  });

  it('maps file time back to the meeting clock', () => {
    expect(fileToSession(spans, 4_000)).toBe(4_000);
    expect(fileToSession(spans, 11_500)).toBe(41_500);
    expect(fileToSession(spans, 99_000)).toBe(50_000);
  });
});
