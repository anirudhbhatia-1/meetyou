import type { PartTiming, VideoStore } from '@meetyou/video';
import { z } from 'zod';

import { isNotFound, type ObjectBucket } from './bucket.ts';
import {
  videoFileKey,
  videoFragmentKey,
  videoPartInfoKey,
  videoPrefix,
  type VideoFileName,
} from './layout.ts';

const PartInfo = z.object({
  partId: z.string().regex(/^vp_[0-9A-HJKMNP-TV-Z]{26}$/),
  mimeType: z.enum(['video/mp4', 'video/webm']),
  startMs: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().int().positive().optional(),
  fragments: z.number().int().nonnegative().optional(),
  stoppedAtMs: z.number().int().nonnegative().optional(),
});
export type VideoPartRecord = z.infer<typeof PartInfo>;

const FRAGMENT = /^([A-Za-z0-9_-]+)\/(\d+)\.frag$/;

/**
 * Video objects of a meeting (ADR-0011 §3.5) on any `ObjectBucket`: what `video.finalize` reads
 * and writes (VideoStore), plus the part timing the gateway records.
 */
export class ObjectVideoStore implements VideoStore {
  readonly #bucket: ObjectBucket;

  constructor(bucket: ObjectBucket) {
    this.#bucket = bucket;
  }

  async putVideoFragment(
    workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.#bucket.save(
      videoFragmentKey(workspaceId, meetingId, partId, index),
      bytes,
      contentType,
    );
  }

  async listVideo(
    workspaceId: string,
    meetingId: string,
  ): Promise<{ partId: string; indices: number[] }[]> {
    const prefix = videoPrefix(workspaceId, meetingId);
    const parts = new Map<string, number[]>();
    for (const { key } of await this.#bucket.list(prefix)) {
      const match = FRAGMENT.exec(key.slice(prefix.length));
      if (match?.[1] === undefined || match[2] === undefined) continue;
      parts.set(match[1], [...(parts.get(match[1]) ?? []), Number(match[2])]);
    }
    return [...parts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([partId, indices]) => ({ partId, indices: indices.sort((a, b) => a - b) }));
  }

  readVideoFragment(
    workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
  ): Promise<Uint8Array> {
    return this.#bucket.read(videoFragmentKey(workspaceId, meetingId, partId, index));
  }

  /** Merges started/stopped events (read, merge, write: one part has one writer, the gateway). */
  async putVideoPartInfo(
    workspaceId: string,
    meetingId: string,
    info: Partial<VideoPartRecord> & { partId: string },
  ): Promise<void> {
    const key = videoPartInfoKey(workspaceId, meetingId, info.partId);
    let previous: Record<string, unknown> = {};
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.#bucket.read(key);
    } catch (error: unknown) {
      // Only a missing file is the part's first event; a transient read error must not rewrite
      // part.json as a stub (finalize would then mistime the part — 2026-11-09 audit).
      if (!isNotFound(error)) throw error;
    }
    if (bytes !== null) {
      try {
        previous = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      } catch {
        // A corrupt file is replaced by the merged record.
      }
    }
    const merged = JSON.stringify({ ...previous, ...info });
    await this.#bucket.save(key, new TextEncoder().encode(merged), 'application/json');
  }

  async listVideoPartInfo(workspaceId: string, meetingId: string): Promise<PartTiming[]> {
    const prefix = videoPrefix(workspaceId, meetingId);
    const out: VideoPartRecord[] = [];
    for (const { key } of await this.#bucket.list(prefix)) {
      if (!key.endsWith('/part.json')) continue;
      try {
        const parsed = PartInfo.safeParse(
          JSON.parse(new TextDecoder().decode(await this.#bucket.read(key))),
        );
        if (parsed.success) out.push(parsed.data);
      } catch {
        // Unreadable timing: finalize places the part after the previous one.
      }
    }
    return out;
  }

  async putVideoFile(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
    sourcePath: string,
  ): Promise<{ storageKey: string; bytes: number }> {
    const key = videoFileKey(workspaceId, meetingId, name);
    await this.#bucket.uploadFile(
      key,
      sourcePath,
      name === 'poster.jpg' ? 'image/jpeg' : 'video/mp4',
    );
    const { stat } = await import('node:fs/promises');
    return { storageKey: key, bytes: (await stat(sourcePath)).size };
  }

  async videoFileSize(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
  ): Promise<number | null> {
    const key = videoFileKey(workspaceId, meetingId, name);
    const found = (await this.#bucket.list(key)).find((o) => o.key === key);
    return found === undefined ? null : found.size;
  }

  /** Fragments and part timing go; `playback.mp4` and `poster.jpg` stay. */
  async deleteVideoFragments(workspaceId: string, meetingId: string): Promise<void> {
    const prefix = videoPrefix(workspaceId, meetingId);
    for (const { key } of await this.#bucket.list(prefix)) {
      const rest = key.slice(prefix.length);
      if (rest.startsWith('vp_')) await this.#bucket.delete(key);
    }
  }
}
