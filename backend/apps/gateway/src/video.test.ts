import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalChunkStore, MemoryChunkStore } from './chunk-store.ts';
import { createGateway, MAX_VIDEO_FRAGMENT_BYTES, type Gateway } from './server.ts';
import { checkVideoPart, videoExtension } from './session-check.ts';
import { DevVideoSigner, VIDEO_URL_TTL_MS } from './tokens.ts';

const PART = 'vp_01JC0000000000000000000000';

let gateway: Gateway | null = null;

afterEach(async () => {
  await gateway?.close();
  gateway = null;
});

async function start(store: MemoryChunkStore, signer?: DevVideoSigner) {
  gateway = createGateway({ store, stt: null, devEndpoints: true, videoSigner: signer });
  await new Promise<void>((resolve) => gateway?.server.listen(0, '127.0.0.1', resolve));
  const { port } = gateway.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const session = (await (await fetch(`${base}/v1/dev/sessions`, { method: 'POST' })).json()) as {
    sessionId: string;
  };
  return { base, sessionId: session.sessionId };
}

function sign(base: string, sessionId: string, body: unknown): Promise<Response> {
  return fetch(`${base}/v1/dev/sessions/${sessionId}/video/fragments:sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function signedUrls(base: string, sessionId: string, indices: number[]): Promise<string[]> {
  const res = await sign(base, sessionId, { partId: PART, indices, contentType: 'video/mp4' });
  expect(res.status).toBe(201);
  const { fragments } = (await res.json()) as { fragments: { index: number; url: string }[] };
  expect(fragments.map((f) => f.index)).toEqual(indices);
  return fragments.map((f) => f.url);
}

function put(url: string, bytes: Uint8Array, contentType = 'video/mp4'): Promise<Response> {
  return fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
}

describe('dev video upload (ADR-0011 §3.3)', () => {
  it('signs fragments of a known session and stores each PUT idempotently', async () => {
    const store = new MemoryChunkStore();
    const { base, sessionId } = await start(store);
    const [url0, url1] = await signedUrls(base, sessionId, [0, 1]);

    expect((await put(url0 ?? '', new Uint8Array([1, 2, 3]))).status).toBe(200);
    // A retry with the same URL overwrites the same object.
    expect((await put(url0 ?? '', new Uint8Array([4, 5]))).status).toBe(200);
    expect((await put(url1 ?? '', new Uint8Array([6]))).status).toBe(200);

    const stored = store.videoFragments.get(`${sessionId}/${PART}/0`);
    expect([...(stored?.bytes ?? [])]).toEqual([4, 5]);
    expect(stored?.workspaceId).toBe('dev');
    expect(store.videoFragments.size).toBe(2);
  });

  it('answers the CORS preflight the extension sends before a JSON POST or a PUT', async () => {
    const { base } = await start(new MemoryChunkStore());
    const origin = 'chrome-extension://abcdefghijklmnop';
    const res = await fetch(`${base}/v1/dev/video/x`, { method: 'OPTIONS', headers: { origin } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('refuses web pages: only the extension and origin-less tools may use dev endpoints', async () => {
    const { base } = await start(new MemoryChunkStore());
    const res = await fetch(`${base}/v1/dev/sessions`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses unknown sessions, bad requests, wrong types, unknown URLs and oversized bodies', async () => {
    const store = new MemoryChunkStore();
    const { base, sessionId } = await start(store);
    const valid = { partId: PART, indices: [0], contentType: 'video/mp4' };

    expect((await sign(base, 'ses_unknown', valid)).status).toBe(404);
    expect((await sign(base, sessionId, { ...valid, partId: 'nope' })).status).toBe(400);
    expect((await sign(base, sessionId, { ...valid, indices: [] })).status).toBe(400);
    expect((await sign(base, sessionId, { ...valid, contentType: 'text/html' })).status).toBe(400);

    const [url] = await signedUrls(base, sessionId, [0]);
    expect((await put(url ?? '', new Uint8Array([1]), 'video/webm')).status).toBe(400);
    expect((await put(url ?? '', new Uint8Array(0))).status).toBe(400);
    expect((await put(`${base}/v1/dev/video/unknown`, new Uint8Array([1]))).status).toBe(403);
    const big = new Uint8Array(MAX_VIDEO_FRAGMENT_BYTES + 1);
    expect((await put(url ?? '', big)).status).toBe(413);
    expect(store.videoFragments.size).toBe(0);
  });

  it('accepts a content type with parameters, as MediaRecorder reports it', async () => {
    const store = new MemoryChunkStore();
    const { base, sessionId } = await start(store);
    const [url] = await signedUrls(base, sessionId, [3]);
    const res = await put(url ?? '', new Uint8Array([9]), 'video/mp4; codecs=avc1');
    expect(res.status).toBe(200);
  });
});

describe('DevVideoSigner', () => {
  it('resolves a token until it expires', () => {
    let now = 1_000;
    const signer = new DevVideoSigner(() => now);
    const upload = { sessionId: 'ses_1', partId: PART, index: 2, contentType: 'video/mp4' };
    const { token, expiresAt } = signer.sign(upload);
    expect(expiresAt).toBe(1_000 + VIDEO_URL_TTL_MS);
    expect(signer.resolve(token)).toEqual(upload);
    now = expiresAt + 1;
    expect(signer.resolve(token)).toBeNull();
  });
});

describe('LocalChunkStore video fragments', () => {
  it('writes fragments under the ARCHITECTURE §11.4 layout and refuses unsafe IDs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-video-'));
    try {
      const store = new LocalChunkStore(dir);
      const fragment = { workspaceId: 'dev', meetingId: 'ses_1', partId: PART, index: 4 };
      await store.putVideoFragment({ ...fragment, bytes: new Uint8Array([7, 8]) });
      const path = join(dir, 'ws', 'dev', 'meetings', 'ses_1', 'video', PART, '4.frag');
      expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array([7, 8]));
      await expect(
        store.putVideoFragment({ ...fragment, partId: '../x', bytes: new Uint8Array([1]) }),
      ).rejects.toThrow('invalid video fragment id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('checkVideoPart', () => {
  it('reports indices that never uploaded', () => {
    expect(checkVideoPart([0, 1, 3, 4])).toEqual({ fragments: 4, missingIndices: [2] });
    expect(checkVideoPart([])).toEqual({ fragments: 0, missingIndices: [] });
  });

  it('names the joined file from the container magic bytes', () => {
    expect(videoExtension(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))).toBe('mp4');
    expect(videoExtension(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe('webm');
    expect(videoExtension(new Uint8Array(8))).toBe('bin');
  });
});
