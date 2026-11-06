import type { VideoPlaybackResponse } from '@meetyou/contracts';
import type { Db } from '@meetyou/db';
import type { z } from 'zod';

import type { GcsBucket } from './bucket.ts';
import { videoFileKey } from './layout.ts';
import { signReadUrl } from './signing.ts';

/**
 * `GET /v1/meetings/{id}/video` (S2-14): signed links to the finalized file and its poster, with
 * `startMs` for transcript click-to-seek. Null when the meeting has no ready video yet (the API
 * answers 404). Runs in the caller's workspace (RLS).
 */
export async function meetingVideoPlayback(
  db: Db,
  bucket: GcsBucket,
  workspaceId: string,
  meetingId: string,
  options: { now?: number; download?: boolean } = {},
): Promise<z.infer<typeof VideoPlaybackResponse> | null> {
  const row = await db.inWorkspace(workspaceId, (tx) =>
    tx
      .selectFrom('videoAssets')
      .select(['storageKey', 'startMs', 'durationMs', 'status'])
      .where('meetingId', '=', meetingId)
      .where('partId', 'is', null)
      .executeTakeFirst(),
  );
  if (row === undefined || row.status !== 'ready' || row.storageKey === null) return null;
  const now = options.now ?? Date.now();
  const video = await signReadUrl(bucket, row.storageKey, {
    now,
    ...(options.download === true ? { downloadName: `minutes-${meetingId}.mp4` } : {}),
  });
  const poster = await signReadUrl(bucket, videoFileKey(workspaceId, meetingId, 'poster.jpg'), {
    now,
  });
  return {
    url: video.url,
    posterUrl: poster.url,
    expiresAt: video.expiresAt,
    startMs: Number(row.startMs),
    durationMs: row.durationMs ?? 0,
  };
}
