import { newUlid, type Segment, type SummaryOutput } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting, storeSegments } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import { LlmHttpError, LlmRefusedError, type LlmProvider } from '@meetyou/providers';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { summarizeTask } from './task.ts';

/** The fast path end to end on PGlite with RLS (S3-03). */
describe('meeting.summarize', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let workspaceId = '';
  const helpers = {} as JobHelpers;

  beforeAll(async () => {
    env = await createTestDb();
    const account = await env.db.signInGoogleUser(
      { googleSub: 'pipe', email: 'pipe@example.com', displayName: 'Pipe' },
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

  async function recorded(texts: string[]): Promise<{ meetingId: string; segs: Segment[] }> {
    const meetingId = `mtg_${newUlid()}`;
    const segs: Segment[] = texts.map((text, i) => ({
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane: i % 2 === 0 ? 'them' : 'me',
      startMs: i * 4_000,
      endMs: i * 4_000 + 3_000,
      text,
      rawText: text,
      language: 'hi',
      source: 'live',
      flags: [],
    }));
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        startedAt: new Date('2026-11-07T04:30:00Z'), // 10:00 in India
      });
      await storeSegments(tx, segs, () => `spc_${newUlid()}`);
      await endMeeting(tx, meetingId, new Date('2026-11-07T04:40:00Z'));
    });
    return { meetingId, segs };
  }

  function llm(
    answer: (selfId: string) => SummaryOutput | Error,
    calls: string[] = [],
  ): LlmProvider {
    return {
      name: 'fake',
      model: 'fake-model',
      async generateStructured(request) {
        calls.push(request.input);
        const self = /(prt_[0-9A-Z]+) \| You \| the user/.exec(request.input)?.[1] ?? 'missing';
        const next = answer(self);
        if (next instanceof Error) throw next;
        return {
          json: next,
          usage: { inputTokens: 1000, outputTokens: 300, thinkingTokens: 200 },
          model: 'fake-model-001',
        };
      },
    };
  }

  const row = (meetingId: string) =>
    env.db.inWorkspace(workspaceId, async (tx) => ({
      meeting: await tx
        .selectFrom('meetings')
        .select(['status', 'processingStep', 'title'])
        .where('id', '=', meetingId)
        .executeTakeFirstOrThrow(),
      summaries: await tx
        .selectFrom('summaries')
        .select(['id', 'version', 'status', 'accepted', 'overview', 'template'])
        .where('meetingId', '=', meetingId)
        .orderBy('version')
        .execute(),
      items: await tx
        .selectFrom('summaryItems')
        .select(['kind', 'ownerParticipantId', 'dueDate', 'status', 'flagged', 'summaryId'])
        .where('meetingId', '=', meetingId)
        .orderBy('order')
        .execute(),
      citations: await tx
        .selectFrom('citations')
        .select(['segmentId'])
        .where('meetingId', '=', meetingId)
        .execute(),
      usage: await tx
        .selectFrom('usageRecords')
        .select(['llmModel', 'inputTokens', 'outputTokens'])
        .where('meetingId', '=', meetingId)
        .execute(),
    }));

  it('summarizes, validates and stores the first version; the meeting becomes ready', async () => {
    const { meetingId, segs } = await recorded([
      'Decision: release Friday tak move karte hain.',
      'Theek hai, main kal tak release notes bhej dunga.',
    ]);
    const task = summarizeTask({
      db: env.db,
      llm: llm((self) => ({
        title: 'Release sync',
        overview: 'Release moved to Friday.',
        anchored_sections: [],
        decisions: [{ text: 'Release moves to Friday', segment_ids: [segs[0]?.id ?? ''] }],
        action_items: [
          {
            task: 'Send release notes',
            owner_participant_id: self,
            due_date: null,
            due_phrase: 'kal tak',
            segment_ids: [segs[1]?.id ?? ''],
          },
        ],
        open_questions: [],
        topics: ['release'],
      })),
    });
    await task.handle({ workspaceId, meetingId, reason: 'session_end' }, helpers);
    const r = await row(meetingId);
    expect(r.meeting).toEqual({ status: 'ready', processingStep: 'done', title: 'Release sync' });
    expect(r.summaries).toMatchObject([{ version: 1, status: 'ready', accepted: true }]);
    const action = r.items.find((i) => i.kind === 'action_item');
    expect(action).toMatchObject({ dueDate: '2026-11-08', status: 'open', flagged: false });
    expect(action?.ownerParticipantId).toMatch(/^prt_/);
    expect(r.citations).toHaveLength(2);
    expect(r.usage).toEqual([{ llmModel: 'fake-model-001', inputTokens: 1000, outputTokens: 500 }]);
  });

  it('adds a regenerated version as a candidate, leaving the meeting and accepted notes alone', async () => {
    const { meetingId, segs } = await recorded([
      'Standup shuru karte hain.',
      'Kal maine fix kiya.',
    ]);
    const out = (): SummaryOutput => ({
      title: 'Standup',
      overview: 'Updates.',
      anchored_sections: [],
      decisions: [],
      action_items: [],
      open_questions: [],
      topics: [],
    });
    const task = summarizeTask({ db: env.db, llm: llm(out) });
    await task.handle({ workspaceId, meetingId, reason: 'session_end' }, helpers);
    await task.handle(
      { workspaceId, meetingId, reason: 'regenerate', template: 'standup' },
      helpers,
    );
    const r = await row(meetingId);
    expect(r.summaries).toMatchObject([
      { version: 1, accepted: true, template: 'general' },
      { version: 2, accepted: false, template: 'standup' },
    ]);
    expect(r.meeting.status).toBe('ready');
    expect(segs).toHaveLength(2);
  });

  it('marks the meeting failed (no retry) when the model output stays invalid or is refused', async () => {
    const { meetingId } = await recorded(['Kuch baat hui.']);
    const task = summarizeTask({ db: env.db, llm: llm(() => new LlmRefusedError('SAFETY')) });
    await task.handle({ workspaceId, meetingId, reason: 'session_end' }, helpers);
    const r = await row(meetingId);
    expect(r.meeting.status).toBe('failed');
    expect(r.summaries).toMatchObject([{ status: 'failed', accepted: false }]);
  });

  it('leaves readable notes alone when the batch re-summary fails or finds no speech', async () => {
    const { meetingId } = await recorded(['Kuch baat hui.']);
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx.updateTable('meetings').set({ status: 'ready' }).where('id', '=', meetingId).execute(),
    );
    const refusing = summarizeTask({ db: env.db, llm: llm(() => new LlmRefusedError('SAFETY')) });
    await refusing.handle({ workspaceId, meetingId, reason: 'batch' }, helpers);
    expect((await row(meetingId)).meeting).toMatchObject({
      status: 'ready',
      processingStep: 'done',
    });
    const silent = await recorded([]);
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .updateTable('meetings')
        .set({ status: 'ready' })
        .where('id', '=', silent.meetingId)
        .execute(),
    );
    await summarizeTask({ db: env.db, llm: null }).handle(
      { workspaceId, meetingId: silent.meetingId, reason: 'batch' },
      helpers,
    );
    expect((await row(silent.meetingId)).meeting.status).toBe('ready');
  });

  it('turns a rewrite after a failed first run into the notes', async () => {
    const { meetingId, segs } = await recorded([
      'Decision: release Friday tak.',
      'Main notes bhejunga.',
    ]);
    await summarizeTask({ db: env.db, llm: llm(() => new LlmRefusedError('SAFETY')) }).handle(
      { workspaceId, meetingId, reason: 'session_end' },
      helpers,
    );
    expect((await row(meetingId)).meeting.status).toBe('failed');
    await summarizeTask({
      db: env.db,
      llm: llm(() => ({
        title: 'Release',
        overview: 'Release moves.',
        anchored_sections: [],
        decisions: [{ text: 'Release Friday', segment_ids: [segs[0]?.id ?? ''] }],
        action_items: [],
        open_questions: [],
        topics: [],
      })),
    }).handle({ workspaceId, meetingId, reason: 'regenerate' }, helpers);
    const r = await row(meetingId);
    expect(r.meeting.status).toBe('ready');
    expect(r.summaries.filter((s) => s.accepted)).toHaveLength(1);
  });

  it('lets the queue retry vendor outages', async () => {
    const { meetingId } = await recorded(['Kuch baat hui.']);
    const task = summarizeTask({ db: env.db, llm: llm(() => new LlmHttpError(503)) });
    await expect(
      task.handle({ workspaceId, meetingId, reason: 'session_end' }, helpers),
    ).rejects.toBeInstanceOf(LlmHttpError);
    expect((await row(meetingId)).meeting).toMatchObject({
      status: 'processing',
      processingStep: 'summarizing',
    });
  });

  it('marks silent recordings too short, and finishes without notes when no model is set', async () => {
    const silent = await recorded([]);
    const calls: string[] = [];
    await summarizeTask({ db: env.db, llm: llm(() => new Error('unused'), calls) }).handle(
      { workspaceId, meetingId: silent.meetingId, reason: 'session_end' },
      helpers,
    );
    expect((await row(silent.meetingId)).meeting.status).toBe('too_short');
    expect(calls).toHaveLength(0);

    const spoken = await recorded(['Hello sab.']);
    await summarizeTask({ db: env.db, llm: null }).handle(
      { workspaceId, meetingId: spoken.meetingId, reason: 'session_end' },
      helpers,
    );
    const r = await row(spoken.meetingId);
    expect(r.meeting.status).toBe('ready');
    expect(r.summaries).toEqual([]);
  });
});
