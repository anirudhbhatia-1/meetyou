import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { Folder, FolderListResponse, Meeting, MeetingList, newUlid } from '@meetyou/contracts';
import { createTestDb } from '@meetyou/db/testing';

import { buildApp } from './app.ts';

/** DESIGN §11.1–11.2: folders, moving meetings, and the folder suggestion. */
describe('folders', () => {
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

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    who = 0,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${people[who]?.token}` },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  const folders = async (who = 0) =>
    FolderListResponse.parse((await call('GET', '/v1/folders', undefined, who)).json()).folders;
  const meeting = async (title: string, who = 0): Promise<string> => {
    const id = `mtg_${newUlid()}`;
    const workspaceId = people[who]?.workspaceId ?? '';
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .insertInto('meetings')
        .values({
          id,
          workspaceId,
          sessionId: `ses_${newUlid()}`,
          platform: 'google_meet',
          title,
          startedAt: new Date(),
          status: 'ready',
        })
        .execute(),
    );
    return id;
  };

  it('creates folders A→Z, refuses duplicate names ignoring case and bad names', async () => {
    const res = await call('POST', '/v1/folders', { name: 'Sales' });
    expect(res.statusCode).toBe(201);
    expect(Folder.parse(res.json())).toMatchObject({ name: 'Sales', meetingCount: 0 });
    expect((await call('POST', '/v1/folders', { name: 'Hiring' })).statusCode).toBe(201);
    const dup = await call('POST', '/v1/folders', { name: ' sales ' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: { code: 'folder_exists' } });
    expect((await call('POST', '/v1/folders', { name: '' })).statusCode).toBe(400);
    expect((await call('POST', '/v1/folders', { name: 'x'.repeat(61) })).statusCode).toBe(400);
    expect((await folders()).map((f) => f.name)).toEqual(['Hiring', 'Sales']);
    // Another workspace sees none of them.
    expect(await folders(1)).toEqual([]);
  });

  it('moves a meeting, filters the list by folder, and counts meetings', async () => {
    const sales = (await folders()).find((f) => f.name === 'Sales');
    const id = await meeting('Acme renewal');
    const unfiled = await meeting('Standup');
    const moved = await call('PATCH', `/v1/meetings/${id}`, { folderId: sales?.id });
    expect(moved.statusCode).toBe(200);
    expect(Meeting.parse(moved.json())).toMatchObject({
      folderId: sales?.id,
      suggestedFolderId: null,
    });
    const inSales = MeetingList.parse(
      (await call('GET', `/v1/meetings?folder=${sales?.id}`)).json(),
    );
    expect(inSales.items.map((m) => m.id)).toEqual([id]);
    const none = MeetingList.parse((await call('GET', '/v1/meetings?folder=none')).json());
    expect(none.items.map((m) => m.id)).toEqual([unfiled]);
    expect((await folders()).find((f) => f.name === 'Sales')?.meetingCount).toBe(1);
    // A folder of another workspace, or none at all, is refused.
    expect(
      (await call('PATCH', `/v1/meetings/${unfiled}`, { folderId: 'fld_nope' })).statusCode,
    ).toBe(400);
  });

  it('renames, and deleting a folder unfiles its meetings', async () => {
    const sales = (await folders()).find((f) => f.name === 'Sales');
    expect((await call('PATCH', `/v1/folders/${sales?.id}`, { name: 'Hiring' })).statusCode).toBe(
      409,
    );
    const renamed = await call('PATCH', `/v1/folders/${sales?.id}`, { name: 'Clients' });
    expect(Folder.parse(renamed.json())).toMatchObject({ name: 'Clients', meetingCount: 1 });
    expect((await call('DELETE', `/v1/folders/${sales?.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/v1/folders/${sales?.id}`)).statusCode).toBe(404);
    const list = MeetingList.parse((await call('GET', '/v1/meetings')).json());
    expect(list.items.every((m) => m.folderId === null)).toBe(true);
  });

  it('shows a suggestion only while unfiled, and a dismissed one never again', async () => {
    const hiring = (await folders()).find((f) => f.name === 'Hiring');
    const id = await meeting('Interview: backend');
    const workspaceId = people[0]?.workspaceId ?? '';
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .updateTable('meetings')
        .set({ suggestedFolderId: hiring?.id ?? null, folderSuggestion: 'suggested' })
        .where('id', '=', id)
        .execute(),
    );
    const read = async () => Meeting.parse((await call('GET', `/v1/meetings/${id}`)).json());
    expect((await read()).suggestedFolderId).toBe(hiring?.id);
    expect((await call('POST', `/v1/meetings/${id}/folder-suggestion:dismiss`)).statusCode).toBe(
      204,
    );
    expect((await read()).suggestedFolderId).toBeNull();
    expect(
      (await call('POST', `/v1/meetings/${id}/folder-suggestion:dismiss`, undefined, 1)).statusCode,
    ).toBe(404);
  });
});
