import { EXPORT_KEEP_MS } from '@meetyou/contracts';
import type { Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';
import { defineTask, enqueue } from '@meetyou/queue';
import { exportKey, type ObjectBucket } from '@meetyou/storage';
import { z } from 'zod';

import { buildArchive } from './archive.ts';
import { zip } from './zip.ts';

export const ACCOUNT_EXPORT = 'account.export';
export const EXPORT_EXPIRE = 'export.expire';

/** IDs only (ADR-0005 §3.1). */
export const ExportPayload = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  exportId: z.string().min(1),
});
export type ExportPayload = z.infer<typeof ExportPayload>;

/** Few attempts: a user is waiting, and the API reports a stale export as failed (S3-11). */
const EXPORT_ATTEMPTS = 3;

export const exportJob = {
  name: ACCOUNT_EXPORT,
  schema: ExportPayload,
  maxAttempts: EXPORT_ATTEMPTS,
} as const;

const expireJob = { name: EXPORT_EXPIRE, schema: ExportPayload, maxAttempts: 8 } as const;

const log = createLogger('export');

/**
 * Builds the "Download all my data" archive (S3-11, FR-SET-04): zip → bucket → row ready, and
 * schedules the file's deletion 24 hours later. The last failed attempt marks the export failed so
 * Settings can offer to try again.
 */
export function exportTask(deps: { db: Db; bucket: ObjectBucket; now?: () => number }) {
  const now = deps.now ?? Date.now;
  return defineTask(
    ACCOUNT_EXPORT,
    ExportPayload,
    async (payload, helpers) => {
      const { workspaceId, userId, exportId } = payload;
      const row = await deps.db.inWorkspace(workspaceId, (tx) =>
        tx.selectFrom('exports').select('status').where('id', '=', exportId).executeTakeFirst(),
      );
      if (row?.status !== 'preparing') return; // done, failed, or the account is gone
      try {
        const startedAt = new Date(now());
        const { entries, meetingCount } = await buildArchive(
          deps.db,
          workspaceId,
          userId,
          startedAt,
        );
        const data = zip(entries, startedAt);
        const key = exportKey(workspaceId, exportId);
        await deps.bucket.save(key, data, 'application/zip');
        const readyAt = new Date(now());
        const expiresAt = new Date(readyAt.getTime() + EXPORT_KEEP_MS);
        await deps.db.inWorkspace(workspaceId, async (tx) => {
          await tx
            .updateTable('exports')
            .set({
              status: 'ready',
              storageKey: key,
              sizeBytes: data.length,
              meetingCount,
              readyAt,
              expiresAt,
            })
            .where('id', '=', exportId)
            .execute();
          await enqueue(tx, expireJob, payload, {
            runAt: expiresAt,
            jobKey: `${EXPORT_EXPIRE}:${exportId}`,
          });
        });
        log.log('export.ready', { exportId, meetingCount, bytes: data.length });
      } catch (error: unknown) {
        log.log('export.attempt_failed', { exportId, code: errorCode(error) });
        if (helpers.job.attempts >= helpers.job.max_attempts) {
          await deps.db.inWorkspace(workspaceId, (tx) =>
            tx
              .updateTable('exports')
              .set({ status: 'failed' })
              .where('id', '=', exportId)
              .execute(),
          );
        }
        throw error;
      }
    },
    { maxAttempts: EXPORT_ATTEMPTS },
  );
}

/** Deletes an export's file once its 24 hours are over. */
export function exportExpireTask(deps: { db: Db; bucket: ObjectBucket }) {
  return defineTask(EXPORT_EXPIRE, ExportPayload, async ({ workspaceId, exportId }) => {
    const row = await deps.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('exports')
        .select(['status', 'storageKey'])
        .where('id', '=', exportId)
        .executeTakeFirst(),
    );
    if (row === undefined) return;
    if (row.storageKey !== null) await deps.bucket.delete(row.storageKey);
    await deps.db.inWorkspace(workspaceId, (tx) =>
      tx.updateTable('exports').set({ status: 'expired' }).where('id', '=', exportId).execute(),
    );
  });
}
