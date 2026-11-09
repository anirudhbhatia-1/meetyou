import { newUlid, type Segment } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting, storeSegments } from '@meetyou/db';
import type { BatchResult, SttBatchProvider } from '@meetyou/providers';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { audioChunkBase, MemoryBucket, oggOpusFile, readOggOpusPackets } from '@meetyou/storage';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureSelfParticipant } from '../meeting-data.ts';
import { acceptSummary, storeSummary } from '../store.ts';
import { joinLaneAudio } from './lane-audio.ts';
import { retranscribeTask } from './task.ts';

/** A 20 ms Opus silence frame (CELT, mono); content does not matter to the fake provider. */
const SILENCE = new Uint8Array([0xf8, 0xff, 0xfe]);

describe('joinLaneAudio', () => {
  it('joins chunks into one Ogg stream and maps file time back to the session clock', async () => {
    const bucket = new MemoryBucket();
    // Two 1 s chunks with a 30 s gap (paused) between them.
    for (const [startMs, firstSeq] of [
      [1_000, 0],
      [32_000, 50],
    ] as const) {
      const base = audioChunkBase('ws1', 'm1', 'them', startMs);
      const frames = Array.from({ length: 50 }, (_, i) => ({
        seq: firstSeq + i,
        captureMs: startMs + i * 20,
        durationMs: 20,
      }));
      await bucket.save(
        `${base}.opus`,
        oggOpusFile(
          Array.from({ length: 50 }, () => SILENCE),
          { serial: 1 },
        ),
        'audio/ogg',
      );
      await bucket.save(
        `${base}.json`,
        new TextEncoder().encode(
          JSON.stringify({ codec: 'opus', firstSeq, lastSeq: firstSeq + 49, frames }),
        ),
        'application/json',
      );
    }
    const joined = await joinLaneAudio(bucket, 'ws1', 'm1', 'them');
    expect(readOggOpusPackets(joined?.ogg ?? new Uint8Array())).toHaveLength(100);
    expect(joined?.timeMap.durationMs).toBe(2_000);
    expect(joined?.timeMap.toSession(0)).toBe(1_000);
    expect(joined?.timeMap.toSession(990)).toBe(1_990);
    expect(joined?.timeMap.toSession(1_010)).toBe(32_010);
    expect(await joinLaneAudio(bucket, 'ws1', 'm1', 'me')).toBeNull();
  });
});

