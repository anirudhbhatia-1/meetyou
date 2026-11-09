import { describe, expect, it } from 'vitest';

import {
  mapSegmentIds,
  nameClusters,
  speakerTurns,
  textSimilarity,
  transcriptChange,
} from './align.ts';

describe('mapSegmentIds', () => {
  it('maps each old segment to the most-overlapping new one on its lane', () => {
    const map = mapSegmentIds(
      [
        { id: 'o1', lane: 'them', startMs: 0, endMs: 3_000 },
        { id: 'o2', lane: 'them', startMs: 3_000, endMs: 6_000 },
        { id: 'o3', lane: 'me', startMs: 2_000, endMs: 4_000 },
        { id: 'o4', lane: 'them', startMs: 20_000, endMs: 21_000 },
      ],
      [
        { id: 'n1', lane: 'them', startMs: 0, endMs: 5_500 },
        { id: 'n2', lane: 'them', startMs: 5_500, endMs: 9_000 },
        { id: 'n3', lane: 'me', startMs: 1_000, endMs: 5_000 },
      ],
    );
    expect(Object.fromEntries(map)).toEqual({ o1: 'n1', o2: 'n1', o3: 'n3', o4: 'n2' });
  });

  it('leaves a segment unmapped when its lane has no new segments', () => {
    expect(mapSegmentIds([{ id: 'o', lane: 'me', startMs: 0, endMs: 1 }], []).size).toBe(0);
  });
});

describe('nameClusters', () => {
  it('names clusters from the active-speaker signal and leaves unclear ones unnamed', () => {
    const signals = [
      { externalId: 'neha', atMs: 0 },
      { externalId: 'sameer', atMs: 10_000 },
      { externalId: 'neha', atMs: 20_000 },
      { externalId: 'sameer', atMs: 22_000 },
    ];
    expect(speakerTurns(signals).at(-1)).toEqual({
      externalId: 'sameer',
      startMs: 22_000,
      endMs: 37_000,
    });
    const names = nameClusters(
      [
        { cluster: 'a', startMs: 500, endMs: 9_000 },
        { cluster: 'b', startMs: 10_500, endMs: 19_000 },
        // Half Neha, half Sameer: not clear enough.
        { cluster: 'c', startMs: 20_000, endMs: 24_000 },
        // Too short to be sure.
        { cluster: 'd', startMs: 40_000, endMs: 41_000 },
      ],
      signals,
    );
    expect(Object.fromEntries(names)).toEqual({ a: 'neha', b: 'sameer' });
  });
});

describe('transcriptChange', () => {
  it('is 0 for the same words and grows with corrections', () => {
    expect(transcriptChange(['Release Friday tak'], ['release, Friday tak!'])).toBe(0);
    const changed = transcriptChange(
      ['razor pay ka payment flow mein do bug hain'],
      ['Razorpay ka payment flow mein do bugs hain'],
    );
    expect(changed).toBeGreaterThan(0.2);
    expect(transcriptChange([], [])).toBe(0);
  });
});

describe('textSimilarity', () => {
  it('scores reworded action items', () => {
    expect(textSimilarity('Fix the refund bug', 'fix the refund bug.')).toBe(1);
    expect(textSimilarity('Fix the refund bug', 'Fix the refund bug by Friday')).toBeGreaterThan(
      0.6,
    );
    expect(textSimilarity('Fix the refund bug', 'Send the deck')).toBeLessThan(0.2);
  });
});
