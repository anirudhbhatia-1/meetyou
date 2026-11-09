import type { WorkspaceTx } from '@meetyou/db';
import { enqueue, jobKey, RETENTION_SWEEP, retentionSweepJob } from '@meetyou/queue';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = { immediate: 0, '7d': 7, '30d': 30 } as const;

/**
 * ARCHITECTURE §9.2 step 9: once the first notes exist, the meeting's audio gets its deletion
 * time from the user's retention setting (D-02) and the sweep is scheduled for then. "Delete
 * immediately" is applied only here, after the summary succeeded, never on a failed run. Same
 * time and job key as `video.finalize` uses, so one sweep removes both recordings.
 */
export async function scheduleAudioRetention(
  tx: WorkspaceTx,
  workspaceId: string,
  meetingId: string,
  endedAt: Date,
  now: Date = new Date(),
): Promise<Date | null> {
  const settings = await tx
    .selectFrom('userSettings')
    .select('retentionPolicy')
    .limit(1)
    .executeTakeFirst();
  const policy = settings?.retentionPolicy ?? '7d';
  const deleteAfter =
    policy === 'immediate' ? now : new Date(endedAt.getTime() + RETENTION_DAYS[policy] * DAY_MS);
  const updated = await tx
    .updateTable('audioAssets')
    .set({ deleteAfter })
    .where('meetingId', '=', meetingId)
    .where('deleteAfter', 'is', null)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) return null;
  await enqueue(
    tx,
    retentionSweepJob,
    { workspaceId, meetingId, dryRun: false },
    { runAt: deleteAfter, jobKey: jobKey(RETENTION_SWEEP, meetingId, 1) },
  );
  return deleteAfter;
}
