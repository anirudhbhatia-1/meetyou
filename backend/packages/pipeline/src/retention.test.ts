import { newUlid } from '@meetyou/contracts';
import { createMeetingForSession } from '@meetyou/db';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scheduleAudioRetention } from './retention.ts';

/** D-02 / ARCHITECTURE §9.2 step 9: audio gets its deletion time once the notes exist. */
describe('scheduleAudioRetention', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let workspaceId = '';

  beforeAll(async () => {
    env = await createQueueTestEnv();
    const account = await env.db.signInGoogleUser(
      { googleSub: 'ret', email: 'ret@example.com', displayName: 'Ret' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    workspaceId = account.workspaceId ?? '';
  }, 60_000);

  afterAll(async () => {
    await env.close();
  });

  async function meetingWithAudio(): Promise<string> {
    const meetingId = `mtg_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        startedAt: new Date('2026-11-09T04:00:00Z'),
      });
      for (const lane of ['me', 'them'] as const) {
        await tx
          .insertInto('audioAssets')
          .values({
            id: `aud_${meetingId}_${lane}`,
            workspaceId,
            meetingId,
            lane,
            storageKey: `ws/${workspaceId}/meetings/${meetingId}/audio/${lane}/`,
            codec: 'opus',
            bytes: 1000,
            durationMs: 60_000,
            deleteAfter: null,
          })
          .execute();
      }
    });
    return meetingId;
  }

  const sweeps = async (meetingId: string) =>
    (
      await env.pool.query<{ run_at: Date }>(
        `select run_at from graphile_worker.jobs where key = $1`,
        [`retention.sweep:${meetingId}:1`],
      )
    ).rows.map((r) => r.run_at.toISOString());

  const deleteAfter = (meetingId: string) =>
    env.db.inWorkspace(workspaceId, async (tx) =>
      (
        await tx
          .selectFrom('audioAssets')
          .select('deleteAfter')
          .where('meetingId', '=', meetingId)
          .execute()
      ).map((r) => r.deleteAfter?.toISOString()),
    );

  it('keeps audio for the chosen days after the meeting and schedules one sweep', async () => {
    const meetingId = await meetingWithAudio();
    const endedAt = new Date('2026-11-09T05:00:00Z');
    await env.db.inWorkspace(workspaceId, (tx) =>
      scheduleAudioRetention(tx, workspaceId, meetingId, endedAt),
    );
    expect(await deleteAfter(meetingId)).toEqual([
      '2026-11-16T05:00:00.000Z',
      '2026-11-16T05:00:00.000Z',
    ]);
    expect(await sweeps(meetingId)).toEqual(['2026-11-16T05:00:00.000Z']);
    // A second run (job retry) changes nothing.
    await env.db.inWorkspace(workspaceId, (tx) =>
      scheduleAudioRetention(tx, workspaceId, meetingId, new Date('2026-12-01T00:00:00Z')),
    );
    expect(await sweeps(meetingId)).toEqual(['2026-11-16T05:00:00.000Z']);
  });

  it('"delete immediately" deletes as soon as the notes exist', async () => {
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx.updateTable('userSettings').set({ retentionPolicy: 'immediate' }).execute(),
    );
    const meetingId = await meetingWithAudio();
    const now = new Date('2026-11-09T05:02:00Z');
    await env.db.inWorkspace(workspaceId, (tx) =>
      scheduleAudioRetention(tx, workspaceId, meetingId, new Date('2026-11-09T05:00:00Z'), now),
    );
    expect(await sweeps(meetingId)).toEqual([now.toISOString()]);
  });
});
