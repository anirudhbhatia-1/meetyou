import type { FastifyPluginAsync } from 'fastify';
import { Lane } from '@meetyou/contracts';
import { joinLaneAudio } from '@meetyou/pipeline';
import type { ObjectBucket } from '@meetyou/storage';

import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

export interface AudioRoutesOptions {
  /** The recordings bucket; without it audio answers 503. */
  bucket?: ObjectBucket;
}

/** Spans travel in a header next to the bytes; base64url keeps the JSON header-safe. */
export const AUDIO_SPANS_HEADER = 'x-audio-spans';

/**
 * Audio playback for meetings without video (S4-09, DESIGN §12.5–§12.6): one lane's stored Opus
 * chunks joined into an Ogg file without decoding (the batch pass's joiner), plus where each
 * stretch sits on the meeting clock, so "Play from 12:04" lands on the cited line. Owner only
 * (forced RLS); gone once retention deleted the recording.
 */
export const audioRoutes: FastifyPluginAsync<AudioRoutesOptions> = async (fastify, options) => {
  fastify.get(
    '/v1/meetings/:id/audio',
    {
      preHandler: fastify.requireAuth,
      schema: {
        tags: ['meetings'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id: meetingId } = request.params as { id: string };
      const lane = Lane.safeParse((request.query as { lane?: unknown } | undefined)?.lane);
      if (!lane.success) throw new BadRequestError('lane must be me or them', 'invalid_lane');
      const kept = await inWorkspace((tx) =>
        tx
          .selectFrom('audioAssets as a')
          .innerJoin('meetings as m', 'm.id', 'a.meetingId')
          .select('a.id')
          .where('a.meetingId', '=', meetingId)
          .where('a.lane', '=', lane.data)
          .where('m.deletedAt', 'is', null)
          .executeTakeFirst(),
      );
      if (kept === undefined)
        throw new NotFoundError('no audio for this meeting', 'audio_unavailable');
      if (options.bucket === undefined) {
        throw new AppError(503, 'audio_unconfigured', 'audio is not available here', true);
      }
      const audio = await joinLaneAudio(options.bucket, workspaceId, meetingId, lane.data);
      if (audio === null) throw new NotFoundError('no audio for this meeting', 'audio_unavailable');
      return reply
        .header('content-type', 'audio/ogg')
        .header('cache-control', 'private, max-age=300')
        .header(
          AUDIO_SPANS_HEADER,
          Buffer.from(JSON.stringify(audio.timeMap.runs())).toString('base64url'),
        )
        .send(Buffer.from(audio.ogg));
    },
  );
};
