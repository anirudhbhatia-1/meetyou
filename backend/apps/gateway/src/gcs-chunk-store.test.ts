import type { AddressInfo } from 'node:net';

import { encodeAudioFrame, ServerMessage } from '@meetyou/contracts';
import { MemoryBucket } from '@meetyou/storage';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { GcsChunkStore } from './gcs-chunk-store.ts';
import { createGateway, SUBPROTOCOL, type Gateway } from './server.ts';

const frame = (seq: number, captureMs = seq * 100) => ({ seq, captureMs, durationMs: 100 });

describe('GcsChunkStore (S2-04, ARCHITECTURE §11.4)', () => {
  it('writes audio then its manifest, and resumes from the newest manifest only', async () => {
    const bucket = new MemoryBucket();
    const store = new GcsChunkStore(bucket);
    for (const start of [0, 100, 200]) {
      await store.put({
        workspaceId: 'ws_1',
        meetingId: 'mtg_1',
        lane: 'them',
        frames: Array.from({ length: 100 }, (_, i) => frame(start + i, (start + i) * 100)),
        audio: new Uint8Array([1, 2, 3]),
        codec: 'opus',
      });
    }
    expect([...bucket.objects.keys()].filter((k) => k.includes('/audio/them/'))).toEqual([
      'ws/ws_1/meetings/mtg_1/audio/them/0000000000.opus',
      'ws/ws_1/meetings/mtg_1/audio/them/0000000000.json',
      'ws/ws_1/meetings/mtg_1/audio/them/0000010000.opus',
      'ws/ws_1/meetings/mtg_1/audio/them/0000010000.json',
      'ws/ws_1/meetings/mtg_1/audio/them/0000020000.opus',
      'ws/ws_1/meetings/mtg_1/audio/them/0000020000.json',
    ]);
    expect(
      bucket.objects.get('ws/ws_1/meetings/mtg_1/audio/them/0000000000.opus')?.contentType,
    ).toBe('audio/ogg');
    expect(await store.durableUpTo('ws_1', 'mtg_1')).toEqual({ me: -1, them: 299 });
    // An audio object without its manifest (crash between the two writes) is not durable.
    await bucket.save(
      'ws/ws_1/meetings/mtg_1/audio/them/0000030000.opus',
      new Uint8Array(1),
      'audio/ogg',
    );
    expect(await store.durableUpTo('ws_1', 'mtg_1')).toEqual({ me: -1, them: 299 });
  });

  it('stores usage and segment batches under the meeting', async () => {
    const bucket = new MemoryBucket();
    const store = new GcsChunkStore(bucket);
    await store.appendSegments('ws_1', 'mtg_1', []);
    expect(bucket.objects.size).toBe(0);
    await store.putUsage({ workspaceId: 'ws_1', sessionId: 'ses_1' } as never, 'mtg_1');
    expect(bucket.objects.has('ws/ws_1/meetings/mtg_1/usage.json')).toBe(true);
    expect(await store.videoFile()).toBeNull();
  });
});

let gateway: Gateway | null = null;
afterEach(async () => {
  await gateway?.close();
  gateway = null;
});

describe('gateway on Cloud Storage', () => {
  it('acks only durable chunks and resumes after a drop', async () => {
    const store = new GcsChunkStore(new MemoryBucket());
    gateway = createGateway({ store, stt: null, devEndpoints: true });
    await new Promise<void>((resolve) => gateway?.server.listen(0, '127.0.0.1', resolve));
    const { port } = gateway.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const post = async (path: string) =>
      (await (await fetch(`${base}${path}`, { method: 'POST' })).json()) as Record<string, string>;
    const { sessionId = '' } = await post('/v1/dev/sessions');

    const connect = async (resume: number) => {
      const { streamToken = '' } = await post(`/v1/dev/sessions/${sessionId}/stream-token`);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream`, [
        SUBPROTOCOL,
        `token.${streamToken}`,
      ]);
      const messages: ServerMessage[] = [];
      ws.on('message', (d) => messages.push(ServerMessage.parse(JSON.parse(String(d)))));
      await new Promise((r) => ws.once('open', r));
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocolVersion: 1,
          sessionId,
          resumeFrom: { me: -1, them: resume },
          format: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: 100 },
        }),
      );
      for (let i = 0; i < 200 && !messages.some((m) => m.type === 'ready'); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      return { ws, messages };
    };
    const ack = (messages: ServerMessage[]) =>
      messages.reduce((n, m) => (m.type === 'ack' && m.lane === 'them' ? m.upToSeq : n), -1);
    const send = (ws: WebSocket, from: number, to: number) => {
      for (let seq = from; seq <= to; seq++) {
        ws.send(
          encodeAudioFrame({
            lane: 'them',
            seq,
            captureMs: seq * 100,
            payload: new Uint8Array(3200),
          }),
        );
      }
    };

    const first = await connect(-1);
    send(first.ws, 0, 149);
    for (let i = 0; i < 300 && ack(first.messages) < 99; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(ack(first.messages)).toBe(99);
    first.ws.terminate();

    const second = await connect(99);
    const ready = second.messages.find((m) => m.type === 'ready');
    expect(ready?.type === 'ready' && ready.durableUpTo).toEqual({ me: -1, them: 99 });
    send(second.ws, 100, 159);
    second.ws.send(JSON.stringify({ type: 'control', action: 'end', at: 16_000 }));
    await new Promise((r) => second.ws.once('close', r));
    expect(await store.durableUpTo('dev', sessionId)).toEqual({ me: -1, them: 159 });
  });
});
