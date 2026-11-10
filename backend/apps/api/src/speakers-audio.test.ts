import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningJwk, loadKeyRing, TokenService } from '@meetyou/auth';
import { AudioSpans, newUlid, RenameSpeakerResponse, type Segment } from '@meetyou/contracts';
import { createMeetingForSession, storeSegments } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import { audioChunkBase, MemoryBucket, oggOpusFile, readOggOpusPackets } from '@meetyou/storage';

import { buildApp } from './app.ts';
import { AUDIO_SPANS_HEADER } from './routes/audio.ts';

/** S4-09: speaker rename for the whole meeting, and audio playback with its time map. */
describe('speakers and audio', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const people: { workspaceId: string; token: string }[] = [];
  const bucket = new MemoryBucket();
  let meetingId = '';
  let clusterId = '';

  beforeAll(async () => {
    env = await createTestDb();
    const tokens = new TokenService(await loadKeyRing([await generateSigningJwk('k1')]));
    for (const sub of ['owner', 'other']) {
      const account = await env.db.signInGoogleUser(
        { googleSub: sub, email: `${sub}@example.com`, displayName: sub },
        {
          userId: `usr_${newUlid()}`,
          workspaceId: `ws_${newUlid()}`,
          membershipId: `mem_${newUlid()}`,
          settingsId: `set_${newUlid()}`,
        },
      );
      const workspaceId = account.workspaceId ?? '';
      const { token } = await tokens.issueAccessToken({
        userId: account.userId,
        workspaceId,
        scope: 'user',
      });
      people.push({ workspaceId, token });
    }
    const workspaceId = people[0]?.workspaceId ?? '';
    meetingId = `mtg_${newUlid()}`;
    const segment: Segment = {
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane: 'them',
      speakerClusterId: 'spk_1',
      startMs: 0,
      endMs: 2_000,
      text: 'Release Friday tak.',
      rawText: 'Release Friday tak.',
      language: 'hi',
      source: 'live',
      flags: [],
    };
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        startedAt: new Date(),
      });
      await storeSegments(tx, [segment], () => `spc_${newUlid()}`);
      clusterId = (await tx.selectFrom('speakerClusters').select('id').executeTakeFirstOrThrow())
        .id;
      await tx
        .insertInto('audioAssets')
        .values({
          id: `aud_${meetingId}_them`,
          workspaceId,
          meetingId,
          lane: 'them',
          storageKey: `ws/${workspaceId}/meetings/${meetingId}/audio/them/`,
          codec: 'opus',
          bytes: 100,
          durationMs: 2_000,
        })
        .execute();
    });
    // Two 1 s chunks with a 10 s pause between them.
    for (const [startMs, firstSeq] of [
      [0, 0],
      [11_000, 50],
    ] as const) {
      const base = audioChunkBase(workspaceId, meetingId, 'them', startMs);
      const frames = Array.from({ length: 50 }, (_, i) => ({
        seq: firstSeq + i,
        captureMs: startMs + i * 20,
        durationMs: 20,
      }));
      const packets = frames.map(() => new Uint8Array([0xf8, 0xff, 0xfe]));
      await bucket.save(`${base}.opus`, oggOpusFile(packets, { serial: 1 }), 'audio/ogg');
      await bucket.save(
        `${base}.json`,
        new TextEncoder().encode(
          JSON.stringify({ codec: 'opus', firstSeq, lastSeq: firstSeq + 49, frames }),
        ),
        'application/json',
      );
    }
    app = await buildApp({ tokens, db: env.db, config: { env: 'test' }, recordings: bucket });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await env.close();
  });

  const auth = (who = 0) => ({ authorization: `Bearer ${people[who]?.token}` });

  it('lists only the other people in a meeting, never the user', async () => {
    const workspaceId = people[0]?.workspaceId ?? '';
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .insertInto('participants')
        .values([
          {
            id: `prt_${newUlid()}`,
            workspaceId,
            meetingId,
            displayName: 'You',
            isSelf: true,
            source: 'dom',
          },
          { id: `prt_${newUlid()}`, workspaceId, meetingId, displayName: 'Neha', source: 'dom' },
        ])
        .execute(),
    );
    const one = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}`,
      headers: auth(),
    });
    expect(one.json().participantNames).toEqual(['Neha']);
    const list = await app.inject({ method: 'GET', url: '/v1/meetings', headers: auth() });
    const row = (list.json().items as { id: string; participantNames: string[] }[]).find(
      (m) => m.id === meetingId,
    );
    expect(row?.participantNames).toEqual(['Neha']);
  });

  it('filters the list by title or person (q) and by id', async () => {
    const list = async (query: string) =>
      (
        (await app.inject({ method: 'GET', url: `/v1/meetings?${query}`, headers: auth() })).json()
          .items as { id: string }[]
      ).map((m) => m.id);
    // Neha was added as a participant by the test above; the user's own row never matches.
    expect(await list('q=neh')).toEqual([meetingId]);
    expect(await list('q=You')).toEqual([]);
    expect(await list('q=nobody-here')).toEqual([]);
    expect(await list(`ids=${meetingId},mtg_unknown`)).toEqual([meetingId]);
    expect(await list('ids=bad%20id')).toEqual([]);
  });

  it('renames a speaker for the whole meeting, with a typed name or a participant', async () => {
    const rename = (payload: Record<string, unknown>, who = 0) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/meetings/${meetingId}/speakers/${clusterId}`,
        headers: auth(who),
        payload,
      });
    const typed = RenameSpeakerResponse.parse((await rename({ name: 'Sameer K.' })).json());
    expect(typed.displayName).toBe('Sameer K.');
    const again = RenameSpeakerResponse.parse((await rename({ name: 'Sameer K.' })).json());
    expect(again.participantId).toBe(typed.participantId);
    expect((await rename({ participantId: typed.participantId })).statusCode).toBe(200);
    expect((await rename({ participantId: 'prt_elsewhere' })).statusCode).toBe(400);
    expect((await rename({ name: '' })).statusCode).toBe(400);
    expect((await rename({ name: 'X' }, 1)).statusCode).toBe(404);
    const segments = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}/segments`,
      headers: auth(),
    });
    expect(JSON.stringify(segments.json())).toContain('Sameer K.');
  });

  it("plays one lane's audio with a time map that skips the pause", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}/audio?lane=them`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/ogg');
    expect(readOggOpusPackets(new Uint8Array(res.rawPayload))).toHaveLength(100);
    const spans = AudioSpans.parse(
      JSON.parse(
        Buffer.from(String(res.headers[AUDIO_SPANS_HEADER]), 'base64url').toString('utf8'),
      ),
    );
    expect(spans).toEqual([
      { fileMs: 0, sessionMs: 0, durationMs: 1_000 },
      { fileMs: 1_000, sessionMs: 11_000, durationMs: 1_000 },
    ]);
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}/audio?lane=me`,
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
    const stranger = await app.inject({
      method: 'GET',
      url: `/v1/meetings/${meetingId}/audio?lane=them`,
      headers: auth(1),
    });
    expect(stranger.statusCode).toBe(404);
  });
});
