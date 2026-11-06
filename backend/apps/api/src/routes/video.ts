import { SignVideoFragmentsRequest, type SignVideoFragmentsResponse } from '@meetyou/contracts';
import { meetingForSession, type Db } from '@meetyou/db';
import { meetingVideoPlayback, signFragmentUploads, type GcsBucket } from '@meetyou/storage';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { AppError, BadRequestError, NotFoundError } from '../errors.ts';

/** Fragments keep uploading after the meeting ends, at most this long (ADR-0011 §3.3–3.4). */
export const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

export interface VideoRoutesOptions {
  db?: Db;
  /** The recordings bucket; video routes answer 503 when it is not configured. */
  bucket?: GcsBucket;
  now?: () => number;
}

function workspaceOf(request: FastifyRequest): string {
  if (request.workspaceId === undefined || request.inWorkspace === undefined) {
    throw new AppError(503, 'database_unavailable', 'database not configured', true);
  }
  return request.workspaceId;
}

/**
 * Video (S2-14, ARCHITECTURE §12.1):
 * - `POST /v1/sessions/{id}/video/fragments:sign` — ≤ 50 V4 signed PUT URLs for the caller's own
 *   session, while it records or up to 24 h after it ended; each bound to its object, content
 *   type and size (the `headers` must be sent with every PUT).
 * - `GET /v1/meetings/{id}/video` — signed playback and poster URLs of the finalized file, with
 *   `startMs` for click-to-seek; 404 until `video.finalize` has made it ready. `?download=1`
 *   makes the link save the file.
 */
export const videoRoutes: FastifyPluginAsync<VideoRoutesOptions> = async (fastify, options) => {
  const now = options.now ?? Date.now;
  const bucketOrFail = (): GcsBucket => {
    if (options.bucket === undefined) {
      throw new AppError(503, 'storage_unavailable', 'video storage not configured', true);
    }
    return options.bucket;
  };

  fastify.post<{ Params: { sessionId: string } }>(
    '/v1/sessions/:sessionId/video/fragments::sign',
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const workspaceId = workspaceOf(request);
      const parsed = SignVideoFragmentsRequest.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError('invalid sign request', 'invalid_request');
      const bucket = bucketOrFail();
      const meeting = await request.inWorkspace?.((tx) =>
        meetingForSession(tx, request.params.sessionId),
      );
      // RLS: another workspace's session looks the same as an unknown one.
      if (meeting === undefined) throw new NotFoundError('session not found', 'session_not_found');
      if (meeting.endedAt !== null && now() - meeting.endedAt.getTime() > UPLOAD_GRACE_MS) {
        throw new AppError(410, 'upload_window_closed', 'video uploads have closed', false);
      }
      const signed = await signFragmentUploads(
        bucket,
        { workspaceId, meetingId: meeting.id, ...parsed.data },
        now(),
      );
      const response: z.infer<typeof SignVideoFragmentsResponse> = signed;
      return reply.status(201).send(response);
    },
  );

  fastify.get<{ Params: { meetingId: string }; Querystring: { download?: string } }>(
    '/v1/meetings/:meetingId/video',
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const workspaceId = workspaceOf(request);
      const bucket = bucketOrFail();
      const db = options.db;
      if (db === undefined) {
        throw new AppError(503, 'database_unavailable', 'database not configured', true);
      }
      const playback = await meetingVideoPlayback(
        db,
        bucket,
        workspaceId,
        request.params.meetingId,
        {
          now: now(),
          download: request.query.download === '1',
        },
      );
      if (playback === null) throw new NotFoundError('no video yet', 'video_not_ready');
      return reply.header('cache-control', 'private, no-store').send(playback);
    },
  );
};
