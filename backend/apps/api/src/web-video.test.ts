import { generateKeyPairSync } from 'node:crypto';

import { Storage } from '@google-cloud/storage';
import { generateSigningJwk, loadKeyRing, TokenService, type AuthService } from '@meetyou/auth';
import { newUlid, SignVideoFragmentsResponse, VideoPlaybackResponse } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting, upsertVideoAsset } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import { GcsBucket } from '@meetyou/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.ts';

const RT = (c: string) => c.repeat(43);
const pair = (refresh: string) => ({
  accessToken: 'access-token',
  accessExpiresAt: new Date('2030-01-01T00:00:00Z'),
  refreshToken: refresh,
  refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
});

/** Stands in for the Google exchange and the refresh rotation (tested in @meetyou/auth). */
function fakeAuth() {
  const calls: { refresh: string[]; logout: string[] } = { refresh: [], logout: [] };
  const service = {
    signInWithGoogle: () => Promise.resolve(pair(RT('a'))),
    refresh: (token: string) => {
      calls.refresh.push(token);
      return Promise.resolve(pair(RT('b')));
    },
    logout: (token: string) => {
      calls.logout.push(token);
      return Promise.resolve();
    },
  } as unknown as AuthService;
  return { service, calls };
}

const signIn = {
  code: 'google-code',
  codeVerifier: 'v'.repeat(43),
  redirectUri: 'https://web.example/auth/callback',
};

describe('web app sign-in with an HttpOnly refresh cookie (ADR-0004 §4.5)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let calls: ReturnType<typeof fakeAuth>['calls'];

  beforeAll(async () => {
    const fake = fakeAuth();
    calls = fake.calls;
    app = await buildApp({
      authService: fake.service,
      config: { env: 'test', gatewayWsUrl: 'wss://gw.test/v1/stream' },
    });
  });

  it('keeps the refresh token out of the body for the web client and sets a scoped cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: { 'x-minutes-client': 'web' },
      payload: signIn,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      accessToken: 'access-token',
      accessExpiresAt: '2030-01-01T00:00:00.000Z',
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^minutes_rt=${RT('a')}; Path=/v1/auth; Max-Age=\\d+`));
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax');
  });

  it('refreshes from the cookie, rotating it; refuses without one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'x-minutes-client': 'web', cookie: `other=1; minutes_rt=${RT('a')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(calls.refresh).toEqual([RT('a')]);
    expect(String(res.headers['set-cookie'])).toContain(`minutes_rt=${RT('b')}`);
    expect(JSON.parse(res.body).refreshToken).toBeUndefined();

    const none = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'x-minutes-client': 'web' },
    });
    expect(none.statusCode).toBe(401);
  });

  it('ignores the cookie without the web header (CSRF) and keeps the extension flow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: `minutes_rt=${RT('a')}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const extension = await app.inject({ method: 'POST', url: '/v1/auth/google', payload: signIn });
    expect(JSON.parse(extension.body).refreshToken).toBe(RT('a'));
    expect(extension.headers['set-cookie']).toBeUndefined();
  });

  it('logs out by revoking the cookie family and clearing the cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { 'x-minutes-client': 'web', cookie: `minutes_rt=${RT('b')}` },
    });
    expect(res.statusCode).toBe(204);
    expect(calls.logout).toEqual([RT('b')]);
    expect(String(res.headers['set-cookie'])).toContain('minutes_rt=; Path=/v1/auth; Max-Age=0');
  });
});

