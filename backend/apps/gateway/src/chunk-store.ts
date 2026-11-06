import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Lane, Segment } from '@meetyou/contracts';
import { z } from 'zod';

import { errorCode, log } from './log.ts';
import type { SessionUsage } from './usage.ts';

export interface ChunkFrame {
  seq: number;
  captureMs: number;
  durationMs: number;
}

export interface AudioChunk {
  workspaceId: string;
  meetingId: string;
  lane: Lane;
  frames: ChunkFrame[];
  /** Concatenated payloads of `frames`, in order. */
  audio: Uint8Array;
  codec: 'pcm16' | 'opus';
}

/** One 10 s video fragment (ADR-0011 §3.3), stored until `video.finalize` (S2-14). */
export interface VideoFragment {
  workspaceId: string;
  meetingId: string;
  partId: string;
  index: number;
  bytes: Uint8Array;
}

/**
 * Durable audio chunks (ARCHITECTURE §6.1 step 2). `put` resolves only once the chunk survives a
 * crash, because the gateway acknowledges frames on that promise (§5.3).
 */
/** Timing of one video part (ADR-0011 §3.4), from the extension's part events. */
export const VideoPartInfo = z.object({
  partId: z.string().regex(/^vp_[0-9A-HJKMNP-TV-Z]{26}$/),
  mimeType: z.enum(['video/mp4', 'video/webm']),
  /** Session-clock start (ARCHITECTURE §5.5). */
  startMs: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().int().positive().optional(),
  /** Set when the part stopped: fragments 0..n-1 exist on the client. */
  fragments: z.number().int().nonnegative().optional(),
  stoppedAtMs: z.number().int().nonnegative().optional(),
});
export type VideoPartInfo = z.infer<typeof VideoPartInfo>;

export type VideoFileName = 'playback.mp4' | 'poster.jpg';

export interface ChunkStore {
  put(chunk: AudioChunk): Promise<void>;
  /** Highest durable seq per lane for a meeting; -1 when nothing is stored. */
  durableUpTo(workspaceId: string, meetingId: string): Promise<Record<Lane, number>>;
  /** Usage counts for cost tracking (AGENTS §3 rule 10); overwrites the previous snapshot. */
  /** Written next to the meeting's audio (`meetingId` defaults to the session ID). */
  putUsage(usage: SessionUsage, meetingId?: string): Promise<void>;
  /**
   * Final segments without a database (local dev): appended in order to `segments.jsonl` next to
   * the audio. With `DATABASE_URL` set they go to `transcript_segments` instead (sinks.ts).
   */
  appendSegments(
    workspaceId: string,
    meetingId: string,
    segments: readonly Segment[],
  ): Promise<void>;
  /** Overwrites the same fragment on a retry (idempotent, like a signed PUT to Cloud Storage). */
  putVideoFragment(fragment: VideoFragment): Promise<void>;
  /** Merges part timing into `video/{partId}/part.json` (started, then stopped). */
  putVideoPartInfo(
    workspaceId: string,
    meetingId: string,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void>;
  listVideoPartInfo(workspaceId: string, meetingId: string): Promise<VideoPartInfo[]>;
  /** `video.finalize` output (ADR-0011 §3.5): `video/playback.mp4` and `video/poster.jpg`. */
  putVideoFile(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
    sourcePath: string,
  ): Promise<{ storageKey: string; bytes: number }>;
  /** Local path and size of a finalized file, or null; Cloud Storage serves signed URLs instead. */
  videoFile(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
  ): Promise<{ path: string; bytes: number } | null>;
  /** Deletes the temporary fragments (and part timing) once the playback file is stored. */
  deleteVideoFragments(workspaceId: string, meetingId: string): Promise<void>;
  /** Stored video parts of a meeting with their fragment indices, ascending. */
  listVideo(
    workspaceId: string,
    meetingId: string,
  ): Promise<{ partId: string; indices: number[] }[]>;
  readVideoFragment(
    workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
  ): Promise<Uint8Array>;
}

export const Manifest = z.object({
  codec: z.enum(['pcm16', 'opus']),
  firstSeq: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
  frames: z.array(
    z.object({
      seq: z.number().int(),
      captureMs: z.number().int(),
      durationMs: z.number().int().optional(),
    }),
  ),
});

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Local-disk store for development, laid out like Cloud Storage (ARCHITECTURE §11.4):
 * `ws/{workspaceId}/meetings/{meetingId}/audio/{lane}/{chunkStartMs}.{codec}` plus a `.json`
 * manifest written last as the commit marker. Each file is fsynced before its rename.
 * Deployed gateways use `GcsChunkStore` (same layout, Cloud Storage).
 */
export class LocalChunkStore implements ChunkStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #meetingDir(workspaceId: string, meetingId: string): string {
    if (!ID.test(workspaceId) || !ID.test(meetingId)) throw new Error('invalid storage id');
    return join(this.#root, 'ws', workspaceId, 'meetings', meetingId);
  }

