import { describe, expect, it } from 'vitest';

import { oggCrc32, oggOpusFile, OggOpusWriter, readOggOpusPackets } from './ogg.ts';

// First page (OpusHead) of a file ffmpeg wrote for a synthetic 440 Hz tone:
// `ffmpeg -f lavfi -i sine=frequency=440:duration=2 -ar 16000 -ac 1 -c:a libopus -b:a 24k
//  -application voip -frame_duration 20 sine.opus`. Header only; no audio.
const FFMPEG_OPUS_HEAD_PAGE =
  '4f67675300020000000000000000d17649c80000000087d034b401134f7075734865616401013801803e0000000000';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'hex'));
}

/** Reads pages back: [flags, granule, sequence, packets, crcOk]. */
function readPages(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const nseg = bytes[offset + 26] ?? 0;
    const lacing = [...bytes.subarray(offset + 27, offset + 27 + nseg)];
    const size = 27 + nseg + lacing.reduce((a, b) => a + b, 0);
    const raw = bytes.slice(offset, offset + size);
    const stored = new DataView(raw.buffer).getUint32(22, true);
    raw.fill(0, 22, 26);
    const packets: number[] = [];
    let current = 0;
    for (const l of lacing) {
      current += l;
      if (l < 255) {
        packets.push(current);
        current = 0;
      }
    }
    pages.push({
      flags: bytes[offset + 5],
      granule: view.getBigUint64(offset + 6, true),
      sequence: view.getUint32(offset + 18, true),
      packets,
      crcOk: oggCrc32(raw) === stored,
    });
    offset += size;
  }
  return pages;
}

describe('Ogg Opus writer', () => {
  it('writes the same OpusHead page as ffmpeg, CRC included', () => {
    const writer = new OggOpusWriter({ serial: 0xc84976d1, inputSampleRate: 16000, preSkip: 312 });
    const firstPage = writer.headers().subarray(0, FFMPEG_OPUS_HEAD_PAGE.length / 2);
    expect(hex(firstPage)).toBe(FFMPEG_OPUS_HEAD_PAGE);
    const ffmpeg = fromHex(FFMPEG_OPUS_HEAD_PAGE);
    expect(readPages(ffmpeg)[0]?.crcOk).toBe(true);
  });

  it('counts granules in 48 kHz samples and marks the stream boundaries', () => {
    const packets = Array.from({ length: 7 }, (_, i) => new Uint8Array(60).fill(i));
    const pages = readPages(oggOpusFile(packets, { serial: 1 }));
    expect(pages.map((p) => p.flags)).toEqual([2, 0, 4]);
    expect(pages[2]?.granule).toBe(7n * 960n);
    expect(pages[2]?.packets).toEqual(Array(7).fill(60));
    expect(pages.map((p) => p.sequence)).toEqual([0, 1, 2]);
    expect(pages.every((p) => p.crcOk)).toBe(true);
  });

  it('splits large batches so no page has more than 255 segments', () => {
    const packets = Array.from({ length: 300 }, () => new Uint8Array(300)); // 2 segments each
    const pages = readPages(oggOpusFile(packets, { serial: 2 })).slice(2);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.reduce((n, p) => n + p.packets.length, 0)).toBe(300);
    expect(pages.at(-1)?.granule).toBe(300n * 960n);
  });

  it('reads back the audio packets it wrote', () => {
    const packets = Array.from({ length: 12 }, (_, i) => new Uint8Array(70 + i).fill(i));
    expect(readOggOpusPackets(oggOpusFile(packets, { serial: 3 }))).toEqual(packets);
  });
});
