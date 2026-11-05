import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Lane } from '@meetyou/contracts';
import { z } from 'zod';

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
export interface ChunkStore {
  put(chunk: AudioChunk): Promise<void>;
  /** Highest durable seq per lane for a meeting; -1 when nothing is stored. */
  durableUpTo(workspaceId: string, meetingId: string): Promise<Record<Lane, number>>;
  /** Usage counts for cost tracking (AGENTS §3 rule 10); overwrites the previous snapshot. */
  putUsage(usage: SessionUsage): Promise<void>;
  /** Overwrites the same fragment on a retry (idempotent, like a signed PUT to Cloud Storage). */
  putVideoFragment(fragment: VideoFragment): Promise<void>;
}

const Manifest = z.object({
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
 * TODO(S1-10/S2): Cloud Storage implementation behind the same interface.
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

  async putUsage(usage: SessionUsage): Promise<void> {
    const path = join(this.#meetingDir(usage.workspaceId, usage.sessionId), 'usage.json');
    await mkdir(dirname(path), { recursive: true });
    await writeDurably(path, new TextEncoder().encode(JSON.stringify(usage, null, 2)));
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
  const dir = await open(dirname(path), 'r');
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

/** In-memory store for tests. */
export class MemoryChunkStore implements ChunkStore {
  readonly chunks: AudioChunk[] = [];
  readonly usage = new Map<string, SessionUsage>();
  readonly videoFragments = new Map<string, VideoFragment>();

  putVideoFragment(fragment: VideoFragment): Promise<void> {
    const key = `${fragment.meetingId}/${fragment.partId}/${fragment.index}`;
    this.videoFragments.set(key, fragment);
    return Promise.resolve();
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