/** S3-04 end to end on PGlite with RLS. */
describe('meeting.retranscribe', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let workspaceId = '';
  const helpers = {} as JobHelpers;

  beforeAll(async () => {
    env = await createQueueTestEnv();
    const account = await env.db.signInGoogleUser(
      { googleSub: 'batch', email: 'batch@example.com', displayName: 'Batch' },
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

  /** A finished meeting: live segments, notes citing them, a question, Meet signals, audio. */
  async function finished(bucket: MemoryBucket) {
    const meetingId = `mtg_${newUlid()}`;
    const live: Segment[] = [
      {
        lane: 'them',
        startMs: 0,
        endMs: 4_000,
        text: 'razor pay ka payment flow mein do bug hain',
        label: 'spk_1',
      },
      {
        lane: 'me',
        startMs: 5_000,
        endMs: 8_000,
        text: 'Main refund bug kal tak fix kar dunga',
        label: undefined,
      },
    ].map((s) => ({
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane: s.lane as Segment['lane'],
      ...(s.label !== undefined ? { speakerClusterId: s.label } : {}),
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      rawText: s.text,
      language: 'hi',
      source: 'live' as const,
      flags: [],
    }));
    let summaryId = '';
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        title: 'Payments',
        startedAt: new Date('2026-11-07T04:30:00Z'),
      });
      await storeSegments(tx, live, () => `spc_${newUlid()}`);
      await endMeeting(tx, meetingId, new Date('2026-11-07T04:40:00Z'));
      await tx
        .updateTable('meetings')
        .set({ status: 'ready' })
        .where('id', '=', meetingId)
        .execute();
      await ensureSelfParticipant(tx, workspaceId, meetingId);
      await tx
        .insertInto('participants')
        .values({
          id: `prt_${newUlid()}`,
          workspaceId,
          meetingId,
          displayName: 'Neha Kapoor',
          source: 'dom',
          externalId: 'meet-neha',
        })
        .execute();
      await tx
        .insertInto('speakerSignals')
        .values(
          [0, 2_000].map((atMs) => ({
            id: `sps_${newUlid()}`,
            workspaceId,
            meetingId,
            externalId: 'meet-neha',
            atMs,
          })),
        )
        .execute();
      ({ summaryId } = await storeSummary(tx, {
        workspaceId,
        meetingId,
        template: 'general',
        language: 'hinglish',
        model: 'fake',
        accepted: true,
        usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
        summary: {
          title: 'Payments',
          overview: 'Two bugs.',
          report: {
            citationsDropped: 0,
            unverified: 0,
            ownersUnassigned: 0,
            datesResolved: 0,
            unknownNotes: 0,
          },
          items: [
            {
              kind: 'decision',
              text: 'Fix both bugs first',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: null,
              duePhrase: null,
              segmentIds: [live[0]?.id ?? '', live[1]?.id ?? ''],
              flagged: false,
              order: 0,
            },
          ],
        },
      }));
      await tx
        .insertInto('meetingQuestions')
        .values({
          id: `qst_${newUlid()}`,
          workspaceId,
          meetingId,
          userId: (await tx.selectFrom('memberships').select('userId').executeTakeFirstOrThrow())
            .userId,
          question: 'Kitne bugs?',
          status: 'answered',
          answer: 'Do.',
          segmentIds: [live[0]?.id ?? ''],
          model: 'fake',
        })
        .execute();
    });
    for (const lane of ['me', 'them'] as const) {
      const base = audioChunkBase(workspaceId, meetingId, lane, 0);
      const frames = Array.from({ length: 500 }, (_, i) => ({
        seq: i,
        captureMs: i * 20,
        durationMs: 20,
      }));
      await bucket.save(
        `${base}.opus`,
        oggOpusFile(
          frames.map(() => SILENCE),
          { serial: 2 },
        ),
        'audio/ogg',
      );
      await bucket.save(
        `${base}.json`,
        new TextEncoder().encode(
          JSON.stringify({ codec: 'opus', firstSeq: 0, lastSeq: 499, frames }),
        ),
        'application/json',
      );
    }
    return { meetingId, live, summaryId };
  }

  function stt(
    byLane: Record<'me' | 'them', BatchResult['segments']>,
    calls: boolean[] = [],
  ): SttBatchProvider {
    return {
      name: 'fake',
      usdPerMinute: 0.01,
      async transcribe(_audio, options) {
        calls.push(options?.diarize === true);
        return {
          segments: options?.diarize === true ? byLane.them : byLane.me,
          durationMs: 10_000,
          provider: 'fake',
          model: 'fake-batch',
          requestId: null,
        };
      },
    };
  }

  const state = (meetingId: string) =>
    env.db.inWorkspace(workspaceId, async (tx) => ({
      segments: await tx
        .selectFrom('transcriptSegments')
        .select(['id', 'lane', 'source', 'text', 'speakerClusterId'])
        .where('meetingId', '=', meetingId)
        .orderBy('startMs')
        .execute(),
      citations: await tx
        .selectFrom('citations')
        .select('segmentId')
        .where('meetingId', '=', meetingId)
        .execute(),
      clusters: await tx
        .selectFrom('speakerClusters as c')
        .leftJoin('participants as p', 'p.id', 'c.participantId')
        .select(['c.id', 'c.providerLabel', 'p.displayName'])
        .where('c.meetingId', '=', meetingId)
        .execute(),
      question: await tx
        .selectFrom('meetingQuestions')
        .select('segmentIds')
        .where('meetingId', '=', meetingId)
        .executeTakeFirstOrThrow(),
      usage: await tx
        .selectFrom('usageRecords')
        .select(['sttProvider', 'sttSecondsMe', 'sttSecondsThem'])
        .where('meetingId', '=', meetingId)
        .where('sttProvider', '=', 'fake:batch')
        .orderBy('sttSecondsThem')
        .execute(),
    }));

  it('replaces a materially different transcript, keeps citations, names speakers and rewrites the notes', async () => {
    const bucket = new MemoryBucket();
    const { meetingId, live } = await finished(bucket);
    const calls: boolean[] = [];
    await retranscribeTask({
      db: env.db,
      bucket,
      stt: stt(
        {
          them: [
            {
              startMs: 0,
              endMs: 4_100,
              speaker: 0,
              text: 'Razorpay ka payment flow mein do bugs hain.',
              words: [],
            },
          ],
          me: [
            {
              startMs: 5_000,
              endMs: 8_000,
              text: 'Main refund bug kal tak fix kar dunga.',
              words: [],
            },
          ],
        },
        calls,
      ),
    }).handle({ workspaceId, meetingId }, helpers);
    expect(calls).toEqual([false, true]); // diarization on the `them` lane only

    const after = await state(meetingId);
    expect(after.segments.map((s) => [s.lane, s.source, s.text])).toEqual([
      ['them', 'batch', 'Razorpay ka payment flow mein do bugs hain.'],
      ['me', 'batch', 'Main refund bug kal tak fix kar dunga.'],
    ]);
    const ids = after.segments.map((s) => s.id);
    expect(after.citations.map((c) => c.segmentId).sort()).toEqual([...ids].sort());
    expect(after.question.segmentIds).toEqual([ids[0]]);
    expect(live.some((s) => ids.includes(s.id))).toBe(false);
    expect(after.clusters).toEqual([
      expect.objectContaining({ providerLabel: 'batch_spk_1', displayName: 'Neha Kapoor' }),
    ]);
    expect(after.segments[0]?.speakerClusterId).toBe(after.clusters[0]?.id);
    // One usage row per billed call.
    expect(after.usage.map((u) => [u.sttSecondsMe, u.sttSecondsThem])).toEqual([
      ['10.000', '0.000'],
      ['0.000', '10.000'],
    ]);
    const jobs = await env.pool.query<{ key: string }>(
      `select key from graphile_worker.jobs where key = $1`,
      [`meeting.summarize:${meetingId}:batch`],
    );
    expect(jobs.rows).toHaveLength(1);
  });

  it('keeps the live segments when the words barely changed, but still names the speakers', async () => {
    const bucket = new MemoryBucket();
    const { meetingId, live } = await finished(bucket);
    await retranscribeTask({
      db: env.db,
      bucket,
      stt: stt({
        them: [
          {
            startMs: 0,
            endMs: 4_000,
            speaker: 0,
            text: 'razor pay ka payment flow mein do bug hain',
            words: [],
          },
        ],
        me: [
          {
            startMs: 5_000,
            endMs: 8_000,
            text: 'Main refund bug kal tak fix kar dunga',
            words: [],
          },
        ],
      }),
    }).handle({ workspaceId, meetingId }, helpers);
    const after = await state(meetingId);
    expect(after.segments.map((s) => s.id)).toEqual(live.map((s) => s.id));
    expect(after.clusters).toEqual([
      expect.objectContaining({ providerLabel: 'spk_1', displayName: 'Neha Kapoor' }),
    ]);
    const jobs = await env.pool.query(`select 1 from graphile_worker.jobs where key = $1`, [
      `meeting.summarize:${meetingId}:batch`,
    ]);
    expect(jobs.rows).toHaveLength(0);
  });

  it('replaces only the lanes it re-read: a failed lane keeps its live transcript', async () => {
    const bucket = new MemoryBucket();
    const { meetingId, live } = await finished(bucket);
    const failing: SttBatchProvider = {
      name: 'fake',
      usdPerMinute: 0.01,
      async transcribe(_audio, options) {
        if (options?.diarize !== true) {
          throw Object.assign(new Error('bad audio'), { status: 400 });
        }
        return {
          segments: [
            {
              startMs: 0,
              endMs: 4_100,
              speaker: 0,
              text: 'Razorpay ka payment flow mein do bugs hain.',
              words: [],
            },
          ],
          durationMs: 10_000,
          provider: 'fake',
          model: 'fake-batch',
          requestId: null,
        };
      },
    };
    await retranscribeTask({ db: env.db, bucket, stt: failing }).handle(
      { workspaceId, meetingId },
      helpers,
    );
    const after = await state(meetingId);
    expect(after.segments.map((s) => [s.lane, s.source])).toEqual([
      ['them', 'batch'],
      ['me', 'live'],
    ]);
    // The `me` line is still cited: only `them` citations moved.
    expect(after.citations.map((c) => c.segmentId)).toContain(live[1]?.id);
    expect(after.usage).toHaveLength(1);
  });

  it('carries done action items over to the rewritten notes', async () => {
    const bucket = new MemoryBucket();
    const { meetingId, summaryId } = await finished(bucket);
    await env.db.inWorkspace(workspaceId, async (tx) => {
      const { summaryId: withAction } = await storeSummary(tx, {
        workspaceId,
        meetingId,
        template: 'general',
        language: 'hinglish',
        model: 'fake',
        accepted: true,
        usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
        summary: {
          title: 'Payments',
          overview: '',
          report: {
            citationsDropped: 0,
            unverified: 0,
            ownersUnassigned: 0,
            datesResolved: 0,
            unknownNotes: 0,
          },
          items: [
            {
              kind: 'action_item',
              text: 'Fix the refund bug',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: null,
              duePhrase: null,
              segmentIds: [],
              flagged: false,
              order: 0,
            },
            {
              kind: 'action_item',
              text: 'Send the deck',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: null,
              duePhrase: null,
              segmentIds: [],
              flagged: false,
              order: 1,
            },
          ],
        },
      });
      expect(withAction).not.toBe(summaryId);
      await tx
        .updateTable('summaryItems')
        .set({ status: 'done', completedAt: new Date('2026-11-08T00:00:00Z') })
        .where('summaryId', '=', withAction)
        .where('text', '=', 'Fix the refund bug')
        .execute();
      const { summaryId: rewritten } = await storeSummary(tx, {
        workspaceId,
        meetingId,
        template: 'general',
        language: 'hinglish',
        model: 'fake',
        accepted: false,
        usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
        summary: {
          title: 'Payments',
          overview: '',
          report: {
            citationsDropped: 0,
            unverified: 0,
            ownersUnassigned: 0,
            datesResolved: 0,
            unknownNotes: 0,
          },
          items: [
            {
              kind: 'action_item',
              text: 'Fix the refund bug by Friday',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: null,
              duePhrase: null,
              segmentIds: [],
              flagged: false,
              order: 0,
            },
            {
              kind: 'action_item',
              text: 'Share the pricing deck',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: null,
              duePhrase: null,
              segmentIds: [],
              flagged: false,
              order: 1,
            },
          ],
        },
      });
      await acceptSummary(tx, meetingId, rewritten);
      const items = await tx
        .selectFrom('summaryItems')
        .select(['text', 'status', 'completedAt'])
        .where('summaryId', '=', rewritten)
        .orderBy('order')
        .execute();
      expect(items.map((i) => [i.text, i.status])).toEqual([
        ['Fix the refund bug by Friday', 'done'],
        ['Share the pricing deck', 'open'],
      ]);
      expect(items[0]?.completedAt?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
      const accepted = await tx
        .selectFrom('summaries')
        .select('id')
        .where('meetingId', '=', meetingId)
        .where('accepted', '=', true)
        .execute();
      expect(accepted.map((a) => a.id)).toEqual([rewritten]);
    });
  });
});
