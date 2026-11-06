import type { AddressInfo } from 'node:net';
import process from 'node:process';

import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { encodeAudioFrame, newUlid, ServerMessage, type Lane } from '@meetyou/contracts';
import { createMeetingForSession } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import { DEEPGRAM_CAPABILITIES, type SttProvider, type SttResult } from '@meetyou/providers';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { MemoryChunkStore } from './chunk-store.ts';
import {
  MemorySessionRegistry,
  RedisSessionRegistry,
  type SessionRecord,
  type SessionRegistry,
} from './registry.ts';
import { createGateway, SUBPROTOCOL, type Gateway } from './server.ts';
import { DevTokenIssuer } from './tokens.ts';

const PCM = new Uint8Array(3200);
const gateways: Gateway[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((g) => g.close()));
});

async function listen(gateway: Gateway): Promise<string> {
  gateways.push(gateway);
  await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  const { port } = gateway.server.address() as AddressInfo;
  return `127.0.0.1:${port}`;
}

async function post(url: string): Promise<Record<string, string>> {
  return (await (await fetch(url, { method: 'POST' })).json()) as Record<string, string>;
}

class Client {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;

  constructor(host: string, token: string) {
    this.socket = new WebSocket(`ws://${host}/v1/stream`, [SUBPROTOCOL, `token.${token}`]);
    this.socket.on('message', (d) =>
      this.messages.push(ServerMessage.parse(JSON.parse(String(d)))),
    );
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
    this.closed = new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
  }

  hello(sessionId: string, resumeFrom = { me: -1, them: -1 }): void {
    this.socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        sessionId,
        resumeFrom,
        format: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: 100 },
      }),
    );
  }

  send(lane: Lane, from: number, to: number): void {
    for (let seq = from; seq <= to; seq++) {
      this.socket.send(encodeAudioFrame({ lane, seq, captureMs: seq * 100, payload: PCM }));
    }
  }

  async until(predicate: (m: ServerMessage[]) => boolean): Promise<void> {
    for (let i = 0; i < 300 && !predicate(this.messages); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(predicate(this.messages)).toBe(true);
  }

  ack(lane: Lane): number {
    return this.messages.reduce(
      (n, m) => (m.type === 'ack' && m.lane === lane ? m.upToSeq : n),
      -1,
    );
  }
}

