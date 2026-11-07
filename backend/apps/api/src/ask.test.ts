import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import {
  AskQuestionResponse,
  MeetingQuestionsResponse,
  newUlid,
  type AnswerOutput,
  type Segment,
} from '@meetyou/contracts';
import { createMeetingForSession, storeSegments } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import type { LlmProvider, StructuredRequest } from '@meetyou/providers';

import { buildApp } from './app.ts';

/**
 * "Ask this meeting" guardrails (AGENTS §9, 2026-11-07): one recording, its owner only, grounded
 * answers with citations, fixed refusals, limits.
 */
describe('Ask this meeting', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let tokens: TokenService;
  const answers: AnswerOutput[] = [];
  const seen: StructuredRequest[] = [];
  const llm: LlmProvider = {
    name: 'fake',
    model: 'fake-model',
    generateStructured(request) {
      seen.push(request);
      const next = answers.shift();
      if (next === undefined) return Promise.reject(new Error('no answer queued'));
      return Promise.resolve({
        json: next,
        usage: { inputTokens: 900, outputTokens: 30, thinkingTokens: 120 },
        model: 'fake-model-001',
      });
    },
  };

  const accounts: { userId: string; workspaceId: string; token: string }[] = [];
  let meetingA = '';
  let otherMeetingA = '';
  let segA: Segment;

  async function signIn(sub: string) {
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
    return { userId: account.userId, workspaceId, token };
  }

  async function seedMeeting(workspaceId: string, text: string): Promise<[string, Segment]> {
    const meetingId = `mtg_${newUlid()}`;
    const segment: Segment = {
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane: 'them',
      startMs: 12_000,
      endMs: 15_000,
      text,
      rawText: text,
      language: 'en',
      source: 'live',
      flags: [],
    };
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        startedAt: new Date('2026-11-07T10:00:00Z'),
      });
      await storeSegments(tx, [segment], () => `spc_${newUlid()}`);
    });
    return [meetingId, segment];
  }

  let app: Awaited<ReturnType<typeof buildApp>>;
  let noLlmApp: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    env = await createTestDb();
    tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    accounts.push(await signIn('alpha'), await signIn('beta'));
    const a = accounts[0];
    if (a === undefined) throw new Error('setup');
    [meetingA, segA] = await seedMeeting(a.workspaceId, 'The price is 40,000 rupees per month.');
    [otherMeetingA] = await seedMeeting(a.workspaceId, 'Secret roadmap for another project.');
    app = await buildApp({ tokens, db: env.db, llm, config: { env: 'test' } });
    noLlmApp = await buildApp({ tokens, db: env.db, llm: null, config: { env: 'test' } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await noLlmApp.close();
    await env.close();
  });

  const ask = (meetingId: string, question: string, who = 0, target = app) =>
    target.inject({
      method: 'POST',
      url: `/v1/meetings/${meetingId}/ask`,
      headers: { authorization: `Bearer ${accounts[who]?.token}` },
      payload: { question },
    });

  it('answers from this recording only, with citations mapped to times', async () => {
    answers.push({
      about_this_meeting: true,
      found: true,
      answer: '40,000 rupees per month.',
      segment_ids: [segA.id],
    });
    const res = await ask(meetingA, 'What is the price?');
    expect(res.statusCode).toBe(200);
    const body = AskQuestionResponse.parse(res.json());
    expect(body.question).toMatchObject({
      status: 'answered',
      answer: '40,000 rupees per month.',
      citations: [{ segmentId: segA.id, startMs: 12_000 }],
    });
    expect(body.usage).toMatchObject({ usedLastHour: 1, perHour: 30, perDay: 150 });
    // The model saw this meeting and nothing else of the same owner.
    const input = seen.at(-1)?.input ?? '';
    expect(input).toContain('The price is 40,000 rupees per month.');
    expect(input).not.toContain('Secret roadmap');
  });

  it('refuses off-topic questions with no model text', async () => {
    answers.push({
      about_this_meeting: false,
      found: false,
      answer: 'Sure, here is a poem…',
      segment_ids: [],
    });
    const body = AskQuestionResponse.parse((await ask(meetingA, 'Write me a poem')).json());
    expect(body.question).toMatchObject({ status: 'off_topic', answer: null, citations: [] });
  });

  it('downgrades an answer citing segments that are not in this meeting', async () => {
    answers.push({
      about_this_meeting: true,
      found: true,
      answer: 'Invented.',
      segment_ids: [`seg_${newUlid()}`],
    });
    const body = AskQuestionResponse.parse((await ask(meetingA, 'Who decided?')).json());
    expect(body.question).toMatchObject({ status: 'not_in_meeting', answer: null });
  });

  it("returns 404 for another user's recording, on ask and on the history", async () => {
    const before = seen.length;
    expect((await ask(meetingA, 'What is the price?', 1)).statusCode).toBe(404);
    const history = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingA}/questions`,
      headers: { authorization: `Bearer ${accounts[1]?.token}` },
    });
    expect(history.statusCode).toBe(404);
    expect(seen.length).toBe(before);
  });

  it('lists the history oldest first, per meeting', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingA}/questions`,
      headers: { authorization: `Bearer ${accounts[0]?.token}` },
    });
    const body = MeetingQuestionsResponse.parse(res.json());
    expect(body.items.map((q) => q.status)).toEqual(['answered', 'off_topic', 'not_in_meeting']);
    expect(body.usage.usedLastHour).toBe(3);
    const other = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${otherMeetingA}/questions`,
      headers: { authorization: `Bearer ${accounts[0]?.token}` },
    });
    expect(MeetingQuestionsResponse.parse(other.json()).items).toEqual([]);
  });

  it('rejects empty and over-long questions before calling the model', async () => {
    const before = seen.length;
    expect((await ask(meetingA, '   ')).statusCode).toBe(400);
    expect((await ask(meetingA, 'x'.repeat(501))).statusCode).toBe(400);
    expect(seen.length).toBe(before);
  });

  it('stops at the hourly limit with 429', async () => {
    const a = accounts[0];
    if (a === undefined) throw new Error('setup');
    await env.db.inWorkspace(a.workspaceId, async (tx) => {
      for (let i = 0; i < 27; i += 1) {
        await tx
          .insertInto('meetingQuestions')
          .values({
            id: `qst_${newUlid()}`,
            workspaceId: a.workspaceId,
            meetingId: otherMeetingA,
            userId: a.userId,
            question: 'q',
            status: 'off_topic',
            answer: null,
            model: 'fake',
          })
          .execute();
      }
    });
    const before = seen.length;
    const res = await ask(meetingA, 'One more?');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: 'rate_limited', retryable: true } });
    expect(seen.length).toBe(before);
  });

  it('answers 503 when no model is configured', async () => {
    expect((await ask(meetingA, 'Price?', 0, noLlmApp)).statusCode).toBe(503);
  });
});
