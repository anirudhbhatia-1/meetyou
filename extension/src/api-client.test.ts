import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiSessionSource, signApiVideoFragments } from './api-client.ts';
import { parseAccessTokenReply, parseMeetTitle, parseOffscreenMessage } from './messages.ts';
import { parseLastRecording } from './last-recording.ts';
import { UploadRejected } from './offscreen/video-uploader.ts';

const API = 'https://api.example';
const session = {
  sessionId: 'ses_1',
  meetingId: 'mtg_1',
  streamUrl: 'wss://gw.example/v1/stream',
  streamToken: 'first',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('cloud session source', () => {
  it('uses the start token once, then recovers a new one per reconnect', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get('authorization') });
        return Promise.resolve(
          json(200, {
            state: 'resumable',
            streamUrl: session.streamUrl,
            streamToken: `again-${calls.length}`,
            expiresAt: '2030-01-01T00:00:00.000Z',
          }),
        );
      }),
    );
    const source = apiSessionSource(API, session, () => Promise.resolve('access'));
    expect(await source.open()).toEqual({ sessionId: 'ses_1', streamUrl: session.streamUrl });
    expect(await source.token('ses_1')).toBe('first');
    expect(await source.token('ses_1')).toBe('again-1');
    expect(calls).toEqual([{ url: `${API}/v1/sessions/ses_1/recover`, auth: 'Bearer access' }]);
  });

  it('stops reconnecting once the session has ended', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(200, { state: 'ended', meetingId: 'mtg_1' }))),
    );
    const source = apiSessionSource(API, session, () => Promise.resolve('access'));
    await source.token('ses_1');
    await expect(source.token('ses_1')).rejects.toThrow('HTTP 410');
  });
});

describe('API video signing', () => {
  it('passes the signed headers to every fragment and rejects closed sessions for good', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json(201, {
            fragments: [
              { index: 0, url: 'https://storage.example/f0', expiresAt: '2030-01-01T00:00:00Z' },
            ],
            headers: { 'x-goog-content-length-range': '0,8388608' },
          }),
        ),
      ),
    );
    const [fragment] = await signApiVideoFragments(API, 't', 'ses_1', 'vp_1', [0], 'video/mp4');
    expect(fragment?.headers).toEqual({ 'x-goog-content-length-range': '0,8388608' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(410, {}))),
    );
    await expect(
      signApiVideoFragments(API, 't', 'ses_1', 'vp_1', [0], 'video/mp4'),
    ).rejects.toBeInstanceOf(UploadRejected);
  });
});

describe('cloud messages', () => {
  it('keeps a valid API session on capture.start and drops a malformed one', () => {
    const base = { target: 'offscreen', type: 'capture.start', streamId: 's', recordVideo: true };
    expect(parseOffscreenMessage({ ...base, session })).toEqual({ ...base, session });
    expect(
      parseOffscreenMessage({ ...base, session: { ...session, streamUrl: 'http://x' } }),
    ).toEqual(base);
    expect(parseAccessTokenReply({ token: 'a' })).toEqual({ token: 'a' });
    expect(parseAccessTokenReply(undefined)).toEqual({ token: null });
    expect(parseMeetTitle({ metadata: { title: '  Sprint sync ' } })).toBe('Sprint sync');
    expect(parseMeetTitle({ metadata: { title: 'Untitled Meeting' } })).toBeNull();
    expect(parseMeetTitle({ snapshot: {} })).toBeNull();
    expect(parseLastRecording({ sessionId: 'ses_1', startedAt: 1, meetingId: 'mtg_1' })).toEqual({
      sessionId: 'ses_1',
      startedAt: 1,
      meetingId: 'mtg_1',
    });
  });
});
