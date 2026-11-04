import { describe, expect, it } from 'vitest';

import { OPUS_ENCODER_CONFIG, OpusFrameGrouper } from './opus-encoder.ts';

const packet = (n: number) => new Uint8Array([n]);

describe('OpusFrameGrouper', () => {
  it('groups five consecutive 20 ms packets into one 100 ms frame', () => {
    const g = new OpusFrameGrouper();
    const out = Array.from({ length: 10 }, (_, i) => g.push(packet(i), i * 20_000, 20_000)).flat();
    expect(out.map((f) => [f.captureMs, f.durationMs, f.packets.length])).toEqual([
      [0, 100, 5],
      [100, 100, 5],
    ]);
    expect(g.flush()).toEqual([]);
  });

  it('closes a frame early at a pause so session times stay exact', () => {
    const g = new OpusFrameGrouper();
    const before = [0, 20_000, 40_000].flatMap((t, i) => g.push(packet(i), t, 20_000));
    expect(before).toEqual([]);
    const atResume = g.push(packet(9), 5_000_000, 20_000); // resumed 5 s later
    expect(atResume.map((f) => [f.captureMs, f.durationMs, f.packets.length])).toEqual([
      [0, 60, 3],
    ]);
    expect(g.flush().map((f) => [f.captureMs, f.durationMs])).toEqual([[5000, 20]]);
  });

  it('tolerates small timestamp rounding between packets', () => {
    const g = new OpusFrameGrouper();
    const out = [0, 20_001, 39_999, 60_000, 80_002].flatMap((t, i) => g.push(packet(i), t, 20_000));
    expect(out).toHaveLength(1);
    expect(out[0]?.packets).toHaveLength(5);
  });
});

describe('OPUS_ENCODER_CONFIG', () => {
  it('matches ADR-0003: 24 kbps mono 16 kHz, 20 ms raw Opus packets', () => {
    expect(OPUS_ENCODER_CONFIG).toMatchObject({
      codec: 'opus',
      sampleRate: 16000,
      numberOfChannels: 1,
      bitrate: 24_000,
      opus: { format: 'opus', frameDuration: 20_000 },
    });
  });
});
