import { randomBytes } from 'node:crypto';

import { parseSealingKeys, seal } from '@meetyou/auth';
import { newUlid } from '@meetyou/contracts';
import { createTestDb } from '@meetyou/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nextSyncAt, syncCalendar, type CalendarDeps } from './calendar.ts';

/** ADR-0013 on PGlite with RLS: the poll, the stale marker and the reconnect state. */
describe('calendar.sync', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let workspaceId = '';
  let userId = '';
  const keys = parseSealingKeys(`k1:${randomBytes(32).toString('base64')}`);
  const now = new Date('2026-11-18T03:00:00Z');

  beforeAll(async () => {
    env = await createTestDb();
    const account = await env.db.signInGoogleUser(
      { googleSub: 'cal', email: 'cal@example.com', displayName: 'Cal' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    workspaceId = account.workspaceId ?? '';
    userId = account.userId;
  }, 60_000);

  afterAll(async () => {
    await env.close();
  });

  async function connection(): Promise<string> {
    const id = `cal_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await tx.deleteFrom('calendarConnections').execute();
      await tx
        .insertInto('calendarConnections')
        .values({
          id,
          workspaceId,
          userId,
          accountEmail: 'cal@example.com',
          refreshTokenSealed: seal('1//refresh', keys, id),
          scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
        })
        .execute();
    });
    return id;
  }

  const gEvent = (id: string, summary: string, startHour: number) => ({
    id,
    summary,
    start: { dateTime: `2026-11-18T${String(startHour).padStart(2, '0')}:00:00Z` },
    end: { dateTime: `2026-11-18T${String(startHour).padStart(2, '0')}:30:00Z` },
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    attendees: [{ email: 'neha@acme.com', displayName: 'Neha Kapoor' }],
  });

  function google(pages: unknown[][], token: { status: number; body: unknown }) {
    const calls: string[] = [];
    let run = 0;
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('1//refresh');
        return new Response(JSON.stringify(token.body), { status: token.status });
      }
      const items = pages[run] ?? [];
      run += 1;
      return new Response(JSON.stringify({ items }));
    }) as typeof fetch;
    return { fake, calls };
  }

  const deps = (fetch: typeof globalThis.fetch, at = now): CalendarDeps => ({
    db: env.db,
    google: { clientId: 'cid', clientSecret: 'secret' },
    sealingKeys: keys,
    fetch,
    now: () => at,
  });

  const events = () =>
    env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('calendarEvents')
        .select(['externalId', 'title', 'meetCode', 'attendees', 'syncedAt'])
        .orderBy('startsAt')
        .execute(),
    );

  it('stores the window, marks what the last poll saw, and keeps a moved event', async () => {
    const id = await connection();
    const first = google([[gEvent('e1', 'Acme weekly', 4), gEvent('e2', 'Standup', 5)]], {
      status: 200,
      body: { access_token: 'ya29' },
    });
    expect(await syncCalendar(deps(first.fake), workspaceId, id)).toBe('synced');
    const stored = await events();
    expect(stored.map((e) => [e.externalId, e.title, e.meetCode])).toEqual([
      ['e1', 'Acme weekly', 'abc-defg-hij'],
      ['e2', 'Standup', 'abc-defg-hij'],
    ]);
    expect(stored[0]?.attendees).toEqual([
      { name: 'Neha Kapoor', email: 'neha@acme.com', self: false, organizer: false },
    ]);

    // e2 moved out of the window: still stored (its notes too), but not seen by the last poll.
    const later = new Date(now.getTime() + 15 * 60_000);
    const second = google([[gEvent('e1', 'Acme weekly (renamed)', 4)]], {
      status: 200,
      body: { access_token: 'ya29' },
    });
    await syncCalendar(deps(second.fake, later), workspaceId, id);
    const after = await events();
    expect(after.find((e) => e.externalId === 'e1')?.title).toBe('Acme weekly (renamed)');
    expect(after.find((e) => e.externalId === 'e2')?.syncedAt.getTime()).toBe(now.getTime());
    expect(after.find((e) => e.externalId === 'e1')?.syncedAt.getTime()).toBe(later.getTime());
  });

  it('asks for reconnection when Google refuses the grant, and stops calling Google', async () => {
    const id = await connection();
    const refused = google([], { status: 400, body: { error: 'invalid_grant' } });
    expect(await syncCalendar(deps(refused.fake), workspaceId, id)).toBe('needs_reconnect');
    const row = await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('calendarConnections')
        .select(['status', 'lastErrorCode'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ status: 'needs_reconnect', lastErrorCode: 'revoked' });
    const again = google([], { status: 200, body: { access_token: 'x' } });
    expect(await syncCalendar(deps(again.fake), workspaceId, id)).toBe('needs_reconnect');
    expect(again.calls).toEqual([]);
  });

  it('asks for reconnection when the sealing key is gone', async () => {
    const id = await connection();
    const otherKeys = parseSealingKeys(`k9:${randomBytes(32).toString('base64')}`);
    const fake = google([], { status: 200, body: { access_token: 'x' } });
    expect(
      await syncCalendar({ ...deps(fake.fake), sealingKeys: otherKeys }, workspaceId, id),
    ).toBe('needs_reconnect');
    expect(fake.calls).toEqual([]);
    const row = await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('calendarConnections')
        .select(['status', 'lastErrorCode'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ status: 'needs_reconnect', lastErrorCode: 'key_missing' });
  });

  it('does nothing without configuration or for a removed connection', async () => {
    const off = { ...deps(google([], { status: 200, body: {} }).fake), google: null };
    expect(await syncCalendar(off, workspaceId, 'cal_x')).toBe('off');
    expect(
      await syncCalendar(deps(google([], { status: 200, body: {} }).fake), workspaceId, 'cal_gone'),
    ).toBe('gone');
  });

  it('spreads runs over 15 minutes ± 25 %', () => {
    expect(nextSyncAt(now, 0).getTime() - now.getTime()).toBe(15 * 60_000);
    expect(nextSyncAt(now, 1).getTime() - now.getTime()).toBe(18.75 * 60_000);
    expect(nextSyncAt(now, -5).getTime() - now.getTime()).toBe(11.25 * 60_000);
  });
});
