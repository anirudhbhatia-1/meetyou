import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeAudioFrame, packOpusFrame, ServerMessage, type Lane } from '@meetyou/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { LocalChunkStore, MemoryChunkStore, type ChunkStore } from './chunk-store.ts';
import { LaneChunker } from './lane-chunker.ts';
import { createGateway, SUBPROTOCOL, tokenFromProtocols, type Gateway } from './server.ts';
import { checkLane } from './session-check.ts';
import { EchoDetector, echoTokens, wordSimilarity } from './echo.ts';
import { parseDeepgramMessage } from './stt/deepgram.ts';
import type { SttInput, SttProvider, SttResult } from './stt/types.ts';
import { StreamTimeline } from './timeline.ts';
import { DevTokenIssuer } from './tokens.ts';

const PCM = new Uint8Array(3200);

function frame(lane: Lane, seq: number) {
  return { lane, seq, captureMs: seq * 100, payload: PCM };
}

describe('LaneChunker', () => {
  it('chunks in order, ignores duplicates and reports gaps', () => {
    const c = new LaneChunker(-1, 3);
    expect(c.accept(frame('me', 0), 100)).toBe('accepted');
    expect(c.accept(frame('me', 0), 100)).toBe('duplicate');
    expect(c.accept(frame('me', 2), 100)).toBe('gap');
    c.accept(frame('me', 1), 100);
    expect(c.take()).toBeNull();
    c.accept(frame('me', 2), 100);
    const chunk = c.take();
    expect(chunk?.frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(chunk?.payloads.map((p) => p.byteLength)).toEqual([3200, 3200, 3200]);
    expect(chunk?.frames[0]?.durationMs).toBe(100);
  });

  it('drops pending frames on disconnect and resumes after the durable seq', () => {
    const c = new LaneChunker(-1, 3);
    for (const seq of [0, 1, 2, 3]) c.accept(frame('me', seq), 100);
    c.take();
    c.committed(2);
    c.dropPending();
    expect(c.durableUpTo).toBe(2);
    expect(c.take(true)).toBeNull();
    expect(c.accept(frame('me', 3), 100)).toBe('accepted');
  });
});

describe('StreamTimeline', () => {
  it('maps provider time to the session clock across a pause', () => {
    const t = new StreamTimeline();
    for (const ms of [0, 100, 200]) t.sent(ms, 100);
    for (const ms of [5000, 5100]) t.sent(ms, 100); // resumed after a pause
    expect(t.toSessionMs(150)).toBe(150);
    expect(t.toSessionMs(300)).toBe(5000);
    expect(t.toSessionMs(450)).toBe(5150);
  });
});

describe('DevTokenIssuer', () => {
  it('issues single-use tokens that expire', () => {
    let now = 0;
    const tokens = new DevTokenIssuer(() => now);
    const a = tokens.issue('s1');
    expect(tokens.consume(a)).toBe('s1');
    expect(tokens.consume(a)).toBeNull();
    const b = tokens.issue('s1');
    now = 11 * 60 * 1000;
    expect(tokens.consume(b)).toBeNull();
  });

  it('reads the token from the subprotocol header', () => {
    expect(tokenFromProtocols('minutes.v1, token.abc')).toBe('abc');
    expect(tokenFromProtocols('token.abc')).toBeNull();
    expect(tokenFromProtocols(undefined)).toBeNull();
  });
});

describe('parseDeepgramMessage', () => {
  it('maps a final result to milliseconds and the majority word language', () => {
    const result = parseDeepgramMessage(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        start: 1.5,
        duration: 1.2,
        channel: {
          alternatives: [
            {
              transcript: 'kal meeting hai',
              words: [
                { word: 'kal', start: 1.5, end: 1.8, language: 'hi' },
                { word: 'meeting', start: 1.8, end: 2.2, language: 'en' },
                { word: 'hai', start: 2.2, end: 2.7, language: 'hi' },
              ],
            },
          ],
        },
      }),
    );
    expect(result).toMatchObject({ final: true, startMs: 1500, endMs: 2700, language: 'hi' });
    expect(parseDeepgramMessage('{"type":"Metadata"}')).toBeNull();
    expect(parseDeepgramMessage('not json')).toBeNull();
  });
});

