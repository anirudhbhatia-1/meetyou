import type { FastifyPluginAsync } from 'fastify';
import { Segment, Word, type Segment as SegmentType } from '@meetyou/contracts';
import { z } from 'zod';

import { NotFoundError, UnauthorizedError } from '../errors.ts';

export const segmentsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /v1/meetings/:id/segments
  fastify.get(
    '/v1/meetings/:id/segments',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get all stored transcript segments for a meeting',
        tags: ['transcript'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    workspaceId: { type: 'string' },
                    meetingId: { type: 'string' },
                    lane: { type: 'string' },
                    speakerClusterId: { type: ['string', 'null'] },
                    speakerName: { type: ['string', 'null'] },
                    startMs: { type: 'integer' },
                    endMs: { type: 'integer' },
                    text: { type: 'string' },
                    rawText: { type: 'string' },
                    language: { type: 'string' },
                    source: { type: 'string' },
                    flags: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      const { id } = request.params as { id: string };
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const segments = await request.inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id'])
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .executeTakeFirst();

        if (!meeting) return null;

        const rows = await tx
          .selectFrom('transcriptSegments as s')
          .leftJoin('speakerClusters as sc', 'sc.id', 's.speakerClusterId')
          .leftJoin('participants as p', 'p.id', 'sc.participantId')
          .select([
            's.id',
            's.workspaceId',
            's.meetingId',
            's.lane',
            's.speakerClusterId',
            's.startMs',
            's.endMs',
            's.text',
            's.rawText',
            's.language',
            's.source',
            's.words',
            's.flags',
            'p.displayName as speakerName',
          ])
          .where('s.workspaceId', '=', workspaceId)
          .where('s.meetingId', '=', id)
          .orderBy('s.startMs', 'asc')
          .orderBy('s.id', 'asc')
          .execute();

        return rows;
      });

      if (!segments) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      const items: SegmentType[] = segments.map((s) => {
        let parsedWords: Word[] | undefined = undefined;
        if (s.words) {
          try {
            const raw = typeof s.words === 'string' ? JSON.parse(s.words) : s.words;
            const parsed = z.array(Word).safeParse(raw);
            if (parsed.success) {
              parsedWords = parsed.data;
            }
          } catch {
            parsedWords = undefined;
          }
        }

        return Segment.parse({
          id: s.id,
          workspaceId: s.workspaceId,
          meetingId: s.meetingId,
          lane: s.lane,
          speakerClusterId: s.speakerClusterId ?? undefined,
          speakerName: s.speakerName ?? undefined,
          startMs: Number(s.startMs),
          endMs: Number(s.endMs),
          text: s.text,
          rawText: s.rawText,
          language: s.language,
          source: s.source,
          words: parsedWords,
          flags: s.flags ?? [],
        });
      });

      return reply.send({ items });
    },
  );
};
