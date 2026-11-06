import type { FastifyPluginAsync } from 'fastify';
import {
  DEFAULT_USER_SETTINGS,
  StartSessionRequest,
  type StartSessionResponse,
  newUlid,
} from '@meetyou/contracts';
import { createMeetingForSession, endMeeting, meetingForSession } from '@meetyou/db';
import type { TokenService } from '@meetyou/auth';

import type { ApiConfig } from '../config.ts';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

export interface SessionsRoutesOptions {
  tokens: TokenService;
  config: ApiConfig;
}

export const sessionsRoutes: FastifyPluginAsync<SessionsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { tokens, config } = options;

  // 1. POST /v1/sessions (Start a recording session, ARCHITECTURE §5.1)
  fastify.post(
    '/v1/sessions',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description:
          'Start a capture session, create meeting record, and issue single-use stream token',
        tags: ['sessions'],
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const parseResult = StartSessionRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(
          parseResult.error.issues[0]?.message ?? 'Invalid session start request',
        );
      }

      const body = parseResult.data;
      const sessionId = `ses_${newUlid()}`;
      const meetingId = `mtg_${newUlid()}`;
      const startedAt = new Date();

      // Check workspace settings for video eligibility (retentionPolicy != immediate)
      const settings = await request.inWorkspace(async (tx) => {
        return tx
          .selectFrom('userSettings')
          .select(['retentionPolicy', 'recordVideo'])
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', request.userId ?? '')
          .executeTakeFirst();
      });

      const retentionPolicy = settings?.retentionPolicy ?? DEFAULT_USER_SETTINGS.retentionPolicy;
      const allowVideo =
        retentionPolicy !== 'immediate' &&
        (settings?.recordVideo ?? DEFAULT_USER_SETTINGS.recordVideo) &&
        body.recordVideo;

      // Create meeting record in DB scoped to workspace (RLS)
      await request.inWorkspace(async (tx) => {
        await createMeetingForSession(tx, {
          id: meetingId,
          workspaceId,
          sessionId,
          externalMeetingCode: body.meetingCode,
          title: body.title,
          startedAt,
        });

        if (allowVideo) {
          // Initialize videoAssets row for the meeting
          await tx
            .insertInto('videoAssets')
            .values({
              id: `vid_${newUlid()}`,
              workspaceId,
              meetingId,
              status: 'uploading',
              mimeType: 'video/webm',
              startMs: 0,
              fragments: 0,
              storageKey: null,
              durationMs: null,
              bytes: null,
              deleteAfter: null,
              partId: null,
            })
            .execute();
        }
      });

      // Issue single-use stream JWT token for connecting to realtime gateway
      const streamToken = await tokens.issueStreamToken({
        sessionId,
        workspaceId,
        lanes: ['me', 'them'],
      });

      const response: StartSessionResponse = {
        sessionId,
        meetingId,
        streamUrl: config.gatewayWsUrl,
        streamToken: streamToken.token,
        expiresAt: streamToken.expiresAt.toISOString(),
        audioFormat: {
          codec: 'opus',
          sampleRate: 16000,
          channels: 1,
          frameMs: 100,
        },
        video: allowVideo
          ? {
              fragmentMs: 10_000,
              maxFragmentBytes: 8 * 1024 * 1024,
              maxWidth: 1920,
              maxHeight: 1080,
              fps: 30,
            }
          : null,
      };

      return reply.status(201).send(response);
    },
  );

  // 2. POST /v1/sessions/:id/end (Mark recording ended)
  fastify.post(
    '/v1/sessions/:id/end',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'End capture session and transition meeting to processing state',
        tags: ['sessions'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      const { id: sessionId } = request.params as { id: string };
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const endedAt = new Date();

      const ended = await request.inWorkspace(async (tx) => {
        const meeting = await meetingForSession(tx, sessionId);
        if (!meeting) return null;

        await endMeeting(tx, meeting.id, endedAt);
        return meeting;
      });

      if (!ended) {
        throw new NotFoundError(`Session ${sessionId} not found`);
      }

      return reply.send({
        status: 'ended',
        sessionId,
        meetingId: ended.id,
        endedAt: endedAt.toISOString(),
      });
    },
  );

  // 3. POST /v1/sessions/:id/recover (Reconnect stream token issue)
  fastify.post(
    '/v1/sessions/:id/recover',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Issue a fresh stream token to resume an in-flight recording session',
        tags: ['sessions'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      const { id: sessionId } = request.params as { id: string };
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const meeting = await request.inWorkspace(async (tx) => {
        return meetingForSession(tx, sessionId);
      });

      if (!meeting) {
        throw new NotFoundError(`Session ${sessionId} not found`);
      }

      if (meeting.endedAt !== null) {
        throw new BadRequestError(`Session ${sessionId} has already ended`);
      }

      const streamToken = await tokens.issueStreamToken({
        sessionId,
        workspaceId,
        lanes: ['me', 'them'],
      });

      return reply.send({
        sessionId,
        meetingId: meeting.id,
        streamUrl: config.gatewayWsUrl,
        streamToken: streamToken.token,
        expiresAt: streamToken.expiresAt.toISOString(),
      });
    },
  );
};
