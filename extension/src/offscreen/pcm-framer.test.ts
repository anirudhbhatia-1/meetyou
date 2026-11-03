import { describe, expect, it } from 'vitest';

import { captureMsFor, floatToPcm16, FRAME_SAMPLES, PcmFramer } from './pcm-framer.ts';

const QUANTUM = 128;

function quanta(count: number, channels: number, value: (i: number) => number): Float32Array[][] {
  return Array.from({ length: count }, (_, q) =>
    Array.from({ length: channels }, () =>
      Float32Array.from({ length: QUANTUM }, (_, i) => value(q * QUANTUM + i)),
    ),
  );
}

describe('floatToPcm16', () => {
  it('maps full scale to the PCM16 range and clamps overs', () => {
    expect(floatToPcm16(1)).toBe(32767);
    expect(floatToPcm16(-1)).toBe(-32768);
    expect(floatToPcm16(2)).toBe(32767);
    expect(floatToPcm16(-3)).toBe(-32768);
    expect(floatToPcm16(0)).toBe(0);
    expect(floatToPcm16(Number.NaN)).toBe(0);
  });
});

describe('PcmFramer', () => {
  it('emits 100 ms frames across render-quantum boundaries', () => {
    const framer = new PcmFramer();
    const frames = quanta(50, 1, () => 0.5).flatMap((q, n) =>
      framer.push(q, 1000 + n * QUANTUM, QUANTUM),
    );
    // 50 × 128 = 6400 samples = 4 frames of 1600.
    expect(frames).toHaveLength(4);
    expect(frames.map((f) => f.startFrame)).toEqual([1000, 2600, 4200, 5800]);
    for (const f of frames) {
      expect(f.pcm).toHaveLength(FRAME_SAMPLES);
      expect(f.pcm[0]).toBe(floatToPcm16(0.5));
      expect(f.levelDbfs).toBeCloseTo(-6.02, 1);
    }
  });

  it('downmixes channels by averaging', () => {
    const framer = new PcmFramer(QUANTUM);
    const left = new Float32Array(QUANTUM).fill(1);
    const right = new Float32Array(QUANTUM).fill(0);
    const [frame] = framer.push([left, right], 0, QUANTUM);
    expect(frame?.pcm[0]).toBe(floatToPcm16(0.5));
  });

  it('treats a missing input as silence so the lane clock keeps running', () => {
    const framer = new PcmFramer(QUANTUM);
    const [frame] = framer.push([], 256, QUANTUM);
    expect(frame?.startFrame).toBe(256);
    expect(frame?.pcm.every((s) => s === 0)).toBe(true);
  });

  it('keeps the exact order of samples', () => {
    const framer = new PcmFramer();
    const frames = quanta(13, 1, (i) => (i % 1000) / 1000).flatMap((q, n) =>
      framer.push(q, n * QUANTUM, QUANTUM),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]?.pcm[999]).toBe(floatToPcm16(0.999));
    expect(frames[0]?.pcm[1000]).toBe(0);
  });
});

describe('captureMsFor', () => {
  it('places frames on the session clock in ms at 16 kHz', () => {
    expect(captureMsFor(16_000, 0)).toBe(1000);
    expect(captureMsFor(1600 + 48_000, 48_000)).toBe(100);
    expect(captureMsFor(10, 100)).toBe(0);
  });
});
