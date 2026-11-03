import { describe, expect, it } from 'vitest';

import { rmsDbfs, SILENCE_DBFS } from './levels.ts';

describe('rmsDbfs', () => {
  it('reports the floor for silence and empty blocks', () => {
    expect(rmsDbfs(new Float32Array(128))).toBe(SILENCE_DBFS);
    expect(rmsDbfs(new Float32Array(0))).toBe(SILENCE_DBFS);
  });

  it('reports 0 dBFS for a full-scale square wave', () => {
    const square = Float32Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    expect(rmsDbfs(square)).toBeCloseTo(0, 6);
  });

  it('reports about -3 dBFS for a full-scale sine', () => {
    const sine = Float32Array.from({ length: 1600 }, (_, i) => Math.sin((2 * Math.PI * i) / 16));
    expect(rmsDbfs(sine)).toBeCloseTo(-3.01, 1);
  });
});
