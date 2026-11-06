import { newUlid, type Segment } from '@meetyou/contracts';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createMeetingForSession,
  endMeeting,
  glossaryTerms,
  meetingForSession,
  realtimeUsageId,
  storeSegments,
  upsertRealtimeUsage,
  upsertVideoAsset,
} from './meetings-repo.ts';
import { createTestDb } from './testing.ts';

let env: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  env = await createTestDb();
});

afterEach(async () => {
  await env.close();
});

const id = (prefix: string) => `${prefix}_${newUlid()}`;

async function workspace(): Promise<string> {
  const result = await env.db.signInGoogleUser(
    { googleSub: id('sub'), email: 'a@example.com', displayName: 'A' },
    { userId: id('usr'), workspaceId: id('ws'), membershipId: id('mem'), settingsId: id('set') },
  );
  if (result.workspaceId === null) throw new Error('no workspace');
  return result.workspaceId;
}

async function meeting(workspaceId: string): Promise<{ meetingId: string; sessionId: string }> {
  const meetingId = id('mtg');
  const sessionId = id('ses');
  await env.db.inWorkspace(workspaceId, (tx) =>
    createMeetingForSession(tx, {
      id: meetingId,
      workspaceId,
      sessionId,
      externalMeetingCode: 'abc-defg-hij',
      startedAt: new Date('2026-11-06T10:00:00Z'),
    }),
  );
  return { meetingId, sessionId };
}

function segment(workspaceId: string, meetingId: string, extra: Partial<Segment> = {}): Segment {
  return {
    id: id('seg'),
    workspaceId,
    meetingId,
    lane: 'them',
    startMs: 1000,
    endMs: 2500,
    text: 'Kal tak bhej dena.',
    rawText: 'कल तक भेज देना.',
    language: 'hi',
    source: 'live',
    words: [{ text: 'Kal', startMs: 1000, endMs: 1200 }],
    flags: [],
    ...extra,
  };
}

describe('realtime-path writes (S2-04, S2-05, S2-07, S2-14)', () => {
  it('creates the meeting for a session and finds it again', async () => {
    const ws = await workspace();
    const { meetingId, sessionId } = await meeting(ws);
    expect(await env.db.inWorkspace(ws, (tx) => meetingForSession(tx, sessionId))).toEqual({
      id: meetingId,
      endedAt: null,
    });
    // Another workspace cannot see it (RLS).
    const other = await workspace();
    expect(await env.db.inWorkspace(other, (tx) => meetingForSession(tx, sessionId))).toBe(
      undefined,
    );
  });

  it('stores segments with text and raw text, one cluster row per provider label, idempotently', async () => {
    const ws = await workspace();
    const { meetingId } = await meeting(ws);
    const a = segment(ws, meetingId, { speakerClusterId: 'spk_1' });
    const b = segment(ws, meetingId, { speakerClusterId: 'spk_1', startMs: 3000, endMs: 4000 });
    const c = segment(ws, meetingId, { lane: 'me', flags: ['echo'] });
    await env.db.inWorkspace(ws, (tx) => storeSegments(tx, [a, b, c], () => id('spc')));
    // A retry of the same batch changes nothing.
    await env.db.inWorkspace(ws, (tx) => storeSegments(tx, [a], () => id('spc')));

    const rows = await env.db.inWorkspace(ws, (tx) =>
      tx
        .selectFrom('transcriptSegments')
        .select(['id', 'text', 'rawText', 'speakerClusterId', 'flags', 'startMs'])
        .orderBy('startMs')
        .execute(),
    );
    expect(rows).toHaveLength(3);
    const them = rows.filter((r) => r.speakerClusterId !== null);
    expect(new Set(them.map((r) => r.speakerClusterId)).size).toBe(1);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({
      text: 'Kal tak bhej dena.',
      rawText: 'कल तक भेज देना.',
    });
    expect(rows.find((r) => r.id === c.id)?.flags).toEqual(['echo']);
    const clusters = await env.db.inWorkspace(ws, (tx) =>
      tx.selectFrom('speakerClusters').select(['providerLabel', 'lane']).execute(),
    );
    expect(clusters).toEqual([{ providerLabel: 'spk_1', lane: 'them' }]);
  });

  it('ends a meeting once and moves it to processing', async () => {
    const ws = await workspace();
    const { meetingId } = await meeting(ws);
    const first = new Date('2026-11-06T10:30:00Z');
    await env.db.inWorkspace(ws, (tx) => endMeeting(tx, meetingId, first));
    await env.db.inWorkspace(ws, (tx) => endMeeting(tx, meetingId, new Date()));
    const row = await env.db.inWorkspace(ws, (tx) =>
      tx
        .selectFrom('meetings')
        .select(['status', 'endedAt', 'processingStep'])
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ status: 'processing', endedAt: first, processingStep: 'finalizing' });
  });

  it('keeps one realtime usage row per meeting, updated as counts grow', async () => {
    const ws = await workspace();
    const { meetingId } = await meeting(ws);
    const base = {
      workspaceId: ws,
      meetingId,
      sttProvider: 'deepgram',
      sttSecondsMe: 10,
      sttSecondsThem: 12.5,
      storageBytes: 1000,
      estimatedCostUsd: 0.0035,
    };
    await env.db.inWorkspace(ws, (tx) => upsertRealtimeUsage(tx, base));
    await env.db.inWorkspace(ws, (tx) =>
      upsertRealtimeUsage(tx, { ...base, sttSecondsMe: 60, storageBytes: 5000 }),
    );
    const rows = await env.db.inWorkspace(ws, (tx) =>
      tx
        .selectFrom('usageRecords')
        .select(['id', 'sttSecondsMe', 'sttSecondsThem', 'storageBytes', 'estimatedCostUsd'])
        .execute(),
    );
    expect(rows).toEqual([
      {
        id: realtimeUsageId(meetingId),
        sttSecondsMe: '60.000',
        sttSecondsThem: '12.500',
        storageBytes: 5000,
        estimatedCostUsd: '0.003500',
      },
    ]);
  });

  it('upserts video assets per part and one finalized row per meeting', async () => {
    const ws = await workspace();
    const { meetingId } = await meeting(ws);
    const row = {
      id: id('va'),
      workspaceId: ws,
      meetingId,
      partId: null,
      status: 'processing' as const,
      mimeType: 'video/mp4' as const,
      startMs: 0,
      durationMs: null,
      fragments: 3,
      storageKey: null,
      bytes: null,
      deleteAfter: null,
    };
    await env.db.inWorkspace(ws, (tx) => upsertVideoAsset(tx, row));
    await env.db.inWorkspace(ws, (tx) =>
      upsertVideoAsset(tx, { ...row, id: id('va'), status: 'ready', durationMs: 30_000 }),
    );
    const rows = await env.db.inWorkspace(ws, (tx) =>
      tx.selectFrom('videoAssets').select(['id', 'status', 'durationMs']).execute(),
    );
    expect(rows).toEqual([{ id: row.id, status: 'ready', durationMs: 30_000 }]);
  });

  it('reads the workspace glossary for STT key terms', async () => {
    const ws = await workspace();
    await env.db.inWorkspace(ws, (tx) =>
      sql`insert into glossary_terms (id, workspace_id, term) values
          (${id('gt')}, ${ws}, 'Minutes'), (${id('gt')}, ${ws}, 'Deepgram')`.execute(tx),
    );
    expect(await env.db.inWorkspace(ws, glossaryTerms)).toEqual(['Deepgram', 'Minutes']);
  });
});