/** Emits one final per 10 frames received, like a provider that keeps up. */
function scriptedStt(): SttProvider {
  return {
    name: 'scripted',
    capabilities: DEEPGRAM_CAPABILITIES,
    usdPerMinute: 0.01,
    open(_input, handlers) {
      let frames = 0;
      return Promise.resolve({
        send: () => {
          frames += 1;
          if (frames % 10 === 0) {
            handlers.onResult({
              final: true,
              text: `line ${frames / 10}`,
              startMs: (frames - 10) * 100,
              endMs: frames * 100 - 50,
              language: 'en',
            } satisfies SttResult);
          }
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: `ses_${newUlid()}`,
    workspaceId: 'ws_1',
    meetingId: 'mtg_1',
    codec: null,
    ended: false,
    endedAt: null,
    stt: 'ok',
    needsBatch: false,
    keyterms: [],
    createdAt: 1,
    ...overrides,
  };
}

async function registryContract(make: () => Promise<SessionRegistry>): Promise<void> {
  const registry = await make();
  try {
    const r = record({ keyterms: [] });
    expect(await registry.get(r.sessionId)).toBeNull();
    await registry.create(r);
    expect(await registry.get(r.sessionId)).toEqual(r);
    // Patches from two instances touch different fields; neither is lost.
    await Promise.all([
      registry.update(r.sessionId, { codec: 'opus' }),
      registry.update(r.sessionId, { stt: 'degraded', needsBatch: true }),
    ]);
    expect(await registry.get(r.sessionId)).toEqual({
      ...r,
      codec: 'opus',
      stt: 'degraded',
      needsBatch: true,
    });
    await registry.update(r.sessionId, { ended: true, endedAt: 5 });
    expect(await registry.get(r.sessionId)).toMatchObject({ ended: true, endedAt: 5 });
    // An unknown session is not created by a patch.
    await registry.update('ses_unknown', { ended: true });
    expect(await registry.get('ses_unknown')).toBeNull();
    const jti = `jti_${newUlid()}`;
    expect(await registry.spendTokenId(jti, 60_000)).toBe(true);
    expect(await registry.spendTokenId(jti, 60_000)).toBe(false);
  } finally {
    await registry.close();
  }
}

describe('session registry (S2-04, ARCHITECTURE §6.2)', () => {
  it('memory: stores, patches field by field and spends token IDs once', async () => {
    await registryContract(() => Promise.resolve(new MemorySessionRegistry()));
  });

  // Runs against a real Redis when REDIS_URL is set (local `redis-server`; Memorystore in staging).
  it.runIf(process.env.REDIS_URL !== undefined)('redis: same contract', async () => {
    await registryContract(async () => {
      const registry = new RedisSessionRegistry(process.env.REDIS_URL ?? '', `test:${newUlid()}:`);
      await registry.ready();
      return registry;
    });
  });
});

describe('gateway failover (S2-04 "kill an instance")', () => {
  it('another instance takes the session over and resumes with no loss', async () => {
    // Shared by both instances, as Cloud Storage and Redis are in staging.
    const store = new MemoryChunkStore();
    const registry = new MemorySessionRegistry();
    const tokens = new DevTokenIssuer();
    const shared = { store, registry, tokens, stt: scriptedStt(), devEndpoints: true };
    const hostA = await listen(createGateway(shared));
    const b = createGateway(shared);
    const hostB = await listen(b);

    const { sessionId = '' } = await post(`http://${hostA}/v1/dev/sessions`);
    const first = new Client(
      hostA,
      (await post(`http://${hostA}/v1/dev/sessions/${sessionId}/stream-token`)).streamToken ?? '',
    );
    await first.opened;
    first.hello(sessionId);
    await first.until((m) => m.some((x) => x.type === 'ready'));
    first.send('them', 0, 99);
    await first.until(() => first.ack('them') === 99);

    // Instance A dies (all its sockets drop); the client reconnects through the load balancer.
    await gateways.shift()?.close();
    await first.closed;
    expect(b.sessions.has(sessionId)).toBe(false);

    const token = (await post(`http://${hostB}/v1/dev/sessions/${sessionId}/stream-token`))
      .streamToken;
    const second = new Client(hostB, token ?? '');
    await second.opened;
    second.hello(sessionId, { me: -1, them: 99 });
    await second.until((m) => m.some((x) => x.type === 'ready'));
    const ready = second.messages.find((m) => m.type === 'ready');
    expect(ready?.type === 'ready' && ready.durableUpTo).toEqual({ me: -1, them: 99 });
    second.send('them', 100, 149);
    second.socket.send(JSON.stringify({ type: 'control', action: 'end', at: 15_000 }));
    expect(await second.closed).toBe(1000);

    const seqs = store.chunks.flatMap((c) => c.frames.map((f) => f.seq));
    expect(seqs).toEqual(Array.from({ length: 150 }, (_, i) => i));
    expect(await registry.get(sessionId)).toMatchObject({ codec: 'pcm16', ended: true });
    // An ended session is not taken over again.
    const late = await post(`http://${hostB}/v1/dev/sessions/${sessionId}/stream-token`);
    expect(late.streamToken).toBeDefined();
    const refused = new Client(hostB, late.streamToken ?? '');
    refused.socket.on('error', () => undefined);
    await refused.opened.catch(() => undefined);
    refused.hello(sessionId, { me: -1, them: 149 });
    await refused.until((m) => m.some((x) => x.type === 'error'));
    expect(refused.messages.find((m) => m.type === 'error')).toMatchObject({
      code: 'session_ended',
    });
  });
});

describe('STT outage handling (S2-04, ARCHITECTURE §6.3)', () => {
  it('reports degraded health and marks the meeting for the batch pass, audio still stored', async () => {
    const store = new MemoryChunkStore();
    const registry = new MemorySessionRegistry();
    const failing: SttProvider = {
      name: 'down',
      capabilities: DEEPGRAM_CAPABILITIES,
      usdPerMinute: null,
      open: () => Promise.reject(new Error('provider unavailable')),
    };
    const host = await listen(createGateway({ store, registry, stt: failing, devEndpoints: true }));
    const { sessionId = '' } = await post(`http://${host}/v1/dev/sessions`);
    const { streamToken = '' } = await post(
      `http://${host}/v1/dev/sessions/${sessionId}/stream-token`,
    );
    const client = new Client(host, streamToken);
    await client.opened;
    client.hello(sessionId);
    await client.until((m) => m.some((x) => x.type === 'ready'));
    client.send('me', 0, 99);
    await client.until((m) => m.some((x) => x.type === 'health'));
    expect(client.messages.find((m) => m.type === 'health')).toEqual({
      type: 'health',
      stt: 'degraded',
      lanes: { me: { receiving: true }, them: { receiving: false } },
    });
    await client.until(() => client.ack('me') === 99);
    expect(await registry.get(sessionId)).toMatchObject({ stt: 'degraded', needsBatch: true });
    client.socket.close();
  });
});

describe('production stream path (JWT + Postgres, S2-04/S2-05/S2-07)', () => {
  it('admits an API-issued token once, stores segments and usage, ends the meeting', async () => {
    const env = await createTestDb();
    try {
      const signIn = await env.db.signInGoogleUser(
        { googleSub: 'sub-1', email: 'a@example.com', displayName: 'A' },
        {
          userId: `usr_${newUlid()}`,
          workspaceId: `ws_${newUlid()}`,
          membershipId: `mem_${newUlid()}`,
          settingsId: `set_${newUlid()}`,
        },
      );
      const workspaceId = signIn.workspaceId ?? '';
      const sessionId = `ses_${newUlid()}`;
      const meetingId = `mtg_${newUlid()}`;
      // What the API's POST /sessions does (S2-09).
      await env.db.inWorkspace(workspaceId, async (tx) => {
        await createMeetingForSession(tx, {
          id: meetingId,
          workspaceId,
          sessionId,
          externalMeetingCode: 'abc-defg-hij',
          startedAt: new Date(),
        });
        await sql`insert into glossary_terms (id, workspace_id, term)
                  values (${`gt_${newUlid()}`}, ${workspaceId}, 'Minutes')`.execute(tx);
      });
      const streamTokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
      const opened: { keyterms?: readonly string[] }[] = [];
      const stt = scriptedStt();
      const recordingStt: SttProvider = {
        ...stt,
        open: (input, handlers, options) => {
          opened.push(options ?? {});
          return stt.open(input, handlers, options);
        },
      };
      const store = new MemoryChunkStore();
      const host = await listen(
        // No worker queue schema in this test database, so finalize is not enqueued here.
        createGateway({
          store,
          stt: recordingStt,
          devEndpoints: false,
          db: env.db,
          streamTokens,
          videoFinalize: 'off',
        }),
      );
      const { token } = await streamTokens.issueStreamToken({
        sessionId,
        workspaceId,
        lanes: ['me', 'them'],
      });

      const client = new Client(host, token);
      await client.opened;
      client.hello(sessionId);
      await client.until((m) => m.some((x) => x.type === 'ready'));
      client.send('them', 0, 29);
      await client.until((m) => m.filter((x) => x.type === 'transcript.segment').length === 3);
      client.socket.send(JSON.stringify({ type: 'control', action: 'end', at: 3000 }));
      expect(await client.closed).toBe(1000);

      // The same token cannot be used twice (single use, ADR-0004 §4.4).
      const replay = new Client(host, token);
      await expect(replay.opened).rejects.toThrow('401');

      expect(opened[0]?.keyterms).toEqual(['Minutes']);
      const rows = await env.db.inWorkspace(workspaceId, async (tx) => ({
        segments: await tx
          .selectFrom('transcriptSegments')
          .select(['text', 'meetingId', 'lane'])
          .orderBy('startMs')
          .execute(),
        meeting: await tx
          .selectFrom('meetings')
          .select(['status', 'endedAt'])
          .where('id', '=', meetingId)
          .executeTakeFirstOrThrow(),
        usage: await tx.selectFrom('usageRecords').select(['sttSecondsThem']).execute(),
      }));
      expect(rows.segments).toEqual([
        { text: 'line 1', meetingId, lane: 'them' },
        { text: 'line 2', meetingId, lane: 'them' },
        { text: 'line 3', meetingId, lane: 'them' },
      ]);
      expect(rows.meeting.status).toBe('processing');
      expect(rows.meeting.endedAt).not.toBeNull();
      expect(rows.usage).toEqual([{ sttSecondsThem: '3.000' }]);
    } finally {
      await env.close();
    }
  });

  it('admits only the pinned extension origin when an allow-list is set (deployed)', async () => {
    const streamTokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    const registry = new MemorySessionRegistry();
    const r = record();
    await registry.create(r);
    const pinned = 'chrome-extension://hjimcofnjnikbeepahmclaniopbnhbbe';
    const host = await listen(
      createGateway({
        store: new MemoryChunkStore(),
        stt: null,
        devEndpoints: false,
        registry,
        streamTokens,
        allowedOrigins: [pinned],
      }),
    );
    const token = async () =>
      (
        await streamTokens.issueStreamToken({
          sessionId: r.sessionId,
          workspaceId: r.workspaceId,
          lanes: ['me'],
        })
      ).token;
    const open = (origin: string | undefined, t: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${host}/v1/stream`, [SUBPROTOCOL, `token.${t}`], {
          ...(origin === undefined ? {} : { origin }),
        });
        ws.once('open', () => {
          ws.close();
          resolve(101);
        });
        ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.once('error', () => undefined);
      });
    expect(await open('chrome-extension://otherextensionidotherextensionid', await token())).toBe(
      403,
    );
    expect(await open(undefined, await token())).toBe(403);
    expect(await open(pinned, await token())).toBe(101);
  });

  it('refuses dev tokens when dev endpoints are off, and tokens for another workspace', async () => {
    const streamTokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    const registry = new MemorySessionRegistry();
    const r = record();
    await registry.create(r);
    const host = await listen(
      createGateway({
        store: new MemoryChunkStore(),
        stt: null,
        devEndpoints: false,
        registry,
        streamTokens,
      }),
    );
    const wrong = await streamTokens.issueStreamToken({
      sessionId: r.sessionId,
      workspaceId: 'ws_other',
      lanes: ['me'],
    });
    await expect(new Client(host, wrong.token).opened).rejects.toThrow('401');
    await expect(new Client(host, 'dev-token').opened).rejects.toThrow('401');
    const right = await streamTokens.issueStreamToken({
      sessionId: r.sessionId,
      workspaceId: r.workspaceId,
      lanes: ['me'],
    });
    const ok = new Client(host, right.token);
    await ok.opened;
    ok.socket.close();
  });
});