describe('video routes (S2-14)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let tokens: TokenService;
  const accounts: { workspaceId: string; token: string }[] = [];

  beforeAll(async () => {
    env = await createTestDb();
    tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k')]));
    for (const sub of ['a', 'b']) {
      const signedIn = await env.db.signInGoogleUser(
        { googleSub: `${sub}-${newUlid()}`, email: `${sub}@example.com`, displayName: sub },
        {
          userId: `usr_${newUlid()}`,
          workspaceId: `ws_${newUlid()}`,
          membershipId: `mem_${newUlid()}`,
          settingsId: `set_${newUlid()}`,
        },
      );
      const workspaceId = signedIn.workspaceId ?? '';
      const { token } = await tokens.issueAccessToken({
        userId: signedIn.userId,
        workspaceId,
        scope: 'user',
      });
      accounts.push({ workspaceId, token });
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const bucket = new GcsBucket(
      'test-bucket',
      new Storage({
        projectId: 'p',
        credentials: {
          client_email: 's@p.iam.gserviceaccount.com',
          private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        },
      }),
    );
    app = await buildApp({
      tokens,
      db: env.db,
      bucket,
      config: { env: 'test', gatewayWsUrl: 'wss://gw.test/v1/stream' },
    });
  }, 30_000);

  afterAll(async () => {
    await env.close();
  });

  async function meeting(workspaceId: string, endedAt: Date | null) {
    const sessionId = `ses_${newUlid()}`;
    const meetingId = `mtg_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId,
        externalMeetingCode: null,
        startedAt: new Date(Date.now() - 3_600_000),
      });
      if (endedAt !== null) await endMeeting(tx, meetingId, endedAt);
    });
    return { sessionId, meetingId };
  }

  const sign = (sessionId: string, token: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/video/fragments:sign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { partId: `vp_${newUlid()}`, indices: [0, 1], contentType: 'video/mp4' },
    });

  it('signs uploads for the own session, during and up to 24 h after the meeting', async () => {
    const [a, b] = accounts;
    if (a === undefined || b === undefined) throw new Error('setup');
    const live = await meeting(a.workspaceId, null);
    const res = await sign(live.sessionId, a.token);
    expect(res.statusCode).toBe(201);
    const body = SignVideoFragmentsResponse.parse(JSON.parse(res.body));
    expect(body.fragments).toHaveLength(2);
    expect(body.headers).toEqual({ 'x-goog-content-length-range': '0,8388608' });
    expect(new URL(body.fragments[0]?.url ?? '').pathname).toContain(
      `/ws/${a.workspaceId}/meetings/${live.meetingId}/video/`,
    );

    expect((await sign(live.sessionId, b.token)).statusCode).toBe(404);
    expect((await sign(live.sessionId, 'nope')).statusCode).toBe(401);
    const old = await meeting(a.workspaceId, new Date(Date.now() - 25 * 3_600_000));
    expect((await sign(old.sessionId, a.token)).statusCode).toBe(410);
    const bad = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${live.sessionId}/video/fragments:sign`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { partId: 'p1', indices: [0], contentType: 'video/mp4' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('returns signed playback for a ready video only, to its own workspace', async () => {
    const [a, b] = accounts;
    if (a === undefined || b === undefined) throw new Error('setup');
    const { meetingId } = await meeting(a.workspaceId, new Date());
    const get = (token: string, query = '') =>
      app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingId}/video${query}`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await get(a.token)).statusCode).toBe(404);
    await env.db.inWorkspace(a.workspaceId, (tx) =>
      upsertVideoAsset(tx, {
        id: `va_${meetingId}`,
        workspaceId: a.workspaceId,
        meetingId,
        partId: null,
        status: 'ready',
        mimeType: 'video/mp4',
        startMs: 2000,
        durationMs: 30_000,
        fragments: 3,
        storageKey: `ws/${a.workspaceId}/meetings/${meetingId}/video/playback.mp4`,
        bytes: 100,
        deleteAfter: null,
      }),
    );
    const ok = await get(a.token, '?download=1');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, no-store');
    const playback = VideoPlaybackResponse.parse(JSON.parse(ok.body));
    expect(playback).toMatchObject({ startMs: 2000, durationMs: 30_000 });
    expect(new URL(playback.url).searchParams.get('response-content-disposition')).toContain(
      'attachment',
    );
    expect((await get(b.token)).statusCode).toBe(404);
  });
});
