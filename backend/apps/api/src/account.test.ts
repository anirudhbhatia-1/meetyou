import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { newUlid } from '@meetyou/contracts';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.ts';

describe('POST /v1/account:delete (FR-SET-03)', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = '';
  let userId = '';

  beforeAll(async () => {
    env = await createQueueTestEnv();
    const tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k')]));
    const signedIn = await env.db.signInGoogleUser(
      { googleSub: `g-${newUlid()}`, email: 'a@example.com', displayName: 'A' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    userId = signedIn.userId;
    token = (
      await tokens.issueAccessToken({
        userId,
        workspaceId: signedIn.workspaceId ?? '',
        scope: 'user',
      })
    ).token;
    app = await buildApp({
      tokens,
      db: env.db,
      config: { env: 'test', gatewayWsUrl: 'wss://gw.test/v1/stream' },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  it('needs a signed-in user', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/account:delete' });
    expect(res.statusCode).toBe(401);
  });

  it('records the request and enqueues the deletion in one step, ending the web session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account:delete',
      headers: { authorization: `Bearer ${token}`, 'x-minutes-client': 'web' },
    });
    expect(res.statusCode).toBe(202);
    const { requestId } = JSON.parse(res.body) as { requestId: string };
    expect(requestId).toMatch(/^del_/);
    expect(String(res.headers['set-cookie'])).toContain('minutes_rt=; Path=/v1/auth; Max-Age=0');
    // The public jobs view has no payload; the job key names the user.
    const jobs = await env.pool.query<{ task_identifier: string; key: string }>(
      'select task_identifier, key from graphile_worker.jobs',
    );
    expect(jobs.rows).toEqual([
      { task_identifier: 'account.delete', key: `account.delete:${userId}:1` },
    ]);
  });
});
