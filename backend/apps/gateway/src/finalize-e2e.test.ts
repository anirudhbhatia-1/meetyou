import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ServerMessage } from '@meetyou/contracts';
import { hasFfmpeg, synthFragments } from '@meetyou/video/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { LocalChunkStore } from './chunk-store.ts';
import { createGateway, parseRange, SUBPROTOCOL, type Gateway } from './server.ts';

const PART = 'vp_01J00000000000000000000PRT';

describe('Range header parsing (playback seeking)', () => {
  it('reads single ranges and refuses the rest', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});

describe.runIf(hasFfmpeg())('video.finalize through the dev gateway (S2-14)', () => {
  let dir: string;
  let gateway: Gateway | null = null;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gw-finalize-'));
  });
  afterEach(async () => {
    await gateway?.close();
    gateway = null;
    await rm(dir, { recursive: true, force: true });
  });

  it('finalizes once the ended session has every fragment, then serves it with Range', async () => {
    gateway = createGateway({
      store: new LocalChunkStore(join(dir, 'data')),
      stt: null,
      devEndpoints: true,
    });
    await new Promise<void>((resolve) => gateway?.server.listen(0, '127.0.0.1', resolve));
    const { port } = gateway.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const post = async (path: string, body?: unknown) =>
      (await (
        await fetch(`${base}${path}`, {
          method: 'POST',
          ...(body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        })
      ).json()) as Record<string, unknown>;

    const { sessionId } = (await post('/v1/dev/sessions')) as { sessionId: string };
    const { streamToken } = (await post(`/v1/dev/sessions/${sessionId}/stream-token`)) as {
      streamToken: string;
    };
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/stream`, [
      SUBPROTOCOL,
      `token.${streamToken}`,
    ]);
    const messages: ServerMessage[] = [];
    socket.on('message', (d) => messages.push(ServerMessage.parse(JSON.parse(String(d)))));
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
    for (let i = 0; i < 500 && !messages.some((m) => m.type === 'ready'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(messages.some((m) => m.type === 'ready')).toBe(true);

    const fragments = await synthFragments(dir, 'part', 6, 'green');
    const event = (seq: number, e: unknown) =>
      socket.send(JSON.stringify({ type: 'event', seq, event: e }));
    event(0, {
      type: 'video.part_started',
      sessionId,
      partId: PART,
      source: 'tab',
      mimeType: 'video/mp4',
      width: 640,
      height: 360,
      fps: 15,
      at: 2000,
    });
    event(1, {
      type: 'video.part_stopped',
      sessionId,
      partId: PART,
      fragments: fragments.length,
      reason: 'stopped',
      at: 8000,
    });
    socket.send(JSON.stringify({ type: 'control', action: 'end', at: 8000 }));
    await new Promise((resolve) => socket.once('close', resolve));

    // Fragments arrive after the meeting ended (ADR-0011 §3.3); the last one completes it.
    const signed = (await post(`/v1/dev/sessions/${sessionId}/video/fragments:sign`, {
      partId: PART,
      indices: fragments.map((_, i) => i),
      contentType: 'video/mp4',
    })) as { fragments: { url: string }[] };
    for (const [i, f] of fragments.entries()) {
      const res = await fetch(signed.fragments[i]?.url ?? '', {
        method: 'PUT',
        headers: { 'content-type': 'video/mp4' },
        body: f,
      });
      expect(res.status).toBe(200);
    }

    let listed: { parts: unknown[]; playback: { url: string; bytes: number } | null } = {
      parts: [],
      playback: null,
    };
    for (let i = 0; i < 300 && listed.playback === null; i++) {
      await new Promise((r) => setTimeout(r, 50));
      listed = (await (
        await fetch(`${base}/v1/dev/sessions/${sessionId}/video`)
      ).json()) as typeof listed;
    }
    expect(listed.playback).not.toBeNull();
    // Fragments are gone once the playback file exists.
    expect(listed.parts).toEqual([]);

    const ranged = await fetch(listed.playback?.url ?? '', { headers: { range: 'bytes=0-99' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-99/${listed.playback?.bytes}`);
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);
    const whole = await fetch(`${listed.playback?.url ?? ''}?download=1`);
    expect(whole.headers.get('content-disposition')).toContain('attachment');
    expect((await whole.arrayBuffer()).byteLength).toBe(listed.playback?.bytes);
    const poster = await fetch(`${base}/v1/dev/sessions/${sessionId}/video/poster`);
    expect(poster.headers.get('content-type')).toBe('image/jpeg');
  }, 120_000);
});
