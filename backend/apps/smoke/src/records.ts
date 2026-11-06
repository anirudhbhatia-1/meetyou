import type { Db } from '@meetyou/db';

import { SmokeError } from './smoke.ts';

/**
 * Database checks the API cannot show (S2-07, S2-10). The smoke job holds the database URL, so it
 * reads the rows itself, scoped to the smoke workspace like any service (RLS stays on).
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** S2-07: the gateway writes the meeting's realtime usage row when the stream ends. */
export async function checkUsage(
  db: Db,
  workspaceId: string,
  meetingId: string,
  timeoutMs = 15_000,
): Promise<{ sttMsMe: number; sttMsThem: number }> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = await db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('usageRecords')
        .select(['sttSecondsMe', 'sttSecondsThem'])
        .where('meetingId', '=', meetingId)
        .executeTakeFirst(),
    );
    if (row !== undefined && Number(row.sttSecondsThem) > 0) {
      return {
        sttMsMe: Math.round(Number(row.sttSecondsMe) * 1000),
        sttMsThem: Math.round(Number(row.sttSecondsThem) * 1000),
      };
    }
    if (Date.now() > until) {
      throw new SmokeError('usage record', row === undefined ? 'missing' : 'no them seconds');
    }
    await sleep(1_000);
  }
}

/**
 * S2-10: after the 10 s grace the worker's `meeting.delete` removes the meeting and completes its
 * deletion request. Returns how long that took after the API's DELETE.
 */
export async function waitForDeletion(
  db: Db,
  workspaceId: string,
  meetingId: string,
  timeoutMs = 90_000,
  pollMs = 2_000,
): Promise<number> {
  const started = Date.now();
  for (;;) {
    const state = await db.inWorkspace(workspaceId, async (tx) => ({
      request: await tx
        .selectFrom('deletionRequests')
        .select('completedAt')
        .where('scope', '=', 'meeting')
        .where('targetId', '=', meetingId)
        .executeTakeFirst(),
      meeting: await tx
        .selectFrom('meetings')
        .select('id')
        .where('id', '=', meetingId)
        .executeTakeFirst(),
    }));
    if (state.request?.completedAt != null && state.meeting === undefined) {
      return Date.now() - started;
    }
    if (Date.now() - started > timeoutMs) {
      throw new SmokeError('meeting delete', state.request ? 'not completed' : 'no request');
    }
    await sleep(pollMs);
  }
}
