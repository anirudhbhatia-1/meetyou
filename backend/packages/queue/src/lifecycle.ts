import { newUlid } from '@meetyou/contracts';
import type { Db, WorkspaceTx } from '@meetyou/db';
import { sql } from 'kysely';
import { z } from 'zod';

import { enqueue } from './enqueue.ts';
import { DEFAULT_MAX_ATTEMPTS, defineTask, jobKey, type TaskDefinition } from './tasks.ts';

export const RETENTION_SWEEP = 'retention.sweep';
export const MEETING_DELETE = 'meeting.delete';
export const ACCOUNT_DELETE = 'account.delete';

export const RetentionSweepPayload = z.object({
  workspaceId: z.string().min(1),
  meetingId: z.string().optional(),
  dryRun: z.boolean().default(false),
});
export type RetentionSweepPayload = z.infer<typeof RetentionSweepPayload>;

export const MeetingDeletePayload = z.object({
  workspaceId: z.string().min(1),
  meetingId: z.string().min(1),
  requestId: z.string().min(1),
});
export type MeetingDeletePayload = z.infer<typeof MeetingDeletePayload>;

export const AccountDeletePayload = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  requestId: z.string().min(1),
});
export type AccountDeletePayload = z.infer<typeof AccountDeletePayload>;

export const meetingDeleteJob = {
  name: MEETING_DELETE,
  schema: MeetingDeletePayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;

export const accountDeleteJob = {
  name: ACCOUNT_DELETE,
  schema: AccountDeletePayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;

export const retentionSweepJob = {
  name: RETENTION_SWEEP,
  schema: RetentionSweepPayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;

export interface StorageCleanup {
  deleteMeetingFiles?(workspaceId: string, meetingId: string): Promise<void>;
  deleteAudioFile?(storageKey: string): Promise<void>;
  deleteVideoFile?(storageKey: string): Promise<void>;
  /** Data exports of a workspace (S3-11), on account deletion. */
  deleteExportFiles?(workspaceId: string): Promise<void>;
}

/**
 * Schedules a meeting soft-deletion with a 10-second undo grace window (PRD FR-SET-02, ARCHITECTURE §16.6).
 * During this grace window, `POST /v1/meetings/:id:restore` can cancel deletion.
 */
export async function scheduleMeetingDeletion(
  tx: WorkspaceTx,
  options: {
    workspaceId: string;
    meetingId: string;
    graceMs?: number;
    now?: Date;
  },
): Promise<{ requestId: string; executeAfter: Date }> {
  const { workspaceId, meetingId, graceMs = 10_000 } = options;
  const now = options.now ?? new Date();
  const executeAfter = new Date(now.getTime() + graceMs);
  const requestId = `del_${newUlid()}`;

  // 1. Insert deletion request audit record
  await tx
    .insertInto('deletionRequests')
    .values({
      id: requestId,
      workspaceId,
      scope: 'meeting',
      targetId: meetingId,
      requestedAt: now,
      executeAfter,
      cancelledAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  // 2. Soft-delete the meeting record so it immediately disappears from user lists
  await tx
    .updateTable('meetings')
    .set({ deletedAt: now })
    .where('workspaceId', '=', workspaceId)
    .where('id', '=', meetingId)
    .execute();

  // 3. Enqueue asynchronous hard deletion scheduled for executeAfter
  await enqueue(
    tx,
    meetingDeleteJob,
    { workspaceId, meetingId, requestId },
    {
      runAt: executeAfter,
      jobKey: jobKey(MEETING_DELETE, meetingId, 1),
    },
  );

  return { requestId, executeAfter };
}

/**
 * Restores a soft-deleted meeting within the 10-second grace window (Undo flow).
 * Marks the pending deletion_request as cancelled and restores the meeting.
 */
export async function cancelMeetingDeletion(
  tx: WorkspaceTx,
  options: {
    workspaceId: string;
    meetingId: string;
    now?: Date;
  },
): Promise<boolean> {
  const { workspaceId, meetingId } = options;
  const now = options.now ?? new Date();

  // 1. Restore the meeting — but only while its deletion request is still pending. After the
  // grace window the hard delete may already be removing storage objects; "restoring" then would
  // leave a meeting with no recordings (2026-11-09 audit).
  const pending = await tx
    .selectFrom('deletionRequests')
    .select('id')
    .where('workspaceId', '=', workspaceId)
    .where('scope', '=', 'meeting')
    .where('targetId', '=', meetingId)
    .where('cancelledAt', 'is', null)
    .where('completedAt', 'is', null)
    .where('executeAfter', '>', now)
    .executeTakeFirst();
  if (pending === undefined) return false;

  const restoredMeeting = await tx
    .updateTable('meetings')
    .set({ deletedAt: null })
    .where('workspaceId', '=', workspaceId)
    .where('id', '=', meetingId)
    .returning('id')
    .executeTakeFirst();

  if (!restoredMeeting) return false;

  // 2. Mark active deletion request as cancelled
  await tx
    .updateTable('deletionRequests')
    .set({ cancelledAt: now, updatedAt: now })
    .where('workspaceId', '=', workspaceId)
    .where('scope', '=', 'meeting')
    .where('targetId', '=', meetingId)
    .where('cancelledAt', 'is', null)
    .where('completedAt', 'is', null)
    .execute();

  return true;
}

/**
 * Schedules an account deletion (PRD FR-SET-03, ARCHITECTURE §16.6).
 * Account deletion runs immediately on confirmation without an undo grace window.
 */
export async function scheduleAccountDeletion(
  tx: WorkspaceTx,
  options: {
    userId: string;
    workspaceId: string;
    now?: Date;
  },
): Promise<{ requestId: string }> {
  const { userId, workspaceId } = options;
  const now = options.now ?? new Date();
  const requestId = `del_${newUlid()}`;

  await tx
    .insertInto('deletionRequests')
    .values({
      id: requestId,
      workspaceId,
      scope: 'account',
      targetId: userId,
      requestedAt: now,
      executeAfter: now,
      cancelledAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  await enqueue(
    tx,
    accountDeleteJob,
    { userId, workspaceId, requestId },
    {
      runAt: now,
      jobKey: jobKey(ACCOUNT_DELETE, userId, 1),
    },
  );

  return { requestId };
}

/**
 * Meeting hard-deletion task definition.
 * Runs after the 10s grace period:
 * - Checks if deletion was cancelled (Undo). If cancelled, skips.
 * - If not cancelled, removes storage objects, permanently deletes meeting rows (cascading),
 *   and marks completion in the deletion_requests audit log.
 */
export function meetingDeleteTask(deps: {
  db: Db;
  storage?: StorageCleanup;
  now?: () => number;
}): TaskDefinition<typeof MeetingDeletePayload> {
  const nowFn = deps.now ?? Date.now;

  return defineTask(MEETING_DELETE, MeetingDeletePayload, async (payload, helpers) => {
    const { workspaceId, meetingId, requestId } = payload;

    const request = await deps.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('deletionRequests')
        .select(['cancelledAt', 'completedAt'])
        .where('id', '=', requestId)
        .executeTakeFirst(),
    );

    // If cancelled by user during grace window or already executed, no-op
    if (!request || request.cancelledAt !== null || request.completedAt !== null) {
      helpers.logger.info(`meeting.delete: skipped or cancelled (meeting: ${meetingId})`);
      return;
    }

    // 1. Delete associated files from object storage (audio chunks, finalized video, etc.)
    // A storage failure fails the job (it retries): deleting the rows first would orphan the
    // recording objects with nothing left pointing at them. Deleting is idempotent.
    if (deps.storage?.deleteMeetingFiles) {
      await deps.storage.deleteMeetingFiles(workspaceId, meetingId);
    }

    // 2. Permanently delete meeting row (cascades all related database child rows)
    await deps.db.inWorkspace(workspaceId, async (tx) => {
      await tx.deleteFrom('meetings').where('id', '=', meetingId).execute();

      // 3. Mark deletion request as completed in audit log
      await tx
        .updateTable('deletionRequests')
        .set({
          completedAt: new Date(nowFn()),
          updatedAt: new Date(nowFn()),
        })
        .where('id', '=', requestId)
        .execute();
    });

    helpers.logger.info(`meeting.delete: completed permanently (${meetingId})`);
  });
}

/**
 * Account deletion task definition (PRD FR-SET-03).
 * Permanently removes user account, workspace, memberships, and meetings,
 * while preserving the deletion audit log entry with workspace_id set to NULL.
 */
export function accountDeleteTask(deps: {
  db: Db;
  storage?: StorageCleanup;
  now?: () => number;
}): TaskDefinition<typeof AccountDeletePayload> {
  const nowFn = deps.now ?? Date.now;

  return defineTask(ACCOUNT_DELETE, AccountDeletePayload, async (payload, helpers) => {
    const { userId, workspaceId, requestId } = payload;

    const request = await deps.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('deletionRequests')
        .select(['cancelledAt', 'completedAt'])
        .where('id', '=', requestId)
        .executeTakeFirst(),
    );

    if (!request || request.cancelledAt !== null || request.completedAt !== null) {
      return;
    }

    // 1. Find all meetings in workspace to clean up storage
    const meetings = await deps.db.inWorkspace(workspaceId, (tx) =>
      tx.selectFrom('meetings').select('id').execute(),
    );

    // As for one meeting: fail and retry rather than delete rows over surviving objects.
    for (const mtg of meetings) {
      await deps.storage?.deleteMeetingFiles?.(workspaceId, mtg.id);
    }
    await deps.storage?.deleteExportFiles?.(workspaceId);

    // 2. Mark request completed in audit log before deleting workspace
    // (since deleting workspace sets deletion_requests.workspace_id to NULL via ON DELETE SET NULL,
    // which would make it invisible to RLS scoped transaction).
    await deps.db.inWorkspace(workspaceId, async (tx) => {
      await tx
        .updateTable('deletionRequests')
        .set({
          completedAt: new Date(nowFn()),
          updatedAt: new Date(nowFn()),
        })
        .where('id', '=', requestId)
        .execute();

      // The users policy matches on app.user_id, which inWorkspace does not set: without it the
      // user row is silently kept. Refresh tokens go with it (ON DELETE CASCADE).
      await sql`select set_config('app.user_id', ${userId}, true)`.execute(tx);
      await tx.deleteFrom('meetings').execute();
      await tx.deleteFrom('userSettings').where('userId', '=', userId).execute();
      await tx.deleteFrom('memberships').where('userId', '=', userId).execute();
      await tx.deleteFrom('workspaces').where('id', '=', workspaceId).execute();
      await tx.deleteFrom('users').where('id', '=', userId).execute();
    });

    helpers.logger.info(`account.delete: completed permanently (user: ${userId})`);
  });
}

/**
 * Audio and Video Retention Sweeper task (PRD FR-SET-01, decisions D-01/D-02, ARCHITECTURE §9.3).
 *
 * CRITICAL RETENTION SAFETY RULE:
 * "The 'delete immediately' policy is applied only by step 9, which runs only after the summary
 * succeeded (D-02). A failed processing job never triggers immediate deletion."
 *
 * Any audio asset whose associated meeting is in 'failed' or 'processing' status is NEVER deleted,
 * preserving raw audio for manual or subsequent reprocessing.
 */
export function retentionSweepTask(deps: {
  db: Db;
  storage?: StorageCleanup;
  now?: () => number;
}): TaskDefinition<typeof RetentionSweepPayload> {
  const nowFn = deps.now ?? Date.now;

  return defineTask(RETENTION_SWEEP, RetentionSweepPayload, async (payload, helpers) => {
    const now = new Date(nowFn());
    const { workspaceId, meetingId, dryRun } = payload;
    let audioDeletedCount = 0;
    let videoExpiredCount = 0;

    await deps.db.inWorkspace(workspaceId, async (tx) => {
      // 1. Process expired audio assets (joined with meetings to inspect status)
      let audioQuery = tx
        .selectFrom('audioAssets')
        .innerJoin('meetings', 'meetings.id', 'audioAssets.meetingId')
        .select([
          'audioAssets.id as assetId',
          'audioAssets.storageKey',
          'audioAssets.meetingId',
          'meetings.status as meetingStatus',
        ])
        .where('audioAssets.deleteAfter', '<=', now);

      if (meetingId) {
        audioQuery = audioQuery.where('audioAssets.meetingId', '=', meetingId);
      }

      const expiredAudio = await audioQuery.execute();

      for (const item of expiredAudio) {
        // SAFETY CHECK: Failed processing never deletes audio!
        if (item.meetingStatus === 'failed' || item.meetingStatus === 'processing') {
          helpers.logger.info(
            `retention.sweep: audio preserved because meeting processing is ${item.meetingStatus} (${item.meetingId})`,
          );
          continue;
        }

        if (!dryRun) {
          if (item.storageKey && deps.storage?.deleteAudioFile) {
            await deps.storage.deleteAudioFile(item.storageKey);
          }
          // audio_assets.storage_key is NOT NULL: the row goes with the object (0001_init.sql).
          await tx.deleteFrom('audioAssets').where('id', '=', item.assetId).execute();
        }
        audioDeletedCount++;
      }

      // 2. Process expired video assets (same D-02 safety rule as audio: a meeting still
      // processing or failed keeps its recording — 2026-11-09 audit).
      let videoQuery = tx
        .selectFrom('videoAssets')
        .innerJoin('meetings', 'meetings.id', 'videoAssets.meetingId')
        .select([
          'videoAssets.id as id',
          'videoAssets.storageKey',
          'videoAssets.meetingId',
          'videoAssets.status',
          'meetings.status as meetingStatus',
        ])
        .where('videoAssets.deleteAfter', '<=', now)
        .where('videoAssets.status', '!=', 'expired')
        .where('videoAssets.storageKey', 'is not', null);

      if (meetingId) {
        videoQuery = videoQuery.where('videoAssets.meetingId', '=', meetingId);
      }

      const expiredVideos = await videoQuery.execute();

      for (const video of expiredVideos) {
        if (video.meetingStatus === 'failed' || video.meetingStatus === 'processing') {
          helpers.logger.info(
            `retention.sweep: video preserved because meeting processing is ${video.meetingStatus} (${video.meetingId})`,
          );
          continue;
        }
        if (!dryRun) {
          if (video.storageKey && deps.storage?.deleteVideoFile) {
            await deps.storage.deleteVideoFile(video.storageKey);
          }
          await tx
            .updateTable('videoAssets')
            .set({
              status: 'expired',
              storageKey: null,
              updatedAt: now,
            })
            .where('id', '=', video.id)
            .execute();
        }
        videoExpiredCount++;
      }
    });

    helpers.logger.info(
      `retention.sweep: completed for workspace ${workspaceId} (audio deleted: ${audioDeletedCount}, video expired: ${videoExpiredCount}, dryRun: ${dryRun})`,
    );
  });
}
