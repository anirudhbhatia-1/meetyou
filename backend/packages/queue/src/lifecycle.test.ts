import { newUlid } from '@meetyou/contracts';
import type { Runner } from 'graphile-worker';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  accountDeleteTask,
  cancelMeetingDeletion,
  meetingDeleteTask,
  retentionSweepTask,
  scheduleAccountDeletion,
  scheduleMeetingDeletion,
  type StorageCleanup,
} from './lifecycle.ts';
import { createQueueTestEnv } from './testing.ts';
import { startWorker } from './worker.ts';

let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
let runner: Runner | null = null;

beforeEach(async () => {
  env = await createQueueTestEnv();
});

afterEach(async () => {
  await runner?.stop();
  runner = null;
  await env.close();
});

const id = (prefix: string) => `${prefix}_${newUlid()}`;

async function createTestAccount() {
  const result = await env.db.signInGoogleUser(
    { googleSub: id('g'), email: 'user@example.com', displayName: 'Test User' },
    { userId: id('usr'), workspaceId: id('ws'), membershipId: id('mem'), settingsId: id('set') },
  );
  if (result.workspaceId === null) throw new Error('no workspace');
  return { ...result, workspaceId: result.workspaceId };
}

describe('Data lifecycle & retention jobs (S2-10, PRD FR-SET-01..03, ARCHITECTURE §9.3 & §16.6)', () => {
  describe('Audio & Video retention (delete_after)', () => {
    it('deletes expired audio when meeting processing succeeded (status = ready)', async () => {
      const a = await createTestAccount();
      const meetingId = id('mtg');
      const nowMs = 1_700_000_000_000;
      const expiredAt = new Date(nowMs - 10_000);

      // Create ready meeting with expired audio asset
      await env.db.inWorkspace(a.workspaceId, async (tx) => {
        await tx
          .insertInto('meetings')
          .values({
            id: meetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'Ready Meeting',
            status: 'ready',
            startedAt: new Date(nowMs - 3600_000),
            endedAt: new Date(nowMs - 3000_000),
          })
          .execute();

        await tx
          .insertInto('audioAssets')
          .values({
            id: id('aud'),
            workspaceId: a.workspaceId,
            meetingId,
            lane: 'them',
            storageKey: `workspaces/${a.workspaceId}/meetings/${meetingId}/them.ogg`,
            codec: 'opus',
            bytes: 1024,
            durationMs: 60_000,
            deleteAfter: expiredAt,
          })
          .execute();
      });

      const deletedAudioKeys: string[] = [];
      const storage: StorageCleanup = {
        async deleteAudioFile(storageKey: string) {
          deletedAudioKeys.push(storageKey);
        },
      };

      const task = retentionSweepTask({
        db: env.db,
        storage,
        now: () => nowMs,
      });

      // Run task directly
      await task.handle(
        { workspaceId: a.workspaceId, dryRun: false },
        { logger: { info: () => undefined, warn: () => undefined } } as any,
      );

      expect(deletedAudioKeys.length).toBe(1);
      expect(deletedAudioKeys[0]).toContain(meetingId);

      // Verify DB row was cleared of storageKey
      const asset = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('audioAssets').selectAll().where('meetingId', '=', meetingId).executeTakeFirst(),
      );
      expect(asset?.storageKey).toBeNull();
    });

    it('CRITICAL SAFETY: failed processing never deletes audio, even past delete_after (D-02, FR-SET-01)', async () => {
      const a = await createTestAccount();
      const failedMeetingId = id('mtg');
      const processingMeetingId = id('mtg');
      const nowMs = 1_700_000_000_000;
      const expiredAt = new Date(nowMs - 100_000); // well past expiry

      await env.db.inWorkspace(a.workspaceId, async (tx) => {
        // 1. Failed meeting
        await tx
          .insertInto('meetings')
          .values({
            id: failedMeetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'Failed Meeting',
            status: 'failed',
            startedAt: new Date(nowMs - 3600_000),
            endedAt: new Date(nowMs - 3000_000),
          })
          .execute();

        await tx
          .insertInto('audioAssets')
          .values({
            id: id('aud'),
            workspaceId: a.workspaceId,
            meetingId: failedMeetingId,
            lane: 'me',
            storageKey: `workspaces/${a.workspaceId}/meetings/${failedMeetingId}/me.ogg`,
            codec: 'opus',
            bytes: 2048,
            durationMs: 120_000,
            deleteAfter: expiredAt,
          })
          .execute();

        // 2. Still processing meeting
        await tx
          .insertInto('meetings')
          .values({
            id: processingMeetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'Processing Meeting',
            status: 'processing',
            startedAt: new Date(nowMs - 3600_000),
            endedAt: new Date(nowMs - 3000_000),
          })
          .execute();

        await tx
          .insertInto('audioAssets')
          .values({
            id: id('aud'),
            workspaceId: a.workspaceId,
            meetingId: processingMeetingId,
            lane: 'them',
            storageKey: `workspaces/${a.workspaceId}/meetings/${processingMeetingId}/them.ogg`,
            codec: 'opus',
            bytes: 4096,
            durationMs: 180_000,
            deleteAfter: expiredAt,
          })
          .execute();
      });

      const deletedAudioKeys: string[] = [];
      const storage: StorageCleanup = {
        async deleteAudioFile(storageKey: string) {
          deletedAudioKeys.push(storageKey);
        },
      };

      const task = retentionSweepTask({
        db: env.db,
        storage,
        now: () => nowMs,
      });

      await task.handle(
        { workspaceId: a.workspaceId, dryRun: false },
        { logger: { info: () => undefined, warn: () => undefined } } as any,
      );

      // Both audio files MUST be preserved!
      expect(deletedAudioKeys.length).toBe(0);

      const failedAsset = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('audioAssets').selectAll().where('meetingId', '=', failedMeetingId).executeTakeFirst(),
      );
      expect(failedAsset?.storageKey).not.toBeNull();

      const processingAsset = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('audioAssets').selectAll().where('meetingId', '=', processingMeetingId).executeTakeFirst(),
      );
      expect(processingAsset?.storageKey).not.toBeNull();
    });

    it('expires video assets when delete_after is reached', async () => {
      const a = await createTestAccount();
      const meetingId = id('mtg');
      const nowMs = 1_700_000_000_000;
      const expiredAt = new Date(nowMs - 50_000);

      await env.db.inWorkspace(a.workspaceId, async (tx) => {
        await tx
          .insertInto('meetings')
          .values({
            id: meetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'Video Meeting',
            status: 'ready',
            startedAt: new Date(nowMs - 3600_000),
          })
          .execute();

        await tx
          .insertInto('videoAssets')
          .values({
            id: `va_${meetingId}`,
            workspaceId: a.workspaceId,
            meetingId,
            partId: null,
            status: 'ready',
            mimeType: 'video/mp4',
            startMs: 0,
            durationMs: 60_000,
            fragments: 6,
            storageKey: `workspaces/${a.workspaceId}/meetings/${meetingId}/video/playback.mp4`,
            bytes: 5_000_000,
            deleteAfter: expiredAt,
          })
          .execute();
      });

      const deletedVideoKeys: string[] = [];
      const storage: StorageCleanup = {
        async deleteVideoFile(storageKey: string) {
          deletedVideoKeys.push(storageKey);
        },
      };

      const task = retentionSweepTask({
        db: env.db,
        storage,
        now: () => nowMs,
      });

      await task.handle(
        { workspaceId: a.workspaceId, dryRun: false },
        { logger: { info: () => undefined, warn: () => undefined } } as any,
      );

      expect(deletedVideoKeys.length).toBe(1);

      const videoAsset = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('videoAssets').selectAll().where('meetingId', '=', meetingId).executeTakeFirst(),
      );
      expect(videoAsset?.status).toBe('expired');
      expect(videoAsset?.storageKey).toBeNull();
    });
  });

  describe('Meeting deletion with 10s grace window and :restore (FR-SET-02, ARCHITECTURE §16.6)', () => {
    it('restoring within grace window cancels deletion (Undo flow)', async () => {
      const a = await createTestAccount();
      const meetingId = id('mtg');
      const now = new Date();

      // Create meeting with a segment
      await env.db.inWorkspace(a.workspaceId, async (tx) => {
        await tx
          .insertInto('meetings')
          .values({
            id: meetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'To Be Restored',
            status: 'ready',
            startedAt: now,
          })
          .execute();

        await tx
          .insertInto('transcriptSegments')
          .values({
            id: id('seg'),
            workspaceId: a.workspaceId,
            meetingId,
            lane: 'me',
            startMs: 0,
            endMs: 1000,
            text: 'Hello world',
            rawText: 'Hello world',
            language: 'en',
            source: 'live',
          })
          .execute();
      });

      // 1. User deletes meeting (schedules deletion with 10s grace)
      const { requestId } = await env.db.inWorkspace(a.workspaceId, (tx) =>
        scheduleMeetingDeletion(tx, {
          workspaceId: a.workspaceId,
          meetingId,
          graceMs: 10_000,
          now,
        }),
      );

      // Verify soft-deleted
      const softDeleted = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('meetings').select('deletedAt').where('id', '=', meetingId).executeTakeFirst(),
      );
      expect(softDeleted?.deletedAt).not.toBeNull();

      // 2. User presses Undo (restores meeting within grace window)
      const restored = await env.db.inWorkspace(a.workspaceId, (tx) =>
        cancelMeetingDeletion(tx, {
          workspaceId: a.workspaceId,
          meetingId,
          now: new Date(now.getTime() + 2_000),
        }),
      );
      expect(restored).toBe(true);

      // Verify meeting is active again
      const activeMeeting = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('meetings').select('deletedAt').where('id', '=', meetingId).executeTakeFirst(),
      );
      expect(activeMeeting?.deletedAt).toBeNull();

      // 3. Deletion job runs after 10s: must detect cancellation and NOT delete meeting!
      let storageDeleted = false;
      const task = meetingDeleteTask({
        db: env.db,
        storage: {
          async deleteMeetingFiles() {
            storageDeleted = true;
          },
        },
      });

      await task.handle(
        { workspaceId: a.workspaceId, meetingId, requestId },
        { logger: { info: () => undefined, warn: () => undefined } } as any,
      );

      expect(storageDeleted).toBe(false);

      // Meeting and transcript still exist in database
      const count = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('transcriptSegments').select('id').where('meetingId', '=', meetingId).execute(),
      );
      expect(count.length).toBe(1);
    });

    it('permanently deletes meeting and data after grace window expires', async () => {
      const a = await createTestAccount();
      const meetingId = id('mtg');
      const now = new Date();

      await env.db.inWorkspace(a.workspaceId, async (tx) => {
        await tx
          .insertInto('meetings')
          .values({
            id: meetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'Permanent Delete',
            status: 'ready',
            startedAt: now,
          })
          .execute();

        await tx
          .insertInto('notes')
          .values({
            id: id('not'),
            workspaceId: a.workspaceId,
            meetingId,
            sessionMs: 500,
            text: 'Important note',
          })
          .execute();
      });

      const { requestId } = await env.db.inWorkspace(a.workspaceId, (tx) =>
        scheduleMeetingDeletion(tx, {
          workspaceId: a.workspaceId,
          meetingId,
          graceMs: 10_000,
          now,
        }),
      );

      let storageDeletedMeetingId = '';
      const task = meetingDeleteTask({
        db: env.db,
        storage: {
          async deleteMeetingFiles(ws, mId) {
            storageDeletedMeetingId = mId;
          },
        },
      });

      // Run deletion task without prior cancellation
      await task.handle(
        { workspaceId: a.workspaceId, meetingId, requestId },
        { logger: { info: () => undefined, warn: () => undefined } } as any,
      );

      expect(storageDeletedMeetingId).toBe(meetingId);

      // Meeting and notes hard deleted
      const meeting = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('meetings').select('id').where('id', '=', meetingId).executeTakeFirst(),
      );
      expect(meeting).toBeUndefined();

      const notes = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('notes').select('id').where('meetingId', '=', meetingId).execute(),
      );
      expect(notes.length).toBe(0);

      // Deletion request audit log marked completed
      const req = await env.db.inWorkspace(a.workspaceId, (tx) =>
        tx.selectFrom('deletionRequests').select('completedAt').where('id', '=', requestId).executeTakeFirst(),
      );
      expect(req?.completedAt).not.toBeNull();
    });
  });

  describe('Account deletion audit trail (FR-SET-03)', () => {
    it('deletes account and workspace data while preserving audit record in deletion_requests', async () => {
      const a = await createTestAccount();
      const meetingId = id('mtg');
      const now = new Date();

      await env.db.inWorkspace(a.workspaceId, async (tx) => {
        await tx
          .insertInto('meetings')
          .values({
            id: meetingId,
            workspaceId: a.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            title: 'Account Meeting',
            status: 'ready',
            startedAt: now,
          })
          .execute();
      });

      const { requestId } = await env.db.inWorkspace(a.workspaceId, (tx) =>
        scheduleAccountDeletion(tx, {
          userId: a.userId,
          workspaceId: a.workspaceId,
          now,
        }),
      );

      const task = accountDeleteTask({
        db: env.db,
      });

      await task.handle(
        { userId: a.userId, workspaceId: a.workspaceId, requestId },
        { logger: { info: () => undefined, warn: () => undefined } } as any,
      );

      // Direct SQL check outside RLS context (audit logs persist without tenant scope)
      const auditLog = await env.pool.query(
        'SELECT id, workspace_id, scope, target_id, completed_at FROM deletion_requests WHERE id = $1',
        [requestId],
      );

      expect(auditLog.rows.length).toBe(1);
      expect(auditLog.rows[0].scope).toBe('account');
      expect(auditLog.rows[0].target_id).toBe(a.userId);
      expect(auditLog.rows[0].completed_at).not.toBeNull();
      // workspace_id set to null on cascade (ON DELETE SET NULL)
      expect(auditLog.rows[0].workspace_id).toBeNull();
    });
  });
});

