import type { Lane } from '@meetyou/contracts';
import {
  audioPrefix,
  DEFAULT_PRE_SKIP,
  OggOpusWriter,
  readOggOpusPackets,
  type ObjectBucket,
} from '@meetyou/storage';
import { z } from 'zod';

/** Stored chunk manifest (gateway `chunk-store.ts`): one entry per client frame. */
const Manifest = z.object({
  codec: z.enum(['pcm16', 'opus']),
  firstSeq: z.number().int().nonnegative(),
  frames: z.array(
    z.object({
      seq: z.number().int(),
      captureMs: z.number().int(),
      durationMs: z.number().int().optional(),
    }),
  ),
});

/** Opus packets are 20 ms (ADR-0003). */
const PACKET_MS = 20;

/** One stretch of the joined file and where it sits on the session clock. */
interface Span {
  fileMs: number;
  sessionMs: number;
  durationMs: number;
}

/**
 * Maps times in the joined file back to the session clock (ARCHITECTURE §5.5). The file has no
 * silence for gaps (pause, mute gating, reconnects), so each frame keeps its own capture time.
 */
export class TimeMap {
  readonly #spans: Span[];

  constructor(spans: Span[]) {
    this.#spans = spans;
  }

  /** Contiguous stretches merged (one per pause or reconnect), small enough to send to a player. */
  runs(): Span[] {
    const out: Span[] = [];
    for (const span of this.#spans) {
      const last = out.at(-1);
      if (
        last !== undefined &&
        Math.abs(last.fileMs + last.durationMs - span.fileMs) < 1 &&
        Math.abs(last.sessionMs + last.durationMs - span.sessionMs) < 1
      ) {
        last.durationMs += span.durationMs;
      } else {
        out.push({ ...span });
      }
    }
    return out;
  }

  get durationMs(): number {
    const last = this.#spans.at(-1);
    return last === undefined ? 0 : last.fileMs + last.durationMs;
  }

  toSession(fileMs: number): number {
    let lo = 0;
    let hi = this.#spans.length - 1;
    if (hi < 0) return fileMs;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.#spans[mid]?.fileMs ?? 0) <= fileMs) lo = mid;
      else hi = mid - 1;
    }
    const span = this.#spans[lo];
    if (span === undefined) return fileMs;
    return span.sessionMs + Math.max(0, Math.min(fileMs - span.fileMs, span.durationMs));
  }
}

export interface LaneAudio {
  ogg: Uint8Array;
  timeMap: TimeMap;
}

/**
 * One Ogg Opus file per lane from the stored chunks (S3-04 batch pass), re-wrapped without
 * decoding, plus the map from file time to session time. Null when the lane has no Opus audio
 * (PCM test sessions, or retention already deleted it).
 */
export async function joinLaneAudio(
  bucket: ObjectBucket,
  workspaceId: string,
  meetingId: string,
  lane: Lane,
): Promise<LaneAudio | null> {
  const objects = await bucket.list(audioPrefix(workspaceId, meetingId, lane));
  const manifests = objects.filter((o) => o.key.endsWith('.json'));
  const spans: Span[] = [];
  const packets: Uint8Array[] = [];
  let firstSeq: number | null = null;
  for (const { key } of manifests) {
    const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(await bucket.read(key))));
    if (manifest.codec !== 'opus') return null;
    const chunkPackets = readOggOpusPackets(await bucket.read(key.replace(/\.json$/, '.opus')));
    if (chunkPackets.length === 0 || manifest.frames.length === 0) continue;
    firstSeq ??= manifest.firstSeq;
    const chunkMs = chunkPackets.length * PACKET_MS;
    const even = chunkMs / manifest.frames.length;
    let fileMs = packets.length * PACKET_MS;
    for (const frame of manifest.frames) {
      const durationMs = frame.durationMs ?? even;
      spans.push({ fileMs, sessionMs: frame.captureMs, durationMs });
      fileMs += durationMs;
    }
    packets.push(...chunkPackets);
  }
  if (packets.length === 0) return null;
  // Only the encoder's first packets carry its lookahead (gateway `preSkipFor`).
  const writer = new OggOpusWriter({
    serial: 0x6d657479,
    preSkip: firstSeq === 0 ? DEFAULT_PRE_SKIP : 0,
  });
  const head = writer.headers();
  const body = writer.packets(packets, true);
  const ogg = new Uint8Array(head.length + body.length);
  ogg.set(head, 0);
  ogg.set(body, head.length);
  return { ogg, timeMap: new TimeMap(spans) };
}
