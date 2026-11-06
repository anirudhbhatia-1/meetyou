import { writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';

import { encodeAudioFrame, ServerMessage, type Lane } from '@meetyou/contracts';
import {
  RecordedSession,
  STANDUP_DURATION_MS,
  STANDUP_HINGLISH,
  type Utterance,
} from '@meetyou/fixtures';
import { DEEPGRAM_CAPABILITIES, type SttProvider, type SttResult } from '@meetyou/providers';
import WebSocket from 'ws';

import { MemoryChunkStore } from './chunk-store.ts';
import { createGateway, SUBPROTOCOL } from './server.ts';

/**
 * Records a synthetic WebSocket session for tests and UI mocks (S2-13): the real gateway, a
 * scripted STT provider that plays the fixture script back as interim and final results, and a
 * client that sends silent frames for both lanes. Each server message is stamped with the session
 * time of the audio sent so far, so the recording is deterministic apart from segment IDs.
 *   node backend/apps/gateway/src/record-fixture.ts [out.json]
 */
const FRAME_MS = 100;
const SILENCE = new Uint8Array(3200); // 100 ms of 16 kHz PCM16

/** Plays the script back on one lane as the provider "hears" the audio. */
export function scriptedProvider(script: readonly Utterance[]): SttProvider {
  return {
    name: 'scripted',
    capabilities: DEEPGRAM_CAPABILITIES,
    usdPerMinute: null,
    open(_input, handlers, options) {
      // `them` streams are opened with diarization (FR-SPK-02); `me` without.
      const lane: Lane = options?.diarize === true ? 'them' : 'me';
      const mine = script.filter((u) => u.lane === lane);
      let audioMs = 0;
      const sent = new Set<string>();
      const once = (key: string, result: SttResult) => {
        if (sent.has(key)) return;
        sent.add(key);
        handlers.onResult(result);
      };
      return Promise.resolve({
        send(bytes: Uint8Array) {
          audioMs += (bytes.byteLength / 3200) * FRAME_MS;
          for (const [i, u] of mine.entries()) {
            const step = (u.endMs - u.startMs) / (u.interims.length + 1);
            u.interims.forEach((text, k) => {
              if (audioMs >= u.startMs + step * (k + 1)) {
                once(`${i}:i${k}`, { final: false, text, startMs: u.startMs, endMs: audioMs });
              }
            });
            if (audioMs >= u.endMs) {
              const words = u.text.split(' ');
              const per = (u.endMs - u.startMs) / words.length;
              once(`${i}:f`, {
                final: true,
                text: u.text,
                startMs: u.startMs,
                endMs: u.endMs,
                language: u.language,
                words: words.map((text, w) => ({
                  text,
                  startMs: Math.round(u.startMs + w * per),
                  endMs: Math.round(u.startMs + (w + 1) * per),
                  confidence: 0.95,
                  ...(u.speaker !== undefined ? { speaker: u.speaker } : {}),
                })),
              });
            }
          }
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

export async function recordStandup(): Promise<RecordedSession> {
  const gateway = createGateway({
    store: new MemoryChunkStore(),
    stt: scriptedProvider(STANDUP_HINGLISH),
    devEndpoints: true,
    videoFinalize: 'off',
  });
  await new Promise<void>((done) => gateway.server.listen(0, '127.0.0.1', done));
  try {
    const { port } = gateway.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const post = async (path: string) =>
      (await (await fetch(`${base}${path}`, { method: 'POST' })).json()) as Record<string, string>;
    const { sessionId = '' } = await post('/v1/dev/sessions');
    const { streamToken = '' } = await post(`/v1/dev/sessions/${sessionId}/stream-token`);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/stream`, [
      SUBPROTOCOL,
      `token.${streamToken}`,
    ]);
    const messages: RecordedSession['messages'] = [];
    let nowMs = 0;
    socket.on('message', (data) => {
      messages.push({ atMs: nowMs, message: ServerMessage.parse(JSON.parse(String(data))) });
    });
    await new Promise((done, fail) => {
      socket.once('open', done);
      socket.once('error', fail);
    });
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        sessionId,
        resumeFrom: { me: -1, them: -1 },
        format: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: FRAME_MS },
      }),
    );
    const settle = () => new Promise((r) => setTimeout(r, 5));
    while (!messages.some((m) => m.message.type === 'ready')) await settle();
    for (let seq = 0; seq * FRAME_MS < STANDUP_DURATION_MS; seq++) {
      nowMs = seq * FRAME_MS;
      for (const lane of ['me', 'them'] as const) {
        socket.send(encodeAudioFrame({ lane, seq, captureMs: nowMs, payload: SILENCE }));
      }
      // Let the gateway forward this frame and the provider answer before the clock moves on.
      await settle();
    }
    nowMs = STANDUP_DURATION_MS;
    socket.send(JSON.stringify({ type: 'control', action: 'end', at: STANDUP_DURATION_MS }));
    await new Promise((done) => socket.once('close', done));
    return RecordedSession.parse({
      version: 1,
      name: 'standup-hinglish',
      synthetic: true,
      sessionId,
      durationMs: STANDUP_DURATION_MS,
      messages,
    });
  } finally {
    await gateway.close();
  }
}

if (import.meta.main) {
  const out =
    process.argv[2] ??
    resolve(import.meta.dirname, '../../../../shared/fixtures/src/sessions/standup-hinglish.json');
  const session = await recordStandup();
  await writeFile(out, `${JSON.stringify(session, null, 2)}\n`);
  console.log(`wrote ${session.messages.length} messages to ${out}`);
}