  #laneDir(workspaceId: string, meetingId: string, lane: Lane): string {
    return join(this.#meetingDir(workspaceId, meetingId), 'audio', lane);
  }

  async putUsage(usage: SessionUsage, meetingId = usage.sessionId): Promise<void> {
    const path = join(this.#meetingDir(usage.workspaceId, meetingId), 'usage.json');
    await mkdir(dirname(path), { recursive: true });
    await writeDurably(path, new TextEncoder().encode(JSON.stringify(usage, null, 2)));
  }

  async appendSegments(
    workspaceId: string,
    meetingId: string,
    segments: readonly Segment[],
  ): Promise<void> {
    if (segments.length === 0) return;
    const path = join(this.#meetingDir(workspaceId, meetingId), 'segments.jsonl');
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'a');
    try {
      await handle.writeFile(segments.map((s) => `${JSON.stringify(s)}\n`).join(''));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  #videoFilePath(workspaceId: string, meetingId: string, name: VideoFileName): string {
    return join(this.#meetingDir(workspaceId, meetingId), 'video', name);
  }

  async putVideoFile(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
    sourcePath: string,
  ): Promise<{ storageKey: string; bytes: number }> {
    const path = this.#videoFilePath(workspaceId, meetingId, name);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await copyFile(sourcePath, tmp);
    const handle = await open(tmp, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
    return {
      storageKey: `ws/${workspaceId}/meetings/${meetingId}/video/${name}`,
      bytes: (await stat(path)).size,
    };
  }

  async videoFile(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
  ): Promise<{ path: string; bytes: number } | null> {
    const path = this.#videoFilePath(workspaceId, meetingId, name);
    try {
      return { path, bytes: (await stat(path)).size };
    } catch {
      return null;
    }
  }

  async deleteVideoFragments(workspaceId: string, meetingId: string): Promise<void> {
    const dir = join(this.#meetingDir(workspaceId, meetingId), 'video');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    // Part directories only; playback.mp4 and poster.jpg stay.
    for (const name of names.filter((n) => n.startsWith('vp_') && ID.test(n))) {
      await rm(join(dir, name), { recursive: true, force: true });
    }
  }

  async putVideoPartInfo(
    workspaceId: string,
    meetingId: string,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void> {
    if (!ID.test(info.partId)) throw new Error('invalid video part id');
    const path = join(this.#meetingDir(workspaceId, meetingId), 'video', info.partId, 'part.json');
    await mkdir(dirname(path), { recursive: true });
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    } catch {
      // First event of the part.
    }
    await writeDurably(path, new TextEncoder().encode(JSON.stringify({ ...previous, ...info })));
  }

  async listVideoPartInfo(workspaceId: string, meetingId: string): Promise<VideoPartInfo[]> {
    const dir = join(this.#meetingDir(workspaceId, meetingId), 'video');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: VideoPartInfo[] = [];
    for (const name of names.filter((n) => ID.test(n)).sort()) {
      try {
        const parsed = VideoPartInfo.safeParse(
          JSON.parse(await readFile(join(dir, name, 'part.json'), 'utf8')),
        );
        if (parsed.success) out.push(parsed.data);
      } catch {
        // A part without timing (older recording, or the event never arrived).
      }
    }
    return out;
  }

  async putVideoFragment(fragment: VideoFragment): Promise<void> {
    if (!ID.test(fragment.partId) || !Number.isInteger(fragment.index) || fragment.index < 0) {
      throw new Error('invalid video fragment id');
    }
    const path = join(
      this.#meetingDir(fragment.workspaceId, fragment.meetingId),
      'video',
      fragment.partId,
      `${fragment.index}.frag`,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeDurably(path, fragment.bytes);
  }

  async listVideo(
    workspaceId: string,
    meetingId: string,
  ): Promise<{ partId: string; indices: number[] }[]> {
    const dir = join(this.#meetingDir(workspaceId, meetingId), 'video');
    let parts: string[];
    try {
      parts = (await readdir(dir)).filter((name) => /^vp_[0-9A-HJKMNP-TV-Z]{26}$/.test(name));
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }
    const out: { partId: string; indices: number[] }[] = [];
    for (const partId of parts.sort()) {
      const indices = (await readdir(join(dir, partId)))
        .filter((name) => /^\d+\.frag$/.test(name))
        .map((name) => Number.parseInt(name, 10))
        .sort((a, b) => a - b);
      out.push({ partId, indices });
    }
    return out;
  }

  async readVideoFragment(
    workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
  ): Promise<Uint8Array> {
    if (!ID.test(partId) || !Number.isInteger(index) || index < 0) {
      throw new Error('invalid video fragment id');
    }
    const path = join(this.#meetingDir(workspaceId, meetingId), 'video', partId, `${index}.frag`);
    return new Uint8Array(await readFile(path));
  }

  async put(chunk: AudioChunk): Promise<void> {
    const first = chunk.frames[0];
    const last = chunk.frames.at(-1);
    if (first === undefined || last === undefined) throw new Error('empty chunk');
    const base = join(
      this.#laneDir(chunk.workspaceId, chunk.meetingId, chunk.lane),
      String(first.captureMs).padStart(10, '0'),
    );
    await mkdir(dirname(base), { recursive: true });
    await writeDurably(`${base}.${chunk.codec}`, chunk.audio);
    const manifest: z.infer<typeof Manifest> = {
      codec: chunk.codec,
      firstSeq: first.seq,
      lastSeq: last.seq,
      frames: chunk.frames,
    };
    await writeDurably(`${base}.json`, new TextEncoder().encode(JSON.stringify(manifest)));
  }

  async durableUpTo(workspaceId: string, meetingId: string): Promise<Record<Lane, number>> {
    const out: Record<Lane, number> = { me: -1, them: -1 };
    for (const lane of ['me', 'them'] as const) {
      const dir = this.#laneDir(workspaceId, meetingId, lane);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error: unknown) {
        if ((error as { code?: string }).code === 'ENOENT') continue;
        throw error;
      }
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        const manifest = Manifest.parse(JSON.parse(await readFile(join(dir, name), 'utf8')));
        out[lane] = Math.max(out[lane], manifest.lastSeq);
      }
    }
    return out;
  }
}

/**
 * Write to a unique temp file, fsync it, rename it into place, then fsync the directory so the
 * rename itself survives a power loss (the `.json` manifest is the commit marker behind an ack).
 * Unique temp names keep concurrent writers of one path (usage.json, a retried PUT) apart.
 */
async function writeDurably(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
  // On POSIX, fsync the directory to persist the rename. On Windows, directory fsync throws EPERM.
  if (process.platform !== 'win32') {
    try {
      const dir = await open(dirname(path), 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (error: unknown) {
      // The file itself is synced; a failed directory sync weakens crash safety, so say so.
      log('chunk.dir_sync_failed', { code: errorCode(error) });
    }
  }
}

/** In-memory store for tests. */
export class MemoryChunkStore implements ChunkStore {
  readonly chunks: AudioChunk[] = [];
  readonly usage = new Map<string, SessionUsage>();
  readonly videoFragments = new Map<string, VideoFragment>();
  readonly segments: Segment[] = [];
  readonly videoParts = new Map<string, Record<string, unknown>>();
  readonly videoFiles = new Map<string, { path: string; bytes: number }>();

  putVideoFile(
    workspaceId: string,
    meetingId: string,
    name: VideoFileName,
    sourcePath: string,
  ): Promise<{ storageKey: string; bytes: number }> {
    this.videoFiles.set(`${meetingId}/${name}`, { path: sourcePath, bytes: 0 });
    return Promise.resolve({
      storageKey: `ws/${workspaceId}/meetings/${meetingId}/video/${name}`,
      bytes: 0,
    });
  }

  videoFile(_w: string, meetingId: string, name: VideoFileName) {
    return Promise.resolve(this.videoFiles.get(`${meetingId}/${name}`) ?? null);
  }

  deleteVideoFragments(_w: string, meetingId: string): Promise<void> {
    for (const key of [...this.videoFragments.keys()]) {
      if (key.startsWith(`${meetingId}/`)) this.videoFragments.delete(key);
    }
    for (const key of [...this.videoParts.keys()]) {
      if (key.startsWith(`${meetingId}/`)) this.videoParts.delete(key);
    }
    return Promise.resolve();
  }

  putVideoPartInfo(
    _w: string,
    meetingId: string,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void> {
    const key = `${meetingId}/${info.partId}`;
    this.videoParts.set(key, { ...this.videoParts.get(key), ...info });
    return Promise.resolve();
  }

  listVideoPartInfo(_w: string, meetingId: string): Promise<VideoPartInfo[]> {
    return Promise.resolve(
      [...this.videoParts.entries()]
        .filter(([key]) => key.startsWith(`${meetingId}/`))
        .flatMap(([, value]) => {
          const parsed = VideoPartInfo.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        })
        .sort((a, b) => a.partId.localeCompare(b.partId)),
    );
  }

  appendSegments(_w: string, _m: string, segments: readonly Segment[]): Promise<void> {
    this.segments.push(...segments);
    return Promise.resolve();
  }

  putVideoFragment(fragment: VideoFragment): Promise<void> {
    const key = `${fragment.meetingId}/${fragment.partId}/${fragment.index}`;
    this.videoFragments.set(key, fragment);
    return Promise.resolve();
  }

  listVideo(
    _workspaceId: string,
    meetingId: string,
  ): Promise<{ partId: string; indices: number[] }[]> {
    const parts = new Map<string, number[]>();
    for (const f of this.videoFragments.values()) {
      if (f.meetingId !== meetingId) continue;
      parts.set(f.partId, [...(parts.get(f.partId) ?? []), f.index]);
    }
    return Promise.resolve(
      [...parts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([partId, indices]) => ({ partId, indices: indices.sort((a, b) => a - b) })),
    );
  }

  readVideoFragment(
    _workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
  ): Promise<Uint8Array> {
    const fragment = this.videoFragments.get(`${meetingId}/${partId}/${index}`);
    if (fragment === undefined) return Promise.reject(new Error('no such fragment'));
    return Promise.resolve(fragment.bytes);
  }

  putUsage(usage: SessionUsage): Promise<void> {
    this.usage.set(usage.sessionId, usage);
    return Promise.resolve();
  }

  put(chunk: AudioChunk): Promise<void> {
    this.chunks.push(chunk);
    return Promise.resolve();
  }

  durableUpTo(workspaceId: string, meetingId: string): Promise<Record<Lane, number>> {
    const out: Record<Lane, number> = { me: -1, them: -1 };
    for (const c of this.chunks) {
      if (c.workspaceId !== workspaceId || c.meetingId !== meetingId) continue;
      out[c.lane] = Math.max(out[c.lane], c.frames.at(-1)?.seq ?? -1);
    }
    return Promise.resolve(out);
  }
}
