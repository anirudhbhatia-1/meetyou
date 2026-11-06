import { newUlid, type Lane, type Segment } from '@meetyou/contracts';
import {
  audioChunkBase,
  audioPrefix,
  ObjectVideoStore,
  segmentsKey,
  usageKey,
  type ObjectBucket,
} from '@meetyou/storage';
import type { z } from 'zod';

import {
  Manifest,
  type AudioChunk,
  type ChunkStore,
  type VideoFileName,
  type VideoFragment,
  type VideoPartInfo,
} from './chunk-store.ts';
import type { SessionUsage } from './usage.ts';

const CONTENT_TYPE: Record<AudioChunk['codec'], string> = {
  opus: 'audio/ogg',
  pcm16: 'application/octet-stream',
};

/**
 * Cloud Storage chunk store for staging and production (S2-04), same layout as the local store
 * (ARCHITECTURE §11.4). A completed object write is durable and immediately visible to every
 * reader (Cloud Storage is strongly consistent), so the manifest written after the audio is the
 * commit marker behind an ack, as on disk.
 */
export class GcsChunkStore implements ChunkStore {
  readonly #bucket: ObjectBucket;
  readonly #video: ObjectVideoStore;

  constructor(bucket: ObjectBucket) {
    this.#bucket = bucket;
    this.#video = new ObjectVideoStore(bucket);
  }

  async put(chunk: AudioChunk): Promise<void> {
    const first = chunk.frames[0];
    const last = chunk.frames.at(-1);
    if (first === undefined || last === undefined) throw new Error('empty chunk');
    const base = audioChunkBase(chunk.workspaceId, chunk.meetingId, chunk.lane, first.captureMs);
    await this.#bucket.save(`${base}.${chunk.codec}`, chunk.audio, CONTENT_TYPE[chunk.codec]);
    const manifest: z.infer<typeof Manifest> = {
      codec: chunk.codec,
      firstSeq: first.seq,
      lastSeq: last.seq,
      frames: chunk.frames,
    };
    await this.#bucket.save(
      `${base}.json`,
      new TextEncoder().encode(JSON.stringify(manifest)),
      'application/json',
    );
  }

  /**
   * Chunks are written in sequence order and named by start time, so the newest manifest holds
   * the highest durable seq: one read per lane instead of one per chunk (a 2-hour meeting has
   * ~720 per lane). Listing returns names only.
   */
  async durableUpTo(workspaceId: string, meetingId: string): Promise<Record<Lane, number>> {
    const out: Record<Lane, number> = { me: -1, them: -1 };
    for (const lane of ['me', 'them'] as const) {
      const manifests = (await this.#bucket.list(audioPrefix(workspaceId, meetingId, lane))).filter(
        (o) => o.key.endsWith('.json'),
      );
      const newest = manifests.at(-1);
      if (newest === undefined) continue;
      const manifest = Manifest.parse(
        JSON.parse(new TextDecoder().decode(await this.#bucket.read(newest.key))),
      );
      out[lane] = manifest.lastSeq;
    }
    return out;
  }

  async putUsage(usage: SessionUsage, meetingId = usage.sessionId): Promise<void> {
    await this.#bucket.save(
      usageKey(usage.workspaceId, meetingId),
      new TextEncoder().encode(JSON.stringify(usage)),
      'application/json',
    );
  }

  /** Objects cannot be appended to: each batch is its own object, named in time order. */
  async appendSegments(
    workspaceId: string,
    meetingId: string,
    segments: readonly Segment[],
  ): Promise<void> {
    if (segments.length === 0) return;
    await this.#bucket.save(
      segmentsKey(workspaceId, meetingId, newUlid()),
      new TextEncoder().encode(segments.map((s) => `${JSON.stringify(s)}\n`).join('')),
      'application/x-ndjson',
    );
  }

  putVideoFragment(fragment: VideoFragment): Promise<void> {
    return this.#video.putVideoFragment(
      fragment.workspaceId,
      fragment.meetingId,
      fragment.partId,
      fragment.index,
      fragment.bytes,
      'application/octet-stream',
    );
  }

  putVideoPartInfo(
    workspaceId: string,
    meetingId: string,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void> {
    return this.#video.putVideoPartInfo(workspaceId, meetingId, info);
  }

  listVideoPartInfo(workspaceId: string, meetingId: string): Promise<VideoPartInfo[]> {
    return this.#video.listVideoPartInfo(workspaceId, meetingId) as Promise<VideoPartInfo[]>;
  }

  listVideo(workspaceId: string, meetingId: string) {
    return this.#video.listVideo(workspaceId, meetingId);
  }

  readVideoFragment(
    workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
  ): Promise<Uint8Array> {
    return this.#video.readVideoFragment(workspaceId, meetingId, partId, index);
  }

  putVideoFile(workspaceId: string, meetingId: string, name: VideoFileName, sourcePath: string) {
    return this.#video.putVideoFile(workspaceId, meetingId, name, sourcePath);
  }

  /** No local file: deployed clients get signed URLs from the API (`GET /meetings/{id}/video`). */
  videoFile(): Promise<{ path: string; bytes: number } | null> {
    return Promise.resolve(null);
  }

  deleteVideoFragments(workspaceId: string, meetingId: string): Promise<void> {
    return this.#video.deleteVideoFragments(workspaceId, meetingId);
  }
}
