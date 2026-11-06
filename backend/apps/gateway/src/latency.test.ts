import { describe, expect, it } from 'vitest';

import { LatencyHistogram } from './latency.ts';
import { StreamTimeline } from './timeline.ts';

describe('latency histogram (ARCHITECTURE §20)', () => {
  it('reports percentiles as bucket upper edges, capped at the max seen', () => {
    const h = new LatencyHistogram();
    expect(h.percentile(95)).toBeUndefined();
    for (let i = 0; i < 90; i += 1) h.add(120);
    for (let i = 0; i < 10; i += 1) h.add(2_400);
    expect(h.count).toBe(100);
    expect(h.percentile(50)).toBe(200);
    expect(h.percentile(95)).toBe(2_400);
  });

  it('ignores negative and non-finite samples', () => {
    const h = new LatencyHistogram();
    h.add(-5);
    h.add(Number.NaN);
    expect(h.count).toBe(0);
  });
});

describe('StreamTimeline.sentAt', () => {
  it('returns when the audio ending at a time was sent, across a pause', () => {
    const t = new StreamTimeline();
    t.sent(0, 100, 1_000);
    t.sent(100, 100, 1_100);
    t.sent(5_000, 100, 6_000); // a pause on the session clock; stream audio stays contiguous
    expect(t.sentAt(150)).toBe(1_100);
    expect(t.sentAt(300)).toBe(6_000);
    expect(t.sentAt(10_000)).toBe(6_000);
  });

  it('forgets audio older than about two minutes', () => {
    const t = new StreamTimeline();
    for (let i = 0; i < 1_300; i += 1) t.sent(i * 100, 100, i * 100);
    expect(t.sentAt(1_000)).toBeUndefined();
    expect(t.sentAt(129_000)).toBe(128_900);
  });
});
