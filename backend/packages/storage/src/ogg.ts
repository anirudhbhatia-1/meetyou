/**
 * Minimal Ogg Opus muxer (RFC 3533 pages, RFC 7845 Opus mapping) so the gateway can store and
 * stream the client's Opus packets without decoding them (ADR-0003, 2026-11-04).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

/** Ogg's CRC-32: polynomial 0x04C11DB7, initial value 0, no reflection, no final XOR. */
export function oggCrc32(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ b) & 0xff] ?? 0)) >>> 0;
  return crc;
}

const HEADER_BOS = 0x02;
const HEADER_EOS = 0x04;
/** Granule positions count 48 kHz samples whatever the input rate (RFC 7845 §4). */
const SAMPLES_PER_20MS = 960;
/** libopus encoder lookahead at 48 kHz; what ffmpeg writes too. WebCodecs does not expose it. */
export const DEFAULT_PRE_SKIP = 312;
const MAX_SEGMENTS = 255;

function page(
  serial: number,
  sequence: number,
  granule: bigint,
  flags: number,
  packets: readonly Uint8Array[],
): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    for (let n = p.byteLength; ; n -= 255) {
      lacing.push(Math.min(n, 255));
      if (n < 255) break;
    }
  }
  if (lacing.length > MAX_SEGMENTS) throw new RangeError('Too many segments for one Ogg page');
  const bodySize = packets.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(27 + lacing.length + bodySize);
  const view = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  out[4] = 0;
  out[5] = flags;
  view.setBigUint64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const p of packets) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  view.setUint32(22, oggCrc32(out), true);
  return out;
}

function opusHead(inputSampleRate: number, preSkip: number): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode('OpusHead'), 0);
  head[8] = 1; // version
  head[9] = 1; // mono
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputSampleRate, true);
  view.setInt16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family 0
  return head;
}

function opusTags(vendor: string): Uint8Array {
  const vendorBytes = new TextEncoder().encode(vendor);
  const tags = new Uint8Array(8 + 4 + vendorBytes.byteLength + 4);
  const view = new DataView(tags.buffer);
  tags.set(new TextEncoder().encode('OpusTags'), 0);
  view.setUint32(8, vendorBytes.byteLength, true);
  tags.set(vendorBytes, 12);
  view.setUint32(12 + vendorBytes.byteLength, 0, true); // no user comments
  return tags;
}

export interface OggOpusOptions {
  serial: number;
  inputSampleRate?: number;
  preSkip?: number;
  vendor?: string;
}

/**
 * One logical Ogg Opus stream written incrementally: `headers()` first, then `packets()` per
 * batch of 20 ms packets, `end()` last (or never, for a live stream that just stops).
 */
export class OggOpusWriter {
  readonly #serial: number;
  readonly #rate: number;
  readonly #preSkip: number;
  readonly #vendor: string;
  #sequence = 0;
  #granule = 0n;

  constructor(options: OggOpusOptions) {
    this.#serial = options.serial >>> 0;
    this.#rate = options.inputSampleRate ?? 16000;
    this.#preSkip = options.preSkip ?? DEFAULT_PRE_SKIP;
    this.#vendor = options.vendor ?? 'meetyou-gateway';
  }

  headers(): Uint8Array {
    const head = page(this.#serial, this.#sequence++, 0n, HEADER_BOS, [
      opusHead(this.#rate, this.#preSkip),
    ]);
    const tags = page(this.#serial, this.#sequence++, 0n, 0, [opusTags(this.#vendor)]);
    return concat([head, tags]);
  }

  /** Pages for these packets (each 20 ms), split so no page exceeds 255 segments. */
  packets(packets: readonly Uint8Array[], last = false): Uint8Array {
    const pages: Uint8Array[] = [];
    let batch: Uint8Array[] = [];
    let segments = 0;
    const flush = (eos: boolean) => {
      this.#granule += BigInt(batch.length * SAMPLES_PER_20MS);
      pages.push(page(this.#serial, this.#sequence++, this.#granule, eos ? HEADER_EOS : 0, batch));
      batch = [];
      segments = 0;
    };
    for (const p of packets) {
      const needed = Math.floor(p.byteLength / 255) + 1;
      if (segments + needed > MAX_SEGMENTS) flush(false);
      batch.push(p);
      segments += needed;
    }
    if (batch.length > 0 || last) flush(last);
    return concat(pages);
  }
}

/** A complete standalone .opus file for a stored chunk. */
export function oggOpusFile(packets: readonly Uint8Array[], options: OggOpusOptions): Uint8Array {
  const writer = new OggOpusWriter(options);
  return concat([writer.headers(), writer.packets(packets, true)]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/**
 * Audio packets of an Ogg Opus file (header packets skipped), for tools that re-wrap Opus encoded
 * elsewhere. Assumes one logical stream, as written by ffmpeg or `oggOpusFile`.
 */
export function readOggOpusPackets(bytes: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let partial: Uint8Array[] = [];
  let index = 0;
  let offset = 0;
  while (offset + 27 <= bytes.byteLength) {
    const segments = bytes[offset + 26] ?? 0;
    const lacing = bytes.subarray(offset + 27, offset + 27 + segments);
    let body = offset + 27 + segments;
    for (const size of lacing) {
      partial.push(bytes.subarray(body, body + size));
      body += size;
      if (size < 255) {
        if (index >= 2) packets.push(concat(partial));
        index += 1;
        partial = [];
      }
    }
    offset = body;
  }
  return packets;
}
