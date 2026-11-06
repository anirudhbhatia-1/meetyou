import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newUlid } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import type { JobHelpers } from 'graphile-worker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PartTiming, VideoStore } from './finalize.ts';
import { RECHECK_MS, VIDEO_FINALIZE, videoFinalizeJobKey, videoFinalizeTask } from './task.ts';
import { hasFfmpeg, synthFragments } from './testing.ts';

const PART = 'vp_01J00000000000000000000PRT';

class DiskStore implements VideoStore {
  readonly fragments = new Map<number, Uint8Array>();
  readonly timing: PartTiming[] = [];
  deleted = false;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  listVideo() {
    return Promise.resolve(
      this.fragments.size === 0 ? [] : [{ partId: PART, indices: [...this.fragments.keys()] }],
    );
  }
  listVideoPartInfo() {
    return Promise.resolve(this.timing);
  }
  readVideoFragment(_w: string, _m: string, _p: string, index: number) {
    return Promise.resolve(this.fragments.get(index) ?? new Uint8Array());
  }
  async putVideoFile(_w: string, m: string, name: 'playback.mp4' | 'poster.jpg', src: string) {
    const target = join(this.dir, name);
    await copyFile(src, target);
    return { storageKey: `ws/w/meetings/${m}/video/${name}`, bytes: (await stat(target)).size };
  }
  deleteVideoFragments() {
    this.deleted = true;
    return Promise.resolve();
  }
}

function helpers() {
  const addJob = vi.fn(() => Promise.resolve());
  return {
    addJob,
    helpers: { addJob, logger: { info: vi.fn() } } as unknown as JobHelpers,
  };
}

describe.runIf(hasFfmpeg())('video.finalize task (S2-14, ADR-0005)', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let dir: string;
  beforeEach(async () => {
    env = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), 'finalize-task-'));
  });
  afterEach(async () => {
    await env.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function meeting(endedAt: Date | null) {
    const signIn = await env.db.signInGoogleUser(
      { googleSub: `s_${newUlid()}`, email: 'a@example.com', displayName: 'A' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    const workspaceId = signIn.workspaceId ?? '';
    const meetingId = `mtg_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: null,
        startedAt: new Date('2026-11-06T10:00:00Z'),
      });
      if (endedAt !== null) await endMeeting(tx, meetingId, endedAt);
    });
    return { workspaceId, meetingId };
  }

  it('looks again later while fragments are still uploading', async () => {
    const endedAt = new Date('2026-11-06T10:30:00Z');
    const { workspaceId, meetingId } = await meeting(endedAt);
    const store = new DiskStore(dir);
    const frags = await synthFragments(dir, 'p', 4, 'red');
    store.fragments.set(0, frags[0] ?? new Uint8Array());
    store.timing.push({ partId: PART, mimeType: 'video/mp4', startMs: 0, fragments: frags.length });
    const now = endedAt.getTime() + 60_000;
    const task = videoFinalizeTask({ db: env.db, store, now: () => now });
    const h = helpers();
    await task.handle({ workspaceId, meetingId }, h.helpers);
    expect(h.addJob).toHaveBeenCalledWith(
      VIDEO_FINALIZE,
      { workspaceId, meetingId },
      { runAt: new Date(now + RECHECK_MS), jobKey: videoFinalizeJobKey(meetingId) },
    );
    expect(store.deleted).toBe(false);
  }, 60_000);

  it('finalizes when complete: ready row with retention, then deletes the fragments', async () => {
    const endedAt = new Date('2026-11-06T10:30:00Z');
    const { workspaceId, meetingId } = await meeting(endedAt);
    const store = new DiskStore(dir);
    const frags = await synthFragments(dir, 'p', 4, 'red');
    frags.forEach((f, i) => store.fragments.set(i, f));
    store.timing.push({
      partId: PART,
      mimeType: 'video/mp4',
      startMs: 1000,
      fragments: frags.length,
    });
    const task = videoFinalizeTask({ db: env.db, store, now: () => endedAt.getTime() + 60_000 });
    const h = helpers();
    await task.handle({ workspaceId, meetingId }, h.helpers);
    expect(h.addJob).not.toHaveBeenCalled();
    expect(store.deleted).toBe(true);
    const row = await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('videoAssets')
        .select(['status', 'partId', 'startMs', 'durationMs', 'storageKey', 'deleteAfter'])
        .executeTakeFirstOrThrow(),
    );
    expect(row).toMatchObject({
      status: 'ready',
      partId: null,
      startMs: 1000,
      storageKey: `ws/w/meetings/${meetingId}/video/playback.mp4`,
    });
    expect(row.durationMs).toBeGreaterThan(3500);
    // D-02 default retention: 7 days after the meeting ended.
    expect(row.deleteAfter?.getTime()).toBe(endedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  }, 60_000);

  it('finalizes with what arrived once 24 h have passed', async () => {
    const endedAt = new Date('2026-11-05T10:30:00Z');
    const { workspaceId, meetingId } = await meeting(endedAt);
    const store = new DiskStore(dir);
    const frags = await synthFragments(dir, 'p', 4, 'red');
    store.fragments.set(0, frags[0] ?? new Uint8Array());
    store.timing.push({ partId: PART, mimeType: 'video/mp4', startMs: 0, fragments: frags.length });
    const task = videoFinalizeTask({
      db: env.db,
      store,
      now: () => endedAt.getTime() + 25 * 60 * 60 * 1000,
    });
    await task.handle({ workspaceId, meetingId }, helpers().helpers);
    expect(store.deleted).toBe(true);
  }, 60_000);
});
