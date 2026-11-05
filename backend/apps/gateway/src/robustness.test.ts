import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';

import { encodeAudioFrame, ServerMessage, type Lane } from '@meetyou/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { MemoryChunkStore, type AudioChunk } from './chunk-store.ts';
import { allowedHost, createGateway, SUBPROTOCOL, type Gateway } from './server.ts';
import type { SttInput, SttProvider, SttStreamHandlers } from './stt/types.ts';

const PCM = new Uint8Array(3200);

let gateway: Gateway | null = null;

afterEach(async () => {
  await gateway?.close();
  gateway = null;
});

async function start(
  store: MemoryChunkStore,
  stt: SttProvider | null = null,
  endedSessionTtlMs?: number,
) {
  gateway = createGateway({ store, stt, devEndpoints: true, endedSessionTtlMs });
  await new Promise<void>((resolve) => gateway?.server.listen(0, '127.0.0.1', resolve));
  const { port } = gateway.server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, port };
}

async function post(url: string): Promise<Record<string, string>> {
  return (await (await fetch(url, { method: 'POST' })).json()) as Record<string, string>;
}

async function connectSession(base: string) {
  const { sessionId = '', streamUrl = '' } = await post(`${base}/v1/dev/sessions`);
  const { streamToken = '' } = await post(`${base}/v1/dev/sessions/${sessionId}/stream-token`);
  const socket = new WebSocket(streamUrl, [SUBPROTOCOL, `token.${streamToken}`]);
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(ServerMessage.parse(JSON.parse(String(data)))));
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      sessionId,
      resumeFrom: { me: -1, them: -1 },
      format: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: 100 },
    }),
  );
  const sendFrames = (lane: Lane, from: number, to: number) => {
    for (let seq = from; seq <= to; seq++) {
      socket.send(encodeAudioFrame({ lane, seq, captureMs: seq * 100, payload: PCM }));
    }
  };
  return { sessionId, socket, messages, closed, sendFrames };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(predicate()).toBe(true);
}

/** Fails the first `put` after a delay, so later chunks are already queued behind it. */
class FlakyStore extends MemoryChunkStore {
  failures = 1;

  override async put(chunk: AudioChunk): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('disk full');
    }
    return super.put(chunk);
  }
}

describe('gateway robustness (code review 2026-11-05)', () => {
  it('never acknowledges past a failed chunk write, so the client keeps the lost frames', async () => {
    const store = new FlakyStore();
    const { base } = await start(store);
    const client = await connectSession(base);
    await until(() => client.messages.some((m) => m.type === 'ready'));
    client.sendFrames('me', 0, 104);
    client.socket.send(JSON.stringify({ type: 'control', action: 'end', at: 10_500 }));

    expect(await client.closed).toBe(1011);
    expect(client.messages).toContainEqual({
      type: 'error',
      code: 'storage_failed',
      retryable: true,
    });
    expect(client.messages.filter((m) => m.type === 'ack')).toEqual([]);
    expect(store.chunks).toEqual([]);
  });

  it('survives a malformed upgrade request', async () => {
    const { base, port } = await start(new MemoryChunkStore());
    const raw = connect(port, '127.0.0.1');
    await new Promise((resolve) => raw.once('connect', resolve));
    raw.write(
      'GET http://[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    );
    const reply = await new Promise<string>((resolve) =>
      raw.once('data', (d) => resolve(String(d))),
    );
    raw.destroy();
    expect(reply).toMatch(/^HTTP\/1\.1 [45]\d\d/);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('refuses a WebSocket upgrade from a web page origin', async () => {
    const { base } = await start(new MemoryChunkStore());
    const { sessionId = '', streamUrl = '' } = await post(`${base}/v1/dev/sessions`);
    const { streamToken = '' } = await post(`${base}/v1/dev/sessions/${sessionId}/stream-token`);
    const socket = new WebSocket(streamUrl, [SUBPROTOCOL, `token.${streamToken}`], {
      origin: 'https://evil.example',
    });
    await expect(
      new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toThrow('403');
  });

  it('backs off before reopening a provider stream that closed unexpectedly', async () => {
    let opens = 0;
    const stt: SttProvider = {
      name: 'closing',
      usdPerMinute: 0,
      open(_input: SttInput, handlers: SttStreamHandlers) {
        opens += 1;
        setTimeout(() => handlers.onClosed('provider_closed'), 5);
        return Promise.resolve({ send: () => undefined, close: () => Promise.resolve() });
      },
    };
    const { base } = await start(new MemoryChunkStore(), stt);
    const client = await connectSession(base);
    await until(() => client.messages.some((m) => m.type === 'ready'));
    client.sendFrames('them', 0, 0);
    await new Promise((r) => setTimeout(r, 30));
    client.sendFrames('them', 1, 40);
    await new Promise((r) => setTimeout(r, 30));
    expect(opens).toBe(1);
    client.socket.close();
  });

  it('signs and stores video fragments after the meeting ended (ADR-0011 §3.3)', async () => {
    const store = new MemoryChunkStore();
    const { base } = await start(store, null, 200);
    const client = await connectSession(base);
    await until(() => client.messages.some((m) => m.type === 'ready'));
    client.sendFrames('me', 0, 4);
    client.socket.send(JSON.stringify({ type: 'control', action: 'end', at: 500 }));
    expect(await client.closed).toBe(1000);

    // The last fragment is written when recording stops, after the audio stream has ended.
    const sign = () =>
      fetch(`${base}/v1/dev/sessions/${client.sessionId}/video/fragments:sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          partId: 'vp_01JC0000000000000000000000',
          indices: [2],
          contentType: 'video/mp4',
        }),
      });
    const signed = await sign();
    expect(signed.status).toBe(201);
    const { fragments } = (await signed.json()) as { fragments: { url: string }[] };
    const put = await fetch(fragments[0]?.url ?? '', {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(put.status).toBe(200);
    expect(store.videoFragments.size).toBe(1);

    // Evicted only after the grace period.
    await new Promise((r) => setTimeout(r, 300));
    expect((await sign()).status).toBe(404);
  });

  it('refuses requests naming another host (DNS rebinding)', async () => {
    const { port } = await start(new MemoryChunkStore());
    const reply = await new Promise<string>((resolve) => {
      const raw = connect(port, '127.0.0.1', () => {
        raw.write(
          'POST /v1/dev/sessions HTTP/1.1\r\nHost: evil.example\r\nContent-Length: 0\r\n\r\n',
        );
      });
      raw.once('data', (d) => {
        resolve(String(d));
        raw.destroy();
      });
    });
    expect(reply).toMatch(/^HTTP\/1\.1 403/);
    expect(allowedHost('127.0.0.1:8787')).toBe(true);
    expect(allowedHost('localhost:8787')).toBe(true);
    expect(allowedHost('[::1]:8787')).toBe(true);
    expect(allowedHost('evil.example:8787')).toBe(false);
    expect(allowedHost(undefined)).toBe(false);
  });

  it('evicts a session nobody ever connected to', async () => {
    const { base } = await start(new MemoryChunkStore(), null, 100);
    const { sessionId = '' } = await post(`${base}/v1/dev/sessions`);
    await new Promise((r) => setTimeout(r, 350));
    const res = await fetch(`${base}/v1/dev/sessions/${sessionId}/stream-token`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});
