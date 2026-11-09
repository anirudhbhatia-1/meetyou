import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { ExportListResponse, ExportResponse, newUlid } from '@meetyou/contracts';
import { exportTask } from '@meetyou/pipeline';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { MemoryBucket } from '@meetyou/storage';
import type { JobHelpers } from 'graphile-worker';

import { buildApp } from './app.ts';

/** S3-11: one export at a time per user, job in the same transaction, signed link once ready. */
describe('exports', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const people: { workspaceId: string; userId: string; token: string }[] = [];
  const bucket = new MemoryBucket();
  const signed: string[] = [];

  beforeAll(async () => {
    env = await createQueueTestEnv();
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
    app = await buildApp({
      tokens,
      db: env.db,
      config: { env: 'test' },
      signExportDownload: async (key, fileName) => {
        signed.push(fileName);
        return `https://storage.example.test/${key}?signed=1`;
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const call = (method: 'GET' | 'POST', url: string, who = 0) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${people[who]?.token}` } });

  it('starts one export, reports progress, then gives a signed link', async () => {
    const first = await call('POST', '/v1/exports');
    expect(first.statusCode).toBe(202);
    const started = ExportResponse.parse(first.json()).export;
    expect(started).toMatchObject({ status: 'preparing', downloadUrl: null });

    // A second click while it is preparing returns the same export, and only one job exists.
    const again = ExportResponse.parse((await call('POST', '/v1/exports')).json()).export;
    expect(again.id).toBe(started.id);
    const jobs = await env.pool.query<{ key: string }>(
      `select key from graphile_worker.jobs where task_identifier = 'account.export'`,
    );
    expect(jobs.rows).toEqual([{ key: `account.export:${started.id}` }]);

    const me = people[0];
    await exportTask({ db: env.db, bucket }).handle(
      { workspaceId: me?.workspaceId ?? '', userId: me?.userId ?? '', exportId: started.id },
      { job: { attempts: 1, max_attempts: 3 } } as JobHelpers,
    );
    const ready = ExportResponse.parse(
      (await call('GET', `/v1/exports/${started.id}`)).json(),
    ).export;
    expect(ready).toMatchObject({ status: 'ready', meetingCount: 0 });
    expect(ready.downloadUrl).toContain(`/exports/${started.id}.zip?signed=1`);
    expect(signed.at(-1)).toMatch(/^minutes-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const list = ExportListResponse.parse((await call('GET', '/v1/exports')).json());
    expect(list.latest?.id).toBe(started.id);
    // Right after a finished export, asking again returns it.
    expect(ExportResponse.parse((await call('POST', '/v1/exports')).json()).export.id).toBe(
      started.id,
    );
  });

  it("never shows another user's export", async () => {
    const mine = ExportListResponse.parse((await call('GET', '/v1/exports')).json()).latest;
    expect((await call('GET', `/v1/exports/${mine?.id}`, 1)).statusCode).toBe(404);
    expect(ExportListResponse.parse((await call('GET', '/v1/exports', 1)).json()).latest).toBe(
      null,
    );
  });
});
