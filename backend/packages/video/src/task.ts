import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { upsertVideoAsset, type Db } from '@meetyou/db';
import {
  DEFAULT_MAX_ATTEMPTS,
  defineTask,
  enqueue,
  jobKey,
  RETENTION_SWEEP,
  retentionSweepJob,
} from '@meetyou/queue';
import { z } from 'zod';

import type { FfmpegTools } from './ffmpeg.ts';
import { finalizeVideo, uploadsComplete, type VideoStore } from './finalize.ts';

export const VIDEO_FINALIZE = 'video.finalize';

/** IDs only (ADR-0005 §3.1). */
export const VideoFinalizePayload = z.object({
  workspaceId: z.string().min(1),
  meetingId: z.string().min(1),
  /** How many times uploads were found incomplete; drives the re-check backoff. */
  checks: z.number().int().nonnegative().optional(),
});

/** ADR-0011 §3.4: finalize once every fragment arrived, or 24 h after the meeting ended anyway. */
export const UPLOAD_WAIT_MS = 24 * 60 * 60 * 1000;
/** While uploads are still arriving, the job looks again after this long at most. */
export const RECHECK_MS = 15 * 60 * 1000;
/** The first re-check: the last fragments usually land seconds after the meeting ends. */
export const FIRST_RECHECK_MS = 30 * 1000;

/** 30 s, 1, 2, 4, 8 min, then every 15 min: video is ready soon after a normal upload finishes. */
export function recheckDelayMs(checks: number): number {
  return Math.min(RECHECK_MS, FIRST_RECHECK_MS * 2 ** checks);
}

/** What a service that only creates the job needs (the gateway, at the end of a recording). */
export const videoFinalizeJob = {
  name: VIDEO_FINALIZE,
  schema: VideoFinalizePayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;

/** One finalize job per meeting: a repeated request replaces the pending one. */
export function videoFinalizeJobKey(meetingId: string): string {
  return jobKey(VIDEO_FINALIZE, meetingId, 1);
}

const RETENTION_DAYS: Record<string, number> = { immediate: 0, '7d': 7, '30d': 30 };

/**
 * The `video.finalize` task for the worker. Idempotent: a re-run rebuilds the same files and
 * updates the same `video_assets` row; fragments are deleted only after the row says `ready`.
 * Retention (D-02): `delete_after` = meeting end + the workspace's retention policy; the retention
 * job (S2-10) deletes the files after that.
 */
/** Rechecks before a never-ended meeting is written off (~24 h with the recheck backoff). */
const GIVE_UP_CHECKS = 100;

/** Marks the meeting's playback row failed (if any upload started) and drops its fragments. */
async function markVideoFailed(
  deps: { db: Db; store: VideoStore },
  workspaceId: string,
  meetingId: string,
): Promise<void> {
  await deps.db.inWorkspace(workspaceId, (tx) =>
    tx
      .updateTable('videoAssets')
      .set({ status: 'failed' })
      .where('meetingId', '=', meetingId)
      .where('partId', 'is', null)
      .where('status', '=', 'uploading')
      .execute(),
  );
  await deps.store.deleteVideoFragments(workspaceId, meetingId);
}

export function videoFinalizeTask(deps: {
  db: Db;
  store: VideoStore;
  tools?: FfmpegTools;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  return defineTask(VIDEO_FINALIZE, VideoFinalizePayload, async (payload, helpers) => {
    const { workspaceId, meetingId } = payload;
    const meeting = await deps.db.inWorkspace(workspaceId, (tx) =>
      tx.selectFrom('meetings').select(['endedAt']).where('id', '=', meetingId).executeTakeFirst(),
    );
    if (meeting === undefined) return; // deleted meanwhile: nothing to do
    const endedAt = meeting.endedAt?.getTime() ?? null;
    // A meeting whose gateway died before `ended()` keeps endedAt null forever; without a cut-off
    // this job re-enqueued itself every recheck for good (2026-11-09 audit).
    const checksSoFar = payload.checks ?? 0;
    if (endedAt === null && checksSoFar >= GIVE_UP_CHECKS) {
      helpers.logger.warn(`video.finalize: giving up, meeting never ended (${meetingId})`);
      await markVideoFailed(deps, workspaceId, meetingId);
      return;
    }
    const stored = await deps.store.listVideo(workspaceId, meetingId);
    const timing = await deps.store.listVideoPartInfo(workspaceId, meetingId);
    const waited = endedAt !== null && now() - endedAt >= UPLOAD_WAIT_MS;
    if ((endedAt === null || !uploadsComplete(stored, timing)) && !waited) {
      // Still recording or uploading: look again later under the same job key (one job).
      const checks = payload.checks ?? 0;
      await helpers.addJob(
        VIDEO_FINALIZE,
        { workspaceId, meetingId, checks: checks + 1 },
        { runAt: new Date(now() + recheckDelayMs(checks)), jobKey: videoFinalizeJobKey(meetingId) },
      );
      return;
    }

    const workDir = await mkdtemp(join(tmpdir(), 'minutes-finalize-'));
    try {
      const result = await finalizeVideo({
        store: deps.store,
        workspaceId,
        meetingId,
        workDir,
        ...(deps.tools !== undefined ? { tools: deps.tools } : {}),
      });
      if (result === null) {
        helpers.logger.info(`video.finalize: nothing playable (${meetingId})`);
        // Leave a `failed` row (the meeting page says so) and drop the fragments; without this
        // the row stayed `uploading` and playback 404'd forever (2026-11-09 audit).
        await markVideoFailed(deps, workspaceId, meetingId);
        return;
      }
      const policy = await deps.db.inWorkspace(workspaceId, (tx) =>
        tx.selectFrom('userSettings').select('retentionPolicy').executeTakeFirst(),
      );
      const days = RETENTION_DAYS[policy?.retentionPolicy ?? '7d'] ?? 7;
      const deleteAfter = new Date((endedAt ?? now()) + days * 24 * 60 * 60 * 1000);
      await deps.db.inWorkspace(workspaceId, async (tx) => {
        await upsertVideoAsset(tx, {
          id: `va_${meetingId}`,
          workspaceId,
          meetingId,
          partId: null,
          status: 'ready',
          mimeType: 'video/mp4',
          startMs: result.startMs,
          durationMs: result.durationMs,
          fragments: result.fragments,
          storageKey: result.storageKey,
          bytes: result.bytes,
          deleteAfter,
        });
        // Retention (D-02, S2-10): the sweep for this meeting runs when the video expires. The
        // job key keeps one pending sweep per meeting if finalize runs again.
        await enqueue(
          tx,
          retentionSweepJob,
          { workspaceId, meetingId, dryRun: false },
          { runAt: deleteAfter, jobKey: jobKey(RETENTION_SWEEP, meetingId, 1) },
        );
      });
      await deps.store.deleteVideoFragments(workspaceId, meetingId);
      helpers.logger.info(
        `video.finalize: ready (${meetingId}, ${result.durationMs} ms, ${result.parts.length} parts)`,
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}
