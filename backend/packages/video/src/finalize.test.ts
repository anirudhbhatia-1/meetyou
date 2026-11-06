import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TOOLS, probe } from './ffmpeg.ts';
import {
  finalizeVideo,
  planParts,
  uploadsComplete,
  type PartTiming,
  type VideoStore,
} from './finalize.ts';
import { boxes, synthFragments } from './testing.ts';

const P1 = 'vp_01J00000000000000000000P01';
const P2 = 'vp_01J00000000000000000000P02';

describe('planning parts on the session clock', () => {
  it('orders by start time, lists holes and needs fragment 0', () => {
    const plans = planParts(
      [
        { partId: P2, indices: [0, 2] },
        { partId: P1, indices: [1, 2] },
      ],
      [
        { partId: P1, mimeType: 'video/mp4', startMs: 0, fragments: 3 },
        { partId: P2, mimeType: 'video/mp4', startMs: 60_000, fragments: 4 },
      ],
    );
    expect(plans).toEqual([
      { partId: P1, startMs: 0, indices: [1, 2], missing: [0], playable: false },
      { partId: P2, startMs: 60_000, indices: [0, 2], missing: [1, 3], playable: true },
    ]);
  });

  it('places a part without timing right after the previous one', () => {
    const plans = planParts(
      [
        { partId: P1, indices: [0, 1] },
        { partId: P2, indices: [0] },
      ],
      [{ partId: P1, mimeType: 'video/mp4', startMs: 5000, fragments: 2 }],
    );
    expect(plans.map((p) => [p.partId, p.startMs])).toEqual([
      [P1, 5000],
      [P2, 25_000],
    ]);
  });

  it('waits for every fragment of every stopped part', () => {
    const timing: PartTiming[] = [{ partId: P1, mimeType: 'video/mp4', startMs: 0, fragments: 2 }];
    expect(uploadsComplete([{ partId: P1, indices: [0, 1] }], timing)).toBe(true);
    expect(uploadsComplete([{ partId: P1, indices: [0] }], timing)).toBe(false);
    // A part that has not stopped yet (no fragment count) is not complete.
    expect(uploadsComplete([], [{ partId: P2, mimeType: 'video/mp4', startMs: 0 }])).toBe(false);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

class TestStore implements VideoStore {
  readonly fragments = new Map<string, Map<number, Uint8Array>>();
  readonly timing: PartTiming[] = [];
  readonly files = new Map<string, string>();
  deleted = false;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  listVideo() {
    return Promise.resolve(
      [...this.fragments.entries()].map(([partId, m]) => ({
        partId,
        indices: [...m.keys()].sort((a, b) => a - b),
      })),
    );
  }
  listVideoPartInfo() {
    return Promise.resolve(this.timing);
  }
  readVideoFragment(_w: string, _m: string, partId: string, index: number) {
    const bytes = this.fragments.get(partId)?.get(index);
    return bytes === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(bytes);
  }
  async putVideoFile(_w: string, _m: string, name: 'playback.mp4' | 'poster.jpg', source: string) {
    const target = join(this.dir, `stored-${name}`);
    await copyFile(source, target);
    this.files.set(name, target);
    return { storageKey: `ws/w/meetings/m/video/${name}`, bytes: (await stat(target)).size };
  }
  deleteVideoFragments() {
    this.deleted = true;
    return Promise.resolve();
  }
}

describe.runIf(hasFfmpeg)('video.finalize with ffmpeg (ADR-0011 §3.4)', () => {
  let dir: string;
  let work: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finalize-test-'));
    work = await mkdtemp(join(tmpdir(), 'finalize-work-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  it('joins one part into a faststart MP4 with a poster, copying H.264', async () => {
    const store = new TestStore(dir);
    const frags = await synthFragments(dir, 'a', 6, 'red');
    expect(frags.length).toBeGreaterThanOrEqual(3);
    store.fragments.set(P1, new Map(frags.map((f, i) => [i, f])));
    store.timing.push({
      partId: P1,
      mimeType: 'video/mp4',
      startMs: 1500,
      fragments: frags.length,
    });

    const result = await finalizeVideo({ store, workspaceId: 'w', meetingId: 'm', workDir: work });
    expect(result).not.toBeNull();
    expect(result?.startMs).toBe(1500);
    expect(result?.durationMs).toBeGreaterThan(5500);
    expect(result?.durationMs).toBeLessThan(6600);
    const playback = new Uint8Array(await readFile(store.files.get('playback.mp4') ?? ''));
    const order = boxes(playback).map(([t]) => t);
    expect(order.indexOf('moov')).toBeLessThan(order.indexOf('mdat')); // faststart
    const info = await probe(DEFAULT_TOOLS, store.files.get('playback.mp4') ?? '');
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect((await stat(store.files.get('poster.jpg') ?? '')).size).toBeGreaterThan(0);
    // Deleting fragments is the caller's step, after it recorded the result.
    expect(store.deleted).toBe(false);
  }, 60_000);

  it('fills the pause between parts so one file follows the session clock', async () => {
    const store = new TestStore(dir);
    const a = await synthFragments(dir, 'a', 4, 'red');
    const b = await synthFragments(dir, 'b', 4, 'blue');
    store.fragments.set(P1, new Map(a.map((f, i) => [i, f])));
    store.fragments.set(P2, new Map(b.map((f, i) => [i, f])));
    store.timing.push(
      { partId: P1, mimeType: 'video/mp4', startMs: 0, fragments: a.length },
      // Paused from 4 s to 10 s.
      { partId: P2, mimeType: 'video/mp4', startMs: 10_000, fragments: b.length },
    );
    const result = await finalizeVideo({ store, workspaceId: 'w', meetingId: 'm', workDir: work });
    // 4 s + 6 s pause + 4 s, within a frame or two.
    expect(result?.durationMs).toBeGreaterThan(13_700);
    expect(result?.durationMs).toBeLessThan(14_400);
    const info = await probe(DEFAULT_TOOLS, store.files.get('playback.mp4') ?? '');
    expect(info.video).toMatchObject({ codec: 'h264', width: 1280, height: 720 });
  }, 120_000);

  it('returns null when no part has its init fragment', async () => {
    const store = new TestStore(dir);
    const frags = await synthFragments(dir, 'a', 4, 'red');
    store.fragments.set(P1, new Map([[1, frags[1] ?? new Uint8Array()]]));
    expect(
      await finalizeVideo({ store, workspaceId: 'w', meetingId: 'm', workDir: work }),
    ).toBeNull();
  }, 60_000);
});
