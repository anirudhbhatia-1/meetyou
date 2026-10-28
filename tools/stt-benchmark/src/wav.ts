import { readFileSync } from 'node:fs';

export interface PcmAudio {
  sampleRate: number;
  channels: number;
  /** Raw little-endian PCM16 bytes. */
  data: Buffer;
  durationMs: number;
}

/**
 * Reads a PCM16 WAV file. Prepare inputs with:
 *   ffmpeg -i in.wav -ac 1 -ar 16000 -c:a pcm_s16le out.wav
 */
export function parseWav(buf: Buffer): PcmAudio {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      if (fmt.format !== 1 || fmt.bits !== 16) {
        throw new Error(
          `Expected PCM16 (format 1, 16-bit), got format ${fmt.format}, ${fmt.bits}-bit`,
        );
      }
      const data = buf.subarray(body, Math.min(body + size, buf.length));
      const bytesPerSecond = fmt.sampleRate * fmt.channels * 2;
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        data,
        durationMs: Math.round((data.length / bytesPerSecond) * 1000),
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('No data chunk found');
}

export function readWav(path: string): PcmAudio {
  return parseWav(readFileSync(path));
}

/** Ensures the benchmark's input format: 16 kHz mono PCM16. */
export function assertSpeechFormat(audio: PcmAudio, path: string): void {
  if (audio.sampleRate !== 16000 || audio.channels !== 1) {
    throw new Error(
      `${path}: expected 16 kHz mono, got ${audio.sampleRate} Hz × ${audio.channels}. ` +
        'Convert with: ffmpeg -i in.wav -ac 1 -ar 16000 -c:a pcm_s16le out.wav',
    );
  }
}

/** Builds a PCM16 WAV buffer (used by tests and for sending WAV bodies to batch APIs). */
export function buildWav(pcm: Buffer, sampleRate = 16000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
