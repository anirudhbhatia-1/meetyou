import { randomBytes } from 'node:crypto';

import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { fakeGoogleIdTokens } from '@meetyou/auth/testing';
import {
  CALENDAR_SCOPE,
  CalendarStatus,
  newUlid,
  StartSessionResponse,
  UpcomingResponse,
} from '@meetyou/contracts';
import { sql } from 'kysely';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.ts';

const CLIENT_ID = 'cid.apps.googleusercontent.com';
const REDIRECT = 'http://localhost:5173/calendar/callback';

/** ADR-0013, DESIGN §10.1, §15.7 on PGlite with RLS and the job queue. */
describe('calendar', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = '';
  let workspaceId = '';
  let fakeGoogle: Awaited<ReturnType<typeof fakeGoogleIdTokens>>;
  const revoked: string[] = [];
  let grantScope = `openid email ${CALENDAR_SCOPE}`;

  const idToken = () => fakeGoogle.sign({ sub: 'g-sub', email: 'asha@work.example' });

  const google = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    if (String(url) === 'https://oauth2.googleapis.com/revoke') {
      revoked.push(body.get('token') ?? '');
      return new Response('{}');
    }
    return new Response(
      JSON.stringify({ id_token: await idToken(), refresh_token: '1//fresh', scope: grantScope }),
    );
  }) as typeof fetch;

  beforeAll(async () => {
    fakeGoogle = await fakeGoogleIdTokens(CLIENT_ID);
    env = await createQueueTestEnv();
    const tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k')]));
    const signedIn = await env.db.signInGoogleUser(
      { googleSub: `g-${newUlid()}`, email: 'asha@work.example', displayName: 'Asha' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    workspaceId = signedIn.workspaceId ?? '';
    token = (await tokens.issueAccessToken({ userId: signedIn.userId, workspaceId, scope: 'user' }))
      .token;
    app = await buildApp({
      tokens,
      db: env.db,
      config: {
        env: 'test',
        gatewayWsUrl: 'wss://gw.test/v1/stream',
        googleClientId: CLIENT_ID,
        googleClientSecret: 'secret',
        calendarTokenKeys: `k1:${randomBytes(32).toString('base64')}`,
        allowedRedirectUris: [REDIRECT],
      },
      calendarGoogleDeps: { fetch: google, keys: fakeGoogle.keys },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  const connect = () =>
    call('POST', '/v1/calendar/connect', {
      code: 'auth-code',
      codeVerifier: 'v'.repeat(43),
      redirectUri: REDIRECT,
    });

  it('starts unconnected, refuses a consent without the calendar box ticked', async () => {
    expect(CalendarStatus.parse((await call('GET', '/v1/calendar')).json()).connected).toBe(false);
    grantScope = 'openid email';
    const res = await connect();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'calendar_scope_denied' } });
    grantScope = `openid email ${CALENDAR_SCOPE}`;
  });

  it('connects, seals the token, and queues the first sync', async () => {
    const res = await connect();
    expect(res.statusCode).toBe(200);
    expect(CalendarStatus.parse(res.json())).toMatchObject({
      connected: true,
      accountEmail: 'asha@work.example',
      status: 'active',
    });
    const stored = await env.db.inWorkspace(workspaceId, (tx) =>
      tx.selectFrom('calendarConnections').select('refreshTokenSealed').executeTakeFirstOrThrow(),
    );
    expect(stored.refreshTokenSealed).not.toContain('fresh');
    const { rows } = await env.pool.query(
      `select key from graphile_worker.jobs where task_identifier = 'calendar.sync'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('lists upcoming Meet calls from the last poll, with names and notes before the call', async () => {
    const now = Date.now();
    const ids = await env.db.inWorkspace(workspaceId, async (tx) => {
      const c = await tx.selectFrom('calendarConnections').select('id').executeTakeFirstOrThrow();
      const synced = new Date(now - 60_000);
      await tx.updateTable('calendarConnections').set({ lastSyncedAt: synced }).execute();
      const row = (
        id: string,
        title: string,
        minutes: number,
        meetCode: string | null,
        at = synced,
      ) => ({
        id,
        workspaceId,
        connectionId: c.id,
        externalId: id,
        title,
        startsAt: new Date(now + minutes * 60_000),
        endsAt: new Date(now + (minutes + 30) * 60_000),
        meetCode,
        attendees: JSON.stringify([
          { name: null, email: 'asha@work.example', self: true, organizer: true },
          { name: null, email: 'neha.kapoor@acme.com', self: false, organizer: false },
        ]),
        syncedAt: at,
      });
      await tx
        .insertInto('calendarEvents')
        .values([
          row('cev_a', 'Acme weekly', 5, 'abc-defg-hij'),
          row('cev_b', 'Lunch', 60, null),
          row('cev_c', 'Moved away', 90, 'xyz-abcd-efg', new Date(now - 3_600_000)),
        ])
        .execute();
      return { event: 'cev_a' };
    });
    const put = await call('PUT', `/v1/calendar/events/${ids.event}/notes`, {
      notes: ['Pricing for Q1', 'Who owns onboarding?'],
    });
    expect(put.statusCode).toBe(200);
    const upcoming = UpcomingResponse.parse((await call('GET', '/v1/calendar/upcoming')).json());
    expect(upcoming.meetings).toEqual([
      expect.objectContaining({
        id: 'cev_a',
        title: 'Acme weekly',
        meetCode: 'abc-defg-hij',
        attendeeNames: ['Neha Kapoor'],
        noteCount: 2,
        meetingId: null,
      }),
    ]);
  });

  it('links the recording: event title, notes before the call, and the meeting on Up next', async () => {
    const res = await call('POST', '/v1/sessions', {
      platform: 'google_meet',
      meetingCode: 'abc-defg-hij',
      title: 'Meet',
      recordVideo: false,
      clientInfo: { extensionVersion: '0.1.0', browser: 'Chrome' },
    });
    expect(res.statusCode).toBe(201);
    const started = StartSessionResponse.parse(res.json());
    expect(started.notes?.map((n) => [n.text, n.sessionMs])).toEqual([
      ['Pricing for Q1', 0],
      ['Who owns onboarding?', 0],
    ]);
    const meeting = await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .selectFrom('meetings')
        .select(['title', 'calendarEventId'])
        .where('id', '=', started.meetingId)
        .executeTakeFirstOrThrow(),
    );
    expect(meeting).toEqual({ title: 'Acme weekly', calendarEventId: 'cev_a' });
    const upcoming = UpcomingResponse.parse((await call('GET', '/v1/calendar/upcoming')).json());
    expect(upcoming.meetings[0]?.meetingId).toBe(started.meetingId);
  });

  it('disconnects: revokes at Google and deletes events and their notes', async () => {
    expect((await call('DELETE', '/v1/calendar')).statusCode).toBe(204);
    expect(revoked).toEqual(['1//fresh']);
    const left = await env.db.inWorkspace(workspaceId, async (tx) => ({
      events: (await sql<{ n: number }>`select count(*)::int as n from calendar_events`.execute(tx))
        .rows[0]?.n,
      notes: (
        await sql<{ n: number }>`select count(*)::int as n from calendar_event_notes`.execute(tx)
      ).rows[0]?.n,
    }));
    expect(left).toEqual({ events: 0, notes: 0 });
    expect(CalendarStatus.parse((await call('GET', '/v1/calendar')).json()).connected).toBe(false);
  });
});
