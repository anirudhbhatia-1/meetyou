import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { newUlid, SEARCH_MARK_END, SEARCH_MARK_START, SearchResponse } from '@meetyou/contracts';
import { createMeetingForSession, storeSegments } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';

import { buildApp } from './app.ts';
import { toTsQuery } from './routes/search.ts';

/** S3-09: full-text search over the caller's own meetings only. */
describe('search', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const people: { workspaceId: string; token: string }[] = [];
  let releaseMeeting = '';

  async function meeting(workspaceId: string, title: string, lines: string[]): Promise<string> {
    const meetingId = `mtg_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        title,
        startedAt: new Date('2026-11-07T04:30:00Z'),
      });
      await storeSegments(
        tx,
        lines.map((text, i) => ({
          id: `seg_${newUlid()}`,
          workspaceId,
          meetingId,
          lane: 'them' as const,
          startMs: i * 5_000,
          endMs: i * 5_000 + 3_000,
          text,
          rawText: text,
          language: 'hi',
          source: 'live' as const,
          flags: [],
        })),
        () => `spc_${newUlid()}`,
      );
    });
    return meetingId;
  }

  beforeAll(async () => {
    env = await createTestDb();
    const tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    for (const sub of ['owner', 'other']) {
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
    const [owner, other] = people;
    releaseMeeting = await meeting(owner?.workspaceId ?? '', 'Weekly sync', [
      'Okay, decision: release Friday tak move karte hain.',
      'Payments flow mein abhi bhi do bugs hain, nahi chalega.',
    ]);
    await meeting(owner?.workspaceId ?? '', 'Pricing review', ['Price is 40,000 per month.']);
    await meeting(other?.workspaceId ?? '', 'Secret release plan', ['Our release is in March.']);
    app = await buildApp({ tokens, db: env.db, config: { env: 'test' } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const search = async (q: string, who = 0) => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${encodeURIComponent(q)}`,
      headers: { authorization: `Bearer ${people[who]?.token}` },
    });
    return {
      status: res.statusCode,
      body: res.statusCode === 200 ? SearchResponse.parse(res.json()) : null,
    };
  };

  it("finds transcript lines in the caller's meetings only, with highlighted snippets", async () => {
    const { body } = await search('release');
    expect(body?.results.map((r) => r.meeting.id)).toEqual([releaseMeeting]);
    const hit = body?.results[0]?.hits[0];
    expect(hit).toMatchObject({ kind: 'segment', startMs: 0 });
    expect(hit?.snippet).toContain(`${SEARCH_MARK_START}release${SEARCH_MARK_END}`);
  });

  it('matches word prefixes and needs every word', async () => {
    expect((await search('relea')).body?.results).toHaveLength(1);
    expect((await search('release march')).body?.results).toHaveLength(0);
    expect((await search('payments bugs')).body?.results).toHaveLength(1);
  });

  it('normalises Hinglish spelling variants in the query', async () => {
    expect(toTsQuery('Nahin chalega')).toBe('nahi:* & chalega:*');
    expect((await search('nahin')).body?.results.map((r) => r.meeting.id)).toEqual([
      releaseMeeting,
    ]);
  });

  it('finds titles, and numbers as words', async () => {
    expect((await search('pricing')).body?.results[0]?.hits[0]?.kind).toBe('title');
    expect((await search('40')).body?.results).toHaveLength(1);
  });

  it('strips query syntax instead of failing', async () => {
    expect(toTsQuery("release & | ! ( ) ' :*")).toBe('release:*');
    expect((await search('& | !')).body?.results).toEqual([]);
    expect((await search('')).status).toBe(400);
  });

  it("never returns another user's meetings", async () => {
    expect((await search('march', 1)).body?.results).toHaveLength(1);
    expect((await search('march', 0)).body?.results).toHaveLength(0);
  });
});
