import { generateKeyPairSync } from 'node:crypto';

import { Storage } from '@google-cloud/storage';
import { newUlid, VideoPlaybackResponse } from '@meetyou/contracts';
import { createMeetingForSession, upsertVideoAsset } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import { describe, expect, it } from 'vitest';

import { GcsBucket } from './bucket.ts';
import { meetingVideoPlayback } from './playback.ts';

describe('GET /v1/meetings/{id}/video helper (S2-14)', () => {
  it('signs the ready file and poster with startMs, and nothing before it is ready', async () => {
    const env = await createTestDb();
    try {
      const signIn = await env.db.signInGoogleUser(
        { googleSub: `g_${newUlid()}`, email: 'a@example.com', displayName: 'A' },
        {
          userId: `usr_${newUlid()}`,
          workspaceId: `ws_${newUlid()}`,
          membershipId: `mem_${newUlid()}`,
          settingsId: `set_${newUlid()}`,
        },
      );
      const ws = signIn.workspaceId ?? '';
      const meetingId = `mtg_${newUlid()}`;
      await env.db.inWorkspace(ws, (tx) =>
        createMeetingForSession(tx, {
          id: meetingId,
          workspaceId: ws,
          sessionId: `ses_${newUlid()}`,
          externalMeetingCode: null,
          startedAt: new Date(),
        }),
      );
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const bucket = new GcsBucket(
        'test-bucket',
        new Storage({
          projectId: 'p',
          credentials: {
            client_email: 's@p.iam.gserviceaccount.com',
            private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
          },
        }),
      );
      expect(await meetingVideoPlayback(env.db, bucket, ws, meetingId)).toBeNull();

      const key = `ws/${ws}/meetings/${meetingId}/video/playback.mp4`;
      const row = {
        id: `va_${meetingId}`,
        workspaceId: ws,
        meetingId,
        partId: null,
        status: 'processing' as const,
        mimeType: 'video/mp4' as const,
        startMs: 1500,
        durationMs: 60_000,
        fragments: 6,
        storageKey: key,
        bytes: 1000,
        deleteAfter: null,
      };
      await env.db.inWorkspace(ws, (tx) => upsertVideoAsset(tx, row));
      expect(await meetingVideoPlayback(env.db, bucket, ws, meetingId)).toBeNull();

      await env.db.inWorkspace(ws, (tx) => upsertVideoAsset(tx, { ...row, status: 'ready' }));
      const playback = await meetingVideoPlayback(env.db, bucket, ws, meetingId);
      expect(VideoPlaybackResponse.safeParse(playback).success).toBe(true);
      expect(playback).toMatchObject({ startMs: 1500, durationMs: 60_000 });
      expect(new URL(playback?.url ?? '').pathname).toBe(`/test-bucket/${key}`);
      expect(new URL(playback?.posterUrl ?? '').pathname).toContain('/video/poster.jpg');
      // Another workspace sees nothing (RLS).
      expect(
        await meetingVideoPlayback(env.db, bucket, 'ws_01J0000000000000000000000X', meetingId),
      ).toBeNull();
    } finally {
      await env.close();
    }
  });
});
