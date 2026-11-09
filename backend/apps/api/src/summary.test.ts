import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import {
  ActionItemList,
  MeetingSummaryResponse,
  newUlid,
  SummaryItem,
  type Segment,
  type SummaryOutput,
} from '@meetyou/contracts';
import { createMeetingForSession, endMeeting, storeSegments } from '@meetyou/db';
import { summarizeTask } from '@meetyou/pipeline';
import type { LlmProvider } from '@meetyou/providers';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import type { JobHelpers } from 'graphile-worker';

import { buildApp } from './app.ts';

/** S3-08 summary endpoints and the S3-03 progress stream, on stored pipeline output. */
describe('summary endpoints', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tokens: TokenService;
  const people: { workspaceId: string; token: string }[] = [];
  let meetingId = '';
  let segs: Segment[] = [];

  const llm = (version: string): LlmProvider => ({
    name: 'fake',
    model: 'fake-model',
    async generateStructured(request) {
      const self = /(prt_[0-9A-Z]+) \| You \| the user/.exec(request.input)?.[1] ?? 'unassigned';
      const out: SummaryOutput = {
        title: 'Release sync',
        overview: `Overview ${version}`,
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
      };
      return {
        json: out,
        usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
        model: 'fake',
      };
    },
  });

  const auth = (who = 0) => ({ authorization: `Bearer ${people[who]?.token}` });

  beforeAll(async () => {
    env = await createQueueTestEnv();
    tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    for (const sub of ['owner', 'stranger']) {
      const account = await env.db.signInGoogleUser(
        { googleSub: sub, email: `${sub}@example.com`, displayName: sub },
        {
          userId: `usr_${newUlid()}`,
          workspaceId: `ws_${newUlid()}`,
          membershipId: `mem_${newUlid()}`,
          settingsId: `set_${newUlid()}`,
        },
      );
      const workspaceId = account.workspaceId ?? '';
      const { token } = await tokens.issueAccessToken({
        userId: account.userId,
        workspaceId,
        scope: 'user',
      });
      people.push({ workspaceId, token });
    }
    const workspaceId = people[0]?.workspaceId ?? '';
    meetingId = `mtg_${newUlid()}`;
    segs = ['Decision: release Friday tak.', 'Main kal tak notes bhej dunga.'].map((text, i) => ({
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane: i === 0 ? 'them' : 'me',
      startMs: i * 5_000,
      endMs: i * 5_000 + 3_000,
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
        startedAt: new Date('2026-11-07T04:30:00Z'),
      });
      await storeSegments(tx, segs, () => `spc_${newUlid()}`);
      await endMeeting(tx, meetingId, new Date('2026-11-07T04:40:00Z'));
    });
    await summarizeTask({ db: env.db, llm: llm('v1') }).handle(
      { workspaceId, meetingId, reason: 'session_end' },
      {} as JobHelpers,
    );
    app = await buildApp({ tokens, db: env.db, config: { env: 'test' } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const summary = async (who = 0) => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}/summary`,
      headers: auth(who),
    });
    return {
      status: res.statusCode,
      body: res.statusCode === 200 ? MeetingSummaryResponse.parse(res.json()) : null,
    };
  };

  it('returns the stored notes with citations, owners and resolved dates', async () => {
    const { body } = await summary();
    expect(body?.current).toMatchObject({
      version: 1,
      overview: 'Overview v1',
      template: 'general',
    });
    expect(body?.candidate).toBeNull();
    const action = body?.current?.items.find((i) => i.kind === 'action_item');
    expect(action).toMatchObject({
      dueDate: '2026-11-08',
      status: 'open',
      segmentIds: [segs[1]?.id],
    });
    expect(body?.participants.find((p) => p.id === action?.ownerParticipantId)?.isSelf).toBe(true);
  });

  it("is 404 for another user's meeting", async () => {
    expect((await summary(1)).status).toBe(404);
  });

  it('regenerates into a candidate, then keeps or discards it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/meetings/${meetingId}/summary:regenerate`,
      headers: auth(),
      payload: { template: 'standup' },
    });
    expect(res.statusCode).toBe(202);
    // The job key names the reason (ADR-0005 job keys): one pending regenerate per meeting.
    const jobs = await env.pool.query<{ key: string }>(
      "select key from graphile_worker.jobs where task_identifier = 'meeting.summarize'",
    );
    expect(jobs.rows.map((r) => r.key)).toContain(`meeting.summarize:${meetingId}:regenerate`);

    const workspaceId = people[0]?.workspaceId ?? '';
    await summarizeTask({ db: env.db, llm: llm('v2') }).handle(
      { workspaceId, meetingId, reason: 'regenerate', template: 'standup' },
      {} as JobHelpers,
    );
    expect((await summary()).body).toMatchObject({
      current: { version: 1 },
      candidate: { version: 2, template: 'standup', overview: 'Overview v2' },
    });
    const keep = await app.inject({
      method: 'POST',
      url: `/v1/meetings/${meetingId}/summary:keep`,
      headers: auth(),
      payload: { version: 2 },
    });
    expect(keep.statusCode).toBe(204);
    expect((await summary()).body).toMatchObject({ current: { version: 2 }, candidate: null });
    // The kept template becomes the meeting's (the Meetings filter follows it).
    const meeting = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}`,
      headers: auth(),
    });
    expect(meeting.json().template).toBe('standup');

    await summarizeTask({ db: env.db, llm: llm('v3') }).handle(
      { workspaceId, meetingId, reason: 'regenerate' },
      {} as JobHelpers,
    );
    const discard = await app.inject({
      method: 'POST',
      url: `/v1/meetings/${meetingId}/summary:discard`,
      headers: auth(),
      payload: { version: 3 },
    });
    expect(discard.statusCode).toBe(204);
    expect((await summary()).body).toMatchObject({ current: { version: 2 }, candidate: null });
  });

  it('edits items: done/open, text, and owners from the participant list only', async () => {
    const action = (await summary()).body?.current?.items.find((i) => i.kind === 'action_item');
    const patch = (payload: Record<string, unknown>, who = 0) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/summary-items/${action?.id}`,
        headers: auth(who),
        payload,
      });
    const done = await patch({ status: 'done' });
    expect(SummaryItem.parse(done.json())).toMatchObject({ status: 'done', userEdited: false });
    const edited = await patch({ text: 'Send the release notes to QA' });
    expect(SummaryItem.parse(edited.json())).toMatchObject({ userEdited: true });
    expect((await patch({ ownerParticipantId: 'prt_not_in_meeting' })).statusCode).toBe(400);
    expect((await patch({ ownerParticipantId: null })).statusCode).toBe(200);
    expect((await patch({ status: 'open' }, 1)).statusCode).toBe(404);
  });

  it('lists action items across meetings, by status', async () => {
    const list = async (query: string) =>
      ActionItemList.parse(
        (
          await app.inject({ method: 'GET', url: `/v1/action-items?${query}`, headers: auth() })
        ).json(),
      );
    const done = await list('status=done');
    expect(done.items).toHaveLength(1);
    expect(done.items[0]).toMatchObject({ meetingId, meetingTitle: 'Release sync' });
    expect((await list('status=open')).items).toHaveLength(0);
    expect((await list('status=all')).items).toHaveLength(1);
  });

  it('records feedback on notes the user owns only', async () => {
    const current = (await summary()).body?.current;
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: auth(),
      payload: { targetType: 'summary', targetId: current?.id, rating: 1 },
    });
    expect(ok.statusCode).toBe(201);
    const stranger = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: auth(1),
      payload: { targetType: 'summary', targetId: current?.id, rating: -1 },
    });
    expect(stranger.statusCode).toBe(404);
  });

  it('streams progress and ends once the meeting is settled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}/events`,
      headers: auth(),
    });
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.body).toBe('event: progress\ndata: {"status":"ready","processingStep":"done"}\n\n');
  });
  it('keeps action fields on action items, and rewrites only finished meetings', async () => {
    const decision = (await summary()).body?.current?.items.find((i) => i.kind === 'decision');
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/summary-items/${decision?.id}`,
      headers: auth(),
      payload: { dueDate: '2026-11-20' },
    });
    expect(res.statusCode).toBe(400);
    await env.db.inWorkspace(people[0]?.workspaceId ?? '', (tx) =>
      tx
        .updateTable('meetings')
        .set({ status: 'processing' })
        .where('id', '=', meetingId)
        .execute(),
    );
    const early = await app.inject({
      method: 'POST',
      url: `/v1/meetings/${meetingId}/summary:regenerate`,
      headers: auth(),
      payload: {},
    });
    expect(early.statusCode).toBe(409);
    await env.db.inWorkspace(people[0]?.workspaceId ?? '', (tx) =>
      tx.updateTable('meetings').set({ status: 'ready' }).where('id', '=', meetingId).execute(),
    );
  });

  it('pages action items without skipping items stored in the same millisecond', async () => {
    const workspaceId = people[0]?.workspaceId ?? '';
    await env.db.inWorkspace(workspaceId, async (tx) => {
      const current = await tx
        .selectFrom('summaries')
        .select('id')
        .where('meetingId', '=', meetingId)
        .where('accepted', '=', true)
        .executeTakeFirstOrThrow();
      for (const [i, micros] of ['123001', '123400', '123999'].entries()) {
        await tx
          .insertInto('summaryItems')
          .values({
            id: `sit_${newUlid()}`,
            workspaceId,
            meetingId,
            summaryId: current.id,
            kind: 'action_item',
            text: `Task ${i}`,
            status: 'open',
            order: 10 + i,
            createdAt: `2026-11-08T10:00:00.${micros}Z`,
          })
          .execute();
      }
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `status=all&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = ActionItemList.parse(
        (
          await app.inject({ method: 'GET', url: `/v1/action-items?${query}`, headers: auth() })
        ).json(),
      );
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor !== null && seen.length < 10);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });
});
