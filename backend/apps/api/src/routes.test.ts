import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { TokenService, generateSigningJwk, loadKeyRing } from '@meetyou/auth';
// Queue schema included: DELETE /v1/meetings enqueues the hard delete (S2-10).
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { newUlid, RecoverSessionResponse } from '@meetyou/contracts';

import { buildApp } from './app.ts';

describe('Core REST API Endpoints (S2-09)', () => {
  let tokens: TokenService;
  let testDb: Awaited<ReturnType<typeof createQueueTestEnv>>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  let workspaceIdA: string;
  let userIdA: string;
  let tokenA: string;

  let workspaceIdB: string;
  let userIdB: string;
  let tokenB: string;

  beforeAll(async () => {
    // 1. Keyring & tokens
    const key = await generateSigningJwk('test-routes-key');
    const ring = await loadKeyRing([key]);
    tokens = new TokenService(ring);

    // 2. In-memory PGlite DB with applied migrations
    testDb = await createQueueTestEnv();

    // 3. Seed workspaces and users via signInGoogleUser
    const accountA = await testDb.db.signInGoogleUser(
      {
        googleSub: 'google-sub-alpha',
        email: 'alpha@example.com',
        displayName: 'Alpha Tester',
      },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    workspaceIdA = accountA.workspaceId ?? '';
    userIdA = accountA.userId;

    const accountB = await testDb.db.signInGoogleUser(
      {
        googleSub: 'google-sub-beta',
        email: 'beta@example.com',
        displayName: 'Beta Tester',
      },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    workspaceIdB = accountB.workspaceId ?? '';
    userIdB = accountB.userId;

    // 4. Issue access tokens
    const accessA = await tokens.issueAccessToken({
      userId: userIdA,
      workspaceId: workspaceIdA,
      scope: 'user',
    });
    tokenA = accessA.token;

    const accessB = await tokens.issueAccessToken({
      userId: userIdB,
      workspaceId: workspaceIdB,
      scope: 'user',
    });
    tokenB = accessB.token;

    // 5. Build Fastify App
    app = await buildApp({
      tokens,
      db: testDb.db,
      config: {
        env: 'test',
        gatewayWsUrl: 'wss://gateway.test.meetyou.local',
      },
    });
  }, 25000);

  afterAll(async () => {
    await testDb.close();
  });

  // 1. Auth & Public JWKS
  describe('Auth and JWKS', () => {
    it('serves public JWKS at /.well-known/jwks.json', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/jwks.json',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.keys)).toBe(true);
      expect(body.keys.length).toBeGreaterThan(0);
      expect(body.keys[0].kty).toBe('EC');
      expect(body.keys[0].kid).toBe('test-routes-key');
    });

    it('rejects unauthenticated requests to protected routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/me' });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('missing_token');
    });
  });

  // 2. User & Workspace Profile (/v1/me)
  describe('GET /v1/me', () => {
    it('returns current user and workspace for authenticated user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.userId).toBe(userIdA);
      expect(body.workspaceId).toBe(workspaceIdA);
      expect(body.email).toBe('alpha@example.com');
      expect(body.displayName).toBe('Alpha Tester');
    });
  });

  // 3. Settings (/v1/settings)
  describe('Settings (/v1/settings)', () => {
    it('fetches default settings if none exist yet', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/settings',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.retentionPolicy).toBe('7d');
      expect(body.recordVideo).toBe(true);
      expect(body.transcriptLanguageMode).toBe('auto');
    });

    it('updates settings via PATCH and persists changes', async () => {
      const updateRes = await app.inject({
        method: 'PATCH',
        url: '/v1/settings',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          retentionPolicy: '30d',
          transcriptLanguageMode: 'hinglish',
          followMeetMute: false,
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updated = JSON.parse(updateRes.body);
      expect(updated.retentionPolicy).toBe('30d');
      expect(updated.transcriptLanguageMode).toBe('hinglish');
      expect(updated.followMeetMute).toBe(false);

      // Verify persistence on subsequent GET
      const getRes = await app.inject({
        method: 'GET',
        url: '/v1/settings',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const persisted = JSON.parse(getRes.body);
      expect(persisted.retentionPolicy).toBe('30d');
      expect(persisted.transcriptLanguageMode).toBe('hinglish');
    });

    it('records the consent acknowledgement with the server time only (FR-ONB-06)', async () => {
      const patch = (payload: Record<string, unknown>) =>
        app.inject({
          method: 'PATCH',
          url: '/v1/settings',
          headers: { authorization: `Bearer ${tokenA}` },
          payload,
        });
      const before = Date.now();
      const ack = await patch({ consentAcknowledged: true });
      expect(ack.statusCode).toBe(200);
      const at = Date.parse(JSON.parse(ack.body).consentAcknowledgedAt as string);
      expect(at).toBeGreaterThanOrEqual(before - 1000);
      // A client-chosen time is not accepted.
      expect((await patch({ consentAcknowledgedAt: '2020-01-01T00:00:00Z' })).statusCode).toBe(400);
    });

    it('accepts the Minutes of meeting template as the default (migration 0009)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/settings',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { defaultTemplate: 'minutes' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).defaultTemplate).toBe('minutes');
    });
  });

  // 4. Sessions (/v1/sessions)
  describe('Sessions (/v1/sessions)', () => {
    let sessionId: string;
    let meetingId: string;

    it('starts a recording session, creates meeting record, and mints stream token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          platform: 'google_meet',
          meetingCode: 'abc-defg-hij',
          title: 'Sprint Planning Call',
          recordVideo: true,
          clientInfo: {
            extensionVersion: '0.1.0',
            browser: 'Chrome 131',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.sessionId).toMatch(/^ses_/);
      expect(body.meetingId).toMatch(/^mtg_/);
      expect(body.streamUrl).toBe('wss://gateway.test.meetyou.local');
      expect(typeof body.streamToken).toBe('string');
      expect(body.audioFormat).toEqual({
        codec: 'opus',
        sampleRate: 16000,
        channels: 1,
        frameMs: 100,
      });
      expect(body.video).toBeDefined();

      sessionId = body.sessionId;
      meetingId = body.meetingId;
    });

    it('issues a recovery token for an active session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${sessionId}/recover`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessionId).toBe(sessionId);
      expect(typeof body.streamToken).toBe('string');
      expect(RecoverSessionResponse.parse(body).state).toBe('resumable');
    });

    it('ends a session and transitions meeting to processing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${sessionId}/end`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ended');
      expect(body.meetingId).toBe(meetingId);

      const recovered = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${sessionId}/recover`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(RecoverSessionResponse.parse(JSON.parse(recovered.body))).toEqual({
        state: 'ended',
        meetingId,
      });

      // Verify meeting status in DB
      const meetingRes = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(meetingRes.statusCode).toBe(200);
      const m = JSON.parse(meetingRes.body);
      expect(m.status).toBe('processing');
      expect(m.endedAt).not.toBeNull();
    });
  });

  // 5. Meetings CRUD & Tenancy Isolation
  describe('Meetings CRUD & Tenancy Isolation (/v1/meetings)', () => {
    let meetingAId: string;

    it('creates and lists meetings with cursor pagination', async () => {
      // Start 2 sessions for Workspace A
      const start1 = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          platform: 'google_meet',
          meetingCode: 'call-1',
          title: 'Design Review',
          recordVideo: false,
          clientInfo: { extensionVersion: '0.1.0', browser: 'Chrome' },
        },
      });
      meetingAId = JSON.parse(start1.body).meetingId;

      const start2 = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          platform: 'google_meet',
          meetingCode: 'call-2',
          title: 'Daily Standup',
          recordVideo: false,
          clientInfo: { extensionVersion: '0.1.0', browser: 'Chrome' },
        },
      });
      expect(start2.statusCode).toBe(201);

      // List with limit 1
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/meetings?limit=1',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.items.length).toBe(1);
      expect(listBody.nextCursor).toBeDefined();

      // List next page with cursor
      const nextRes = await app.inject({
        method: 'GET',
        url: `/v1/meetings?limit=1&cursor=${encodeURIComponent(listBody.nextCursor)}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(nextRes.statusCode).toBe(200);
      const nextBody = JSON.parse(nextRes.body);
      expect(nextBody.items.length).toBe(1);
      expect(nextBody.items[0].id).not.toBe(listBody.items[0].id);
    });

    it('prevents cross-workspace meeting access (tenancy isolation)', async () => {
      // User B attempts to access Workspace A's meeting
      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingAId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('updates meeting title via PATCH', async () => {
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/v1/meetings/${meetingAId}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { title: 'Updated Design Review Title' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.body).title).toBe('Updated Design Review Title');
    });

    it('soft deletes meeting with DELETE and restores via :restore within grace period', async () => {
      // Soft delete
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/v1/meetings/${meetingAId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(delRes.statusCode).toBe(204);

      // Verify meeting no longer listed
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingAId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(getRes.statusCode).toBe(404);

      // Restore
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meetingAId}:restore`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(restoreRes.statusCode).toBe(200);

      // Verify meeting accessible again
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingAId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(verifyRes.statusCode).toBe(200);
    });
  });

  // 6. Notes Endpoints (/v1/meetings/:id/notes)
  describe('Notes Endpoints', () => {
    let meetingId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          platform: 'google_meet',
          meetingCode: 'notes-call',
          title: 'Notes Test Call',
          recordVideo: false,
          clientInfo: { extensionVersion: '0.1.0', browser: 'Chrome' },
        },
      });
      meetingId = JSON.parse(res.body).meetingId;
    });

    it('adds individual live notes and retrieves them in session clock order', async () => {
      await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meetingId}/notes`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          text: 'First note at 10s',
          sessionMs: 10000,
          marker: 'action',
        },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meetingId}/notes`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          text: 'Second note at 5s',
          sessionMs: 5000,
          marker: 'decision',
        },
      });

      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingId}/notes`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(getRes.statusCode).toBe(200);
      const items = JSON.parse(getRes.body).items;
      expect(items.length).toBe(2);
      expect(items[0].sessionMs).toBe(5000); // 5s comes before 10s!
      expect(items[1].sessionMs).toBe(10000);
    });

    it('bulk syncs notes array with PUT', async () => {
      const syncRes = await app.inject({
        method: 'PUT',
        url: `/v1/meetings/${meetingId}/notes`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          notes: [
            { id: 'not_1', sessionMs: 1000, marker: 'important', text: 'Synced note 1' },
            { id: 'not_2', sessionMs: 2000, marker: null, text: 'Synced note 2' },
          ],
        },
      });
      expect(syncRes.statusCode).toBe(200);
      const items = JSON.parse(syncRes.body).items;
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('not_1');
    });
  });

  // 7. Consent Logs (/v1/consent-log)
  describe('Consent Logs', () => {
    let meetingId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          platform: 'google_meet',
          meetingCode: 'consent-call',
          title: 'Consent Call',
          recordVideo: false,
          clientInfo: { extensionVersion: '0.1.0', browser: 'Chrome' },
        },
      });
      meetingId = JSON.parse(res.body).meetingId;
    });

    it('records consent notice and retrieves it by meeting ID', async () => {
      const postRes = await app.inject({
        method: 'POST',
        url: '/v1/consent-log',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          meetingId,
          mode: 'one_click',
          outcome: 'posted',
          noticeText: 'Recording notice sent to chat',
        },
      });
      expect(postRes.statusCode).toBe(201);
      const entry = JSON.parse(postRes.body);
      expect(entry.id).toMatch(/^clg_/);
      expect(entry.outcome).toBe('posted');

      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingId}/consent-log`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(getRes.statusCode).toBe(200);
      const items = JSON.parse(getRes.body).items;
      expect(items.length).toBe(1);
      expect(items[0].outcome).toBe('posted');
    });
  });

  // 8. Transcript Segments (/v1/meetings/:id/segments)
  describe('Transcript Segments', () => {
    let meetingId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          platform: 'google_meet',
          meetingCode: 'segments-call',
          title: 'Segments Call',
          recordVideo: false,
          clientInfo: { extensionVersion: '0.1.0', browser: 'Chrome' },
        },
      });
      meetingId = JSON.parse(res.body).meetingId;

      // Insert segments into DB directly to test retrieval
      await testDb.db.inWorkspace(workspaceIdA, async (tx) => {
        await tx
          .insertInto('transcriptSegments')
          .values([
            {
              id: `seg_${newUlid()}`,
              workspaceId: workspaceIdA,
              meetingId,
              lane: 'me',
              startMs: 0,
              endMs: 2500,
              text: 'Hello team let us get started',
              rawText: 'Hello team let us get started',
              language: 'en',
              source: 'live',
              flags: [],
            },
            {
              id: `seg_${newUlid()}`,
              workspaceId: workspaceIdA,
              meetingId,
              lane: 'them',
              startMs: 2600,
              endMs: 5000,
              text: 'Haan bhai start karte hain',
              rawText: 'हाँ भाई start करते हैं',
              language: 'hi',
              source: 'live',
              flags: [],
            },
          ])
          .execute();
      });
    });

    it('retrieves all stored transcript segments for the meeting in startMs order', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meetingId}/segments`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const items = JSON.parse(res.body).items;
      expect(items.length).toBe(2);
      expect(items[0].lane).toBe('me');
      expect(items[0].startMs).toBe(0);
      expect(items[1].lane).toBe('them');
      expect(items[1].startMs).toBe(2600);
      expect(items[1].text).toBe('Haan bhai start karte hain');
    });
  });
});
