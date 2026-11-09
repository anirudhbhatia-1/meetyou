import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { GlossaryResponse, newUlid } from '@meetyou/contracts';
import { glossaryTerms } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';

import { buildApp } from './app.ts';

/** S3-10: the glossary is validated against the provider's limits and reaches the STT config. */
describe('glossary', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const people: { workspaceId: string; token: string }[] = [];

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
      people.push({ workspaceId, token });
    }
    app = await buildApp({ tokens, db: env.db, config: { env: 'test' } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const put = (terms: unknown, who = 0) =>
    app.inject({
      method: 'PUT',
      url: '/v1/glossary',
      headers: { authorization: `Bearer ${people[who]?.token}` },
      payload: { terms } as Record<string, unknown>,
    });
  const get = async (who = 0) =>
    GlossaryResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/glossary',
          headers: { authorization: `Bearer ${people[who]?.token}` },
        })
      ).json(),
    );

  it('replaces the list, keeps order, drops repeats, and feeds the STT session config', async () => {
    expect((await put(['Razorpay', 'Sameer', 'INR', 'razorpay'])).statusCode).toBe(200);
    expect(await get()).toEqual({ terms: ['Razorpay', 'Sameer', 'INR'], maxTerms: 50 });
    // What the gateway sends to Deepgram as keyterms (S2-04).
    const terms = await env.db.inWorkspace(people[0]?.workspaceId ?? '', (tx) => glossaryTerms(tx));
    expect(terms.sort()).toEqual(['INR', 'Razorpay', 'Sameer']);
    expect((await put(['Minutes'])).statusCode).toBe(200);
    expect((await get()).terms).toEqual(['Minutes']);
  });

  it('refuses commas, too many words, and lists over the provider budget', async () => {
    expect((await put(['a, b'])).statusCode).toBe(400);
    expect((await put(Array.from({ length: 51 }, (_, i) => `term${i}`))).statusCode).toBe(400);
    const long = Array.from({ length: 50 }, (_, i) => `${'x'.repeat(60)}${i}`);
    const res = await put(long);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'glossary_too_long' } });
    expect((await get()).terms).toEqual(['Minutes']);
  });

  it("keeps each user's words to themselves", async () => {
    expect((await get(1)).terms).toEqual([]);
  });
});
