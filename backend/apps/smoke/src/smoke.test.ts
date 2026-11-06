import type { AddressInfo } from 'node:net';

import { buildApp } from '@meetyou/api/app';
import { generateSigningJwk, loadKeyRing, StreamTokenVerifier, TokenService } from '@meetyou/auth';
import { newUlid } from '@meetyou/contracts';
import { MemoryChunkStore } from '@meetyou/gateway/chunk-store';
import { scriptedProvider } from '@meetyou/gateway/record-fixture';
import { createGateway } from '@meetyou/gateway/server';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pcmFrames, runSmoke } from './smoke.ts';

const ORIGIN = 'chrome-extension://hjimcofnjnikbeepahmclaniopbnhbbe';

describe('pcm framing', () => {
  it('cuts 100 ms frames and pads the last one with silence', () => {
    const frames = pcmFrames(new Uint8Array(3200 * 2 + 10).fill(1));
    expect(frames.map((f) => f.byteLength)).toEqual([3200, 3200, 3200]);
    expect(frames[2]?.[9]).toBe(1);
    expect(frames[2]?.[10]).toBe(0);
  });
});

/**
 * The staging smoke flow against the real gateway and API in process (S2-12): API session and
 * stream token, gateway admission with the JWT, durable acks, segments in Postgres read back
 * through the API, then the meeting deleted. Only STT is scripted.
 */
describe('smoke run end to end (local)', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let gateway: ReturnType<typeof createGateway>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let apiUrl = '';
  let gatewayUrl = '';
  let token = '';

  beforeAll(async () => {
    env = await createQueueTestEnv();
    const tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    gateway = createGateway({
      store: new MemoryChunkStore(),
      stt: scriptedProvider([
        {
          lane: 'them',
          speaker: 0,
          startMs: 0,
          endMs: 1_500,
          text: 'This is the Minutes smoke test.',
          interims: [],
          language: 'en',
          voice: 'Rishi',
        },
      ]),
      devEndpoints: false,
      streamTokens: new StreamTokenVerifier(tokens.jwks),
      db: env.db,
      videoFinalize: 'off',
      allowedOrigins: [ORIGIN],
    });
    await new Promise<void>((done) => gateway.server.listen(0, '127.0.0.1', done));
    gatewayUrl = `ws://127.0.0.1:${(gateway.server.address() as AddressInfo).port}/v1/stream`;
    app = await buildApp({
      tokens,
      db: env.db,
      config: { env: 'test', gatewayWsUrl: 'wss://gateway.test/v1/stream' },
    });
    apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const account = await env.db.signInGoogleUser(
      { googleSub: 'smoke:ci', email: 'smoke-test@minutes.invalid', displayName: 'Smoke Test' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    token = (
      await tokens.issueAccessToken({
        userId: account.userId,
        workspaceId: account.workspaceId ?? '',
        scope: 'user',
      })
    ).token;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await gateway.close();
    await env.close();
  });

  it('streams, stores, reads back and cleans up', async () => {
    const result = await runSmoke({
      apiUrl,
      accessToken: token,
      origin: ORIGIN,
      pcmThem: new Uint8Array(32_000 * 2), // 2 s; the scripted STT "hears" by length
      speed: 50,
      streamUrl: gatewayUrl,
      segmentTimeoutMs: 10_000,
    });
    expect(result).toMatchObject({ framesSent: 20, acked: true, deleted: true });
    expect(result.segments).toBeGreaterThan(0);
  }, 60_000);

  it('is refused from another origin', async () => {
    await expect(
      runSmoke({
        apiUrl,
        accessToken: token,
        origin: 'https://evil.example',
        pcmThem: new Uint8Array(3200),
        streamUrl: gatewayUrl,
      }),
    ).rejects.toThrow('stream connect');
  }, 30_000);
});