describe('LocalChunkStore', () => {
  it('recovers durableUpTo from manifests after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-'));
    try {
      const store = new LocalChunkStore(dir);
      await store.put({
        workspaceId: 'dev',
        meetingId: 'ses_1',
        lane: 'them',
        frames: [
          { seq: 0, captureMs: 0, durationMs: 100 },
          { seq: 1, captureMs: 100, durationMs: 100 },
        ],
        audio: new Uint8Array(6400),
        codec: 'pcm16',
      });
      const reopened = new LocalChunkStore(dir);
      expect(await reopened.durableUpTo('dev', 'ses_1')).toEqual({ me: -1, them: 1 });
      await expect(reopened.durableUpTo('dev', '../etc')).rejects.toThrow('invalid storage id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------- end to end over a real socket ----------

class FakeStt implements SttProvider {
  readonly name = 'fake';
  readonly usdPerMinute = 0.01;
  frames = 0;
  inputs: SttInput[] = [];
  firstBytes: Uint8Array[] = [];
  open(input: SttInput, handlers: { onResult(result: SttResult): void }) {
    this.inputs.push(input);
    return Promise.resolve({
      send: (bytes: Uint8Array) => {
        if (this.firstBytes.length < 2) this.firstBytes.push(bytes);
        this.frames += 1;
        if (this.frames === 10) {
          handlers.onResult({ final: true, text: 'haan theek hai', startMs: 200, endMs: 900 });
        }
      },
      close: () => Promise.resolve(),
    });
  }
}

let gateway: Gateway | null = null;

afterEach(async () => {
  await gateway?.close();
  gateway = null;
});

async function start(store: ChunkStore, stt: SttProvider | null) {
  gateway = createGateway({ store, stt, devEndpoints: true });
  await new Promise<void>((resolve) => gateway?.server.listen(0, '127.0.0.1', resolve));
  const { port } = gateway.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function post(url: string): Promise<Record<string, string>> {
  const res = await fetch(url, { method: 'POST' });
  return (await res.json()) as Record<string, string>;
}

class Client {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;

  constructor(url: string, token: string) {
    this.socket = new WebSocket(url, [SUBPROTOCOL, `token.${token}`]);
    this.socket.on('message', (data) =>
      this.messages.push(ServerMessage.parse(JSON.parse(String(data)))),
    );
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
    this.closed = new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
  }

  hello(
    sessionId: string,
    resumeFrom = { me: -1, them: -1 },
    codec: 'pcm16' | 'opus' = 'pcm16',
  ): void {
    this.socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        sessionId,
        resumeFrom,
        format: { codec, sampleRate: 16000, channels: 1, frameMs: 100 },
      }),
    );
  }

  sendFrames(lane: Lane, from: number, to: number): void {
    for (let seq = from; seq <= to; seq++) this.socket.send(encodeAudioFrame(frame(lane, seq)));
  }

  async until(predicate: (m: ServerMessage[]) => boolean): Promise<void> {
    for (let i = 0; i < 200 && !predicate(this.messages); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(predicate(this.messages)).toBe(true);
  }
}

function lastAck(messages: ServerMessage[], lane: Lane): number {
  return messages.reduce((n, m) => (m.type === 'ack' && m.lane === lane ? m.upToSeq : n), -1);
}

describe('gateway end to end', () => {
  it('rejects a connection without a valid token', async () => {
    const base = await start(new MemoryChunkStore(), null);
    const client = new Client(base.replace('http', 'ws') + '/v1/stream', 'nope');
    await expect(client.opened).rejects.toThrow('401');
  });

  it('acks only durable chunks, resumes after a drop, and forwards each frame to STT once', async () => {
    const store = new MemoryChunkStore();
    const stt = new FakeStt();
    const base = await start(store, stt);
    const { sessionId, streamUrl } = await post(`${base}/v1/dev/sessions`);
    expect(sessionId).toMatch(/^ses_/);
    const token = async () =>
      (await post(`${base}/v1/dev/sessions/${sessionId}/stream-token`)).streamToken ?? '';

    const first = new Client(streamUrl ?? '', await token());
    await first.opened;
    first.hello(sessionId ?? '');
    await first.until((m) => m.some((x) => x.type === 'ready'));
    first.sendFrames('them', 0, 149);
    await first.until((m) => lastAck(m, 'them') === 99);
    await first.until((m) => m.some((x) => x.type === 'transcript.segment'));
    const segment = first.messages.find((m) => m.type === 'transcript.segment');
    expect(segment?.type === 'transcript.segment' && segment.segment).toMatchObject({
      lane: 'them',
      startMs: 200,
      endMs: 900,
      source: 'live',
    });
    first.socket.terminate(); // 100..149 were only pending: lost on the gateway side
    await first.closed;

    const second = new Client(streamUrl ?? '', await token());
    await second.opened;
    second.hello(sessionId ?? '', { me: -1, them: 99 });
    await second.until((m) => m.some((x) => x.type === 'ready'));
    const ready = second.messages.find((m) => m.type === 'ready');
    expect(ready?.type === 'ready' && ready.durableUpTo).toEqual({ me: -1, them: 99 });
    second.sendFrames('them', 100, 159);
    second.socket.send(JSON.stringify({ type: 'control', action: 'end', at: 16000 }));
    await second.until((m) => lastAck(m, 'them') === 159);
    expect(await second.closed).toBe(1000);

    const seqs = store.chunks.flatMap((c) => c.frames.map((f) => f.seq));
    expect(seqs).toEqual(Array.from({ length: 160 }, (_, i) => i));
    expect(stt.frames).toBe(160);
    expect(stt.inputs).toEqual(['pcm16']);

    const usage = store.usage.get(sessionId ?? '');
    expect(usage).toMatchObject({
      codec: 'pcm16',
      connections: 2,
      audioMs: { me: 0, them: 16_000 },
      stt: { provider: 'fake', audioMs: { me: 0, them: 16_000 }, streamsOpened: 1 },
      estimatedCostUsd: 0.0027,
    });
  });

  it('stores Opus as Ogg files and streams Ogg (headers first) to STT without decoding', async () => {
    const store = new MemoryChunkStore();
    const stt = new FakeStt();
    const base = await start(store, stt);
    const { sessionId, streamUrl } = await post(`${base}/v1/dev/sessions`);
    const { streamToken } = await post(`${base}/v1/dev/sessions/${sessionId}/stream-token`);
    const client = new Client(streamUrl ?? '', streamToken ?? '');
    await client.opened;
    client.hello(sessionId ?? '', { me: -1, them: -1 }, 'opus');
    await client.until((m) => m.some((x) => x.type === 'ready'));
    const ready = client.messages.find((m) => m.type === 'ready');
    expect(ready?.type === 'ready' && ready.acceptedFormat.codec).toBe('opus');

    const packet = new Uint8Array(60).fill(9);
    for (let seq = 0; seq < 3; seq++) {
      const payload = packOpusFrame([packet, packet, packet, packet, packet]);
      client.socket.send(encodeAudioFrame({ lane: 'me', seq, captureMs: seq * 100, payload }));
    }
    client.socket.send(JSON.stringify({ type: 'control', action: 'end', at: 300 }));
    await client.until((m) => lastAck(m, 'me') === 2);

    const [chunk] = store.chunks;
    expect(chunk?.codec).toBe('opus');
    expect(Buffer.from(chunk?.audio.subarray(0, 4) ?? []).toString()).toBe('OggS');
    expect(chunk?.frames.map((f) => f.durationMs)).toEqual([100, 100, 100]);
    expect(stt.inputs).toEqual(['ogg_opus']);
    expect(Buffer.from(stt.firstBytes[0]?.subarray(28, 36) ?? []).toString()).toBe('OpusHead');
    expect(store.usage.get(sessionId ?? '')?.audioMs.me).toBe(300);
  });

  it('rejects a codec change within a session', async () => {
    const base = await start(new MemoryChunkStore(), null);
    const { sessionId, streamUrl } = await post(`${base}/v1/dev/sessions`);
    const token = async () =>
      (await post(`${base}/v1/dev/sessions/${sessionId}/stream-token`)).streamToken ?? '';
    const first = new Client(streamUrl ?? '', await token());
    await first.opened;
    first.hello(sessionId ?? '');
    await first.until((m) => m.some((x) => x.type === 'ready'));
    first.socket.terminate();
    const second = new Client(streamUrl ?? '', await token());
    await second.opened;
    second.hello(sessionId ?? '', { me: -1, them: -1 }, 'opus');
    await second.until((m) => m.some((x) => x.type === 'error'));
    expect(second.messages.find((m) => m.type === 'error')).toMatchObject({
      code: 'format_changed',
    });
  });

  it('asks the client to reconnect on a sequence gap', async () => {
    const base = await start(new MemoryChunkStore(), null);
    const { sessionId, streamUrl } = await post(`${base}/v1/dev/sessions`);
    const { streamToken } = await post(`${base}/v1/dev/sessions/${sessionId}/stream-token`);
    const client = new Client(streamUrl ?? '', streamToken ?? '');
    await client.opened;
    client.hello(sessionId ?? '');
    await client.until((m) => m.some((x) => x.type === 'ready'));
    client.sendFrames('me', 5, 5);
    await client.until((m) => m.some((x) => x.type === 'error'));
    expect(client.messages.find((m) => m.type === 'error')).toMatchObject({
      code: 'sequence_gap',
      retryable: true,
    });
  });
});

describe('checkLane', () => {
  it('reports missing frames as loss and captureMs jumps as gaps', () => {
    const frames = [0, 1, 2, 4, 5].map((seq) => ({
      seq,
      captureMs: seq < 4 ? seq * 100 : seq * 100 + 5000,
      durationMs: 100,
    }));
    const r = checkLane(frames);
    expect(r.missingSeqs).toEqual([3]);
    expect(r.gaps).toEqual([{ atMs: 300, lengthMs: 5100 }]);
    expect(r.audioMs).toBe(500);
  });

  it('passes a contiguous lane', () => {
    const frames = Array.from({ length: 10 }, (_, seq) => ({
      seq,
      captureMs: seq * 100,
      durationMs: 100,
    }));
    const r = checkLane(frames);
    expect([r.missingSeqs, r.duplicateSeqs, r.gaps]).toEqual([[], [], []]);
    expect(r.spanMs).toBe(1000);
  });
});

describe('EchoDetector', () => {
  it('flags a me segment that repeats a recent them segment', () => {
    const d = new EchoDetector();
    expect(d.check('them', 1000, 3000, 'Kal ki meeting cancel hai.')).toEqual({
      flag: false,
      late: false,
    });
    expect(d.check('me', 1200, 3100, 'kal ki meeting cancel hai')).toEqual({
      flag: true,
      late: false,
    });
  });

  it('counts a late echo when the them copy arrives second', () => {
    const d = new EchoDetector();
    d.check('me', 1000, 2000, 'हाँ ठीक है भेज दो');
    expect(d.check('them', 1100, 2100, 'हाँ ठीक है भेज दो')).toEqual({ flag: false, late: true });
  });

  it('ignores different words, far-apart times and one-word replies', () => {
    const d = new EchoDetector();
    d.check('them', 1000, 2000, 'please send the report today');
    expect(d.check('me', 1500, 2500, 'I will check with finance').flag).toBe(false);
    expect(d.check('me', 30_000, 31_000, 'please send the report today').flag).toBe(false);
    d.check('them', 40_000, 40_500, 'okay');
    expect(d.check('me', 40_100, 40_600, 'okay').flag).toBe(false);
  });

  it('scores word overlap', () => {
    expect(wordSimilarity(echoTokens('a b c d'), echoTokens('a b c d'))).toBe(1);
    expect(wordSimilarity(echoTokens('a b'), echoTokens('c d'))).toBe(0);
  });
});
