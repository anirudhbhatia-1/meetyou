import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { newUlid } from '@meetyou/contracts';
import { createTestDb } from '@meetyou/db/testing';

import { buildApp } from './app.ts';

/** S4-15: typed product events are stored per workspace; an opted-out user stores nothing. */
describe('POST /v1/events', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const people: { workspaceId: string; userId: string; token: string }[] = [];

  beforeAll(async () => {
    env = await createTestDb();
    const tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    for (const sub of ['a', 'b']) {
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
      people.push({ workspaceId, userId: account.userId, token });
    }
    app = await buildApp({ tokens, db: env.db, config: { env: 'test' } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const post = (payload: unknown, who = 0) =>
    app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { authorization: `Bearer ${people[who]?.token}` },
      payload: payload as Record<string, unknown>,
    });
  /** Rows as the given person's workspace sees them (RLS). */
  const stored = (who = 0) =>
    env.db.inWorkspace(people[who]?.workspaceId ?? '', (tx) =>
      tx
        .selectFrom('productEvents')
        .select(['name', 'props', 'userId'])
        .orderBy('createdAt')
        .execute(),
    );
  const at = new Date().toISOString();

  it('stores typed events for the signed-in user', async () => {
    const res = await post({
      client: 'web',
      events: [
        { name: 'summary_opened', at, props: { meetingId: 'mtg_01ABC' } },
        { name: 'library_searched', at, props: { results: 3 } },
      ],
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 2 });
    expect(await stored()).toEqual([
      { name: 'summary_opened', props: { meetingId: 'mtg_01ABC' }, userId: people[0]?.userId },
      { name: 'library_searched', props: { results: 3 }, userId: people[0]?.userId },
    ]);
    // Another workspace sees none of them.
    expect(await stored(1)).toEqual([]);
  });

  it('rejects content and unknown events without storing any of the batch', async () => {
    const before = (await stored()).length;
    const res = await post({
      client: 'web',
      events: [
        { name: 'export_started', at, props: {} },
        { name: 'summary_opened', at, props: { meetingId: 'mtg_1', title: 'Weekly sync' } },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect((await stored()).length).toBe(before);
  });

  it('stores nothing for a user who opted out', async () => {
    const opt = await app.inject({
      method: 'PATCH',
      url: '/v1/settings',
      headers: { authorization: `Bearer ${people[1]?.token}` },
      payload: { analyticsOptOut: true },
    });
    expect(opt.statusCode).toBe(200);
    const res = await post(
      { client: 'extension', events: [{ name: 'export_started', at, props: {} }] },
      1,
    );
    expect(res.statusCode).toBe(204);
    expect(await stored(1)).toEqual([]);
  });

  it('needs a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { client: 'web', events: [{ name: 'export_started', at, props: {} }] },
    });
    expect(res.statusCode).toBe(401);
  });
});
