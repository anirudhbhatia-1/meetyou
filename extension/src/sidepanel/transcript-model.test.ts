import { describe, expect, it } from 'vitest';

import {
  applyTranscript,
  EMPTY_TRANSCRIPT,
  MAX_LIVE_LINES,
  visibleLines,
} from './transcript-model.ts';

const base = { lane: 'them' as const, speaker: 'spk_1', startMs: 1000 };

describe('live transcript (FR-LIV-02)', () => {
  it('replaces a lane interim in place with its final', () => {
    let view = applyTranscript(EMPTY_TRANSCRIPT, { ...base, final: false, text: 'kal tak' });
    view = applyTranscript(view, { ...base, final: false, text: 'kal tak bhej' });
    expect(visibleLines(view).map((l) => [l.text, l.final])).toEqual([['kal tak bhej', false]]);
    view = applyTranscript(view, { ...base, final: true, text: 'Kal tak bhej dena.' });
    expect(visibleLines(view).map((l) => [l.text, l.final])).toEqual([
      ['Kal tak bhej dena.', true],
    ]);
  });

  it('keeps the other lane interim when one lane finalizes', () => {
    let view = applyTranscript(EMPTY_TRANSCRIPT, {
      lane: 'me',
      speaker: null,
      startMs: 2000,
      final: false,
      text: 'theek hai',
    });
    view = applyTranscript(view, { ...base, final: true, text: 'Deck ready hai.' });
    expect(visibleLines(view).map((l) => [l.lane, l.final])).toEqual([
      ['them', true],
      ['me', false],
    ]);
  });

  it('keeps only the live tail', () => {
    let view = EMPTY_TRANSCRIPT;
    for (let i = 0; i < MAX_LIVE_LINES + 5; i++) {
      view = applyTranscript(view, { ...base, startMs: i, final: true, text: `line ${i}` });
    }
    expect(view.finals).toHaveLength(MAX_LIVE_LINES);
    expect(view.finals[0]?.text).toBe('line 5');
    expect(new Set(view.finals.map((l) => l.key)).size).toBe(MAX_LIVE_LINES);
  });
});
