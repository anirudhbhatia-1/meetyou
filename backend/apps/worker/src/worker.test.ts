import type { AddressInfo } from 'node:net';

import { newUlid } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting } from '@meetyou/db';
import { enqueue } from '@meetyou/queue';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { MemoryBucket, ObjectVideoStore } from '@meetyou/storage';
import { videoFinalizeJob, videoFinalizeJobKey } from '@meetyou/video';
import { hasFfmpeg, synthFragments } from '@meetyou/video/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './config.ts';
import { runWorker, type RunningWorker } from './worker.ts';

const PART = 'vp_01J00000000000000000000PRT';

describe('worker configuration', () => {
  it('needs the database and the bucket, and names what is missing without values', () => {
    expect(() => loadWorkerEnv({ DATABASE_URL: 'postgres://secret@x/db' })).toThrow(
      'worker: invalid or missing GCS_AUDIO_BUCKET',
    );
    expect(() => loadWorkerEnv({})).not.toThrow(/secret/);
    expect(
      loadWorkerEnv({ DATABASE_URL: 'postgres://x', GCS_AUDIO_BUCKET: 'bucket', PORT: '9000' }),
    ).toMatchObject({ PORT: 9000, WORKER_CONCURRENCY: 2, APP_ENV: 'local' });
  });
});

describe.runIf(hasFfmpeg())('worker runs video.finalize from the queue (S2-06, S2-14)', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let worker: RunningWorker | null = null;
  let dir: string;
  beforeEach(async () => {
    env = await createQueueTestEnv();
    dir = await mkdtemp(join(tmpdir(), 'worker-test-'));
  });
  afterEach(async () => {
    await worker?.runner.stop();
    await new Promise<void>((resolve) => worker?.health.close(() => resolve()) ?? resolve());
    worker = null;
    await env.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('finalizes a meeting enqueued at its end, exactly once, and reports health', async () => {
    const signIn = await env.db.signInGoogleUser(
      { googleSub: `g_${newUlid()}`, email: 'a@example.com', displayName: 'A' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    const workspaceId = signIn.workspaceId ?? '';
    const meetingId = `mtg_${newUlid()}`;

    // Fragments and timing as the gateway and the extension leave them in the bucket.
    const bucket = new MemoryBucket();
    const store = new ObjectVideoStore(bucket);
    const fragments = await synthFragments(dir, 'p', 4, 'orange');
    for (const [i, f] of fragments.entries()) {
      await store.putVideoFragment(workspaceId, meetingId, PART, i, f, 'video/mp4');
    }
    await store.putVideoPartInfo(workspaceId, meetingId, {
      partId: PART,
      mimeType: 'video/mp4',
      startMs: 0,
      fragments: fragments.length,
    });

    // The meeting ends and the job is created in the same transaction (gateway DbSink).
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: null,
        startedAt: new Date(Date.now() - 60_000),
      });
      await endMeeting(tx, meetingId, new Date());
      for (let i = 0; i < 2; i++) {
        // A repeated end replaces the pending job (same key): one finalize, not two.
        await enqueue(
          tx,
          videoFinalizeJob,
          { workspaceId, meetingId },
          {
            jobKey: videoFinalizeJobKey(meetingId),
          },
        );
      }
    });

    worker = await runWorker({
      pool: env.pool,
      bucket,
      port: 0,
      host: '127.0.0.1',
      handleSignals: false,
      pollIntervalMs: 100,
    });
    const { port } = worker.health.address() as AddressInfo;
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);

    const ready = async () =>
      env.db.inWorkspace(workspaceId, (tx) =>
        tx
          .selectFrom('videoAssets')
          .select(['status', 'durationMs'])
          .where('partId', 'is', null)
          .execute(),
      );
    let rows = await ready();
    for (let i = 0; i < 300 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      rows = await ready();
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ready');
    expect([...bucket.objects.keys()].sort()).toEqual([
      `ws/${workspaceId}/meetings/${meetingId}/video/playback.mp4`,
      `ws/${workspaceId}/meetings/${meetingId}/video/poster.jpg`,
    ]);
    const jobs = await env.pool.query('select count(*)::int as n from graphile_worker.jobs');
    expect(jobs.rows[0]).toEqual({ n: 0 });
  }, 120_000);
});
