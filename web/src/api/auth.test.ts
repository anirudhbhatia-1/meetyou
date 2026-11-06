import { afterEach, describe, expect, it, vi } from 'vitest';

import { pkceChallenge, SignedOutError, WebAuth } from './auth.ts';
import { createHttpApi } from './http.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = (name: string, inMs = 15 * 60_000) => ({
  accessToken: name,
  accessExpiresAt: new Date(Date.now() + inMs).toISOString(),
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('WebAuth', () => {
  it('derives the RFC 7636 appendix B challenge', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('refreshes from the cookie, sends the bearer token and retries once on 401', async () => {
    const calls: { path: string; auth: string | null; client: string | null }[] = [];
    let access = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const path = String(input);
      calls.push({
        path,
        auth: headers.get('authorization'),
        client: headers.get('x-minutes-client'),
      });
      if (path === '/v1/auth/refresh') return Promise.resolve(json(200, token(`t${++access}`)));
      // The first token is rejected (revoked key), the refreshed one works.
      return Promise.resolve(
        headers.get('authorization') === 'Bearer t1' ? json(401, {}) : json(200, { ok: true }),
      );
    }) as typeof fetch;
    const auth = new WebAuth({ fetch: fetchImpl });
    const res = await auth.authorized('/v1/me');
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { path: '/v1/auth/refresh', auth: null, client: 'web' },
      { path: '/v1/me', auth: 'Bearer t1', client: null },
      { path: '/v1/auth/refresh', auth: null, client: 'web' },
      { path: '/v1/me', auth: 'Bearer t2', client: null },
    ]);
  });

  it('reports sign-out when the refresh cookie is gone', async () => {
    const onSignedOut = vi.fn();
    const auth = new WebAuth({
      fetch: (() => Promise.resolve(json(401, {}))) as typeof fetch,
      onSignedOut,
    });
    await expect(auth.authorized('/v1/me')).rejects.toBeInstanceOf(SignedOutError);
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it('finishes sign-in only for the state it started, with the same redirect URI', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const assigned: string[] = [];
    vi.stubGlobal('window', {
      location: { origin: 'https://web.example', assign: (u: string) => assigned.push(u) },
    });
    const sent: unknown[] = [];
    const auth = new WebAuth({
      fetch: ((_: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return Promise.resolve(json(200, token('t1')));
      }) as typeof fetch,
    });
    await auth.startSignIn('client-1', '#/meetings');
    const google = new URL(assigned[0] ?? '');
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('redirect_uri')).toBe('https://web.example/auth/callback');
    expect(google.searchParams.get('scope')).toBe('openid email profile');
    const state = google.searchParams.get('state') ?? '';

    await expect(
      auth.completeSignIn(new URL(`https://web.example/auth/callback?code=c&state=wrong`)),
    ).rejects.toThrow();
    await auth.startSignIn('client-1', '#/meetings');
    const state2 = new URL(assigned[1] ?? '').searchParams.get('state') ?? '';
    expect(state2).not.toBe(state);
    const back = await auth.completeSignIn(
      new URL(`https://web.example/auth/callback?code=c&state=${state2}`),
    );
    expect(back).toBe('#/meetings');
    expect(sent).toEqual([
      {
        code: 'c',
        codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
        redirectUri: 'https://web.example/auth/callback',
      },
    ]);
  });
});

describe('HTTP library API', () => {
  it('maps 404 to null and normalizes null segment fields', async () => {
    const auth = new WebAuth({
      fetch: ((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/v1/auth/refresh') return Promise.resolve(json(200, token('t')));
        if (path.endsWith('/video')) return Promise.resolve(json(404, {}));
        return Promise.resolve(
          json(200, {
            items: [
              {
                id: 'seg_01JC0000000000000000000000',
                workspaceId: 'ws',
                meetingId: 'm',
                lane: 'them',
                speakerClusterId: null,
                speakerName: null,
                startMs: 0,
                endMs: 900,
                text: 'haan theek hai',
                rawText: 'हाँ ठीक है',
                language: 'hi',
                source: 'live',
                flags: [],
              },
            ],
          }),
        );
      }) as typeof fetch,
    });
    const api = createHttpApi(auth);
    expect(await api.getVideo('m')).toBeNull();
    const [segment] = await api.getSegments('m');
    expect(segment?.speakerName).toBeUndefined();
    expect(segment?.text).toBe('haan theek hai');
  });
});
