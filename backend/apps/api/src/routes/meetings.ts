import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { WorkspaceTx } from '@meetyou/db';
import { cancelMeetingDeletion, scheduleMeetingDeletion } from '@meetyou/queue';
import { type Meeting as MeetingType, TemplateId } from '@meetyou/contracts';
import { z } from 'zod';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';
import { decodeCursor, encodeCursor, parseLimit } from '../utils/pagination.ts';

const UpdateMeetingRequest = z.object({
  // Trimmed so a whitespace-only title cannot blank the row (2026-11-09 audit).
  title: z.string().trim().min(1).max(200).optional(),
  template: TemplateId.optional(),
});

export const meetingsRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /v1/meetings (cursor-paginated meeting list)
  fastify.get(
    '/v1/meetings',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get paginated list of meetings in active workspace',
        tags: ['meetings'],
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer' },
            template: { type: 'string' },
            q: { type: 'string' },
            ids: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const query = request.query as {
        cursor?: string;
        limit?: string | number;
        template?: string;
        q?: string;
        /** Comma-separated meeting ids (≤ 50): the web's search hits, in one request. */
        ids?: string;
      };
      const limit = parseLimit(query.limit);
      const cursorData = decodeCursor(query.cursor);

      const items = await request.inWorkspace(async (tx) => {
        let q = tx
          .selectFrom('meetings')
          .selectAll()
          .where('workspaceId', '=', workspaceId)
          .where('deletedAt', 'is', null);

        if (query.template) {
          const parsedTemplate = TemplateId.safeParse(query.template);
          if (parsedTemplate.success) {
            q = q.where('template', '=', parsedTemplate.data);
          }
        }

        if (query.ids !== undefined) {
          const ids = query.ids
            .split(',')
            .map((id) => id.trim())
            .filter((id) => /^[A-Za-z0-9_]{1,80}$/.test(id))
            .slice(0, 50);
          q = q.where('id', 'in', ids.length > 0 ? ids : ['']);
        }

        // Title and people search for the library list (FR-LIB-02); content search stays in
        // /v1/search. Participant names are not in the search index, so they are matched here
        // and the web no longer downloads every meeting to do it (2026-11-09 audit).
        const needle = query.q?.trim().slice(0, 200);
        if (needle) {
          const like = `%${needle.replace(/[%_\\]/g, '\\$&')}%`;
          q = q.where((eb) =>
            eb.or([
              eb('title', 'ilike', like),
              eb.exists(
                eb
                  .selectFrom('participants')
                  .select('participants.id')
                  .whereRef('participants.meetingId', '=', 'meetings.id')
                  .where('participants.isSelf', '=', false)
                  .where('participants.displayName', 'ilike', like),
              ),
            ]),
          );
        }

        // Apply cursor condition: startedAt <= cursorTimestamp
        if (cursorData && cursorData.createdAtMs !== undefined) {
          const cursorDate = new Date(cursorData.createdAtMs);
          q = q.where((eb) =>
            eb.or([
              eb('startedAt', '<', cursorDate),
              eb.and([eb('startedAt', '=', cursorDate), eb('id', '<', cursorData.id)]),
            ]),
          );
        }

        // Fetch limit + 1 to detect hasNextPage
        const meetings = await q
          .orderBy('startedAt', 'desc')
          .orderBy('id', 'desc')
          .limit(limit + 1)
          .execute();

        return meetings;
      });

      const hasNextPage = items.length > limit;
      const pageItems = hasNextPage ? items.slice(0, limit) : items;

      // Enrich with participants and assets: three queries for the whole page, not per meeting
      // (the per-row version was 3N+1; 2026-11-09 audit).
      const enriched: MeetingType[] = await request.inWorkspace(async (tx) => {
        const ids = pageItems.map((m) => m.id);
        if (ids.length === 0) return [];

        const allParticipants = await tx
          .selectFrom('participants')
          .select(['meetingId', 'displayName'])
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', 'in', ids)
          // The user is not one of "the others": the UI adds "you" itself.
          .where('isSelf', '=', false)
          .execute();
        const videoAssets = await tx
          .selectFrom('videoAssets')
          .select(['meetingId', 'status', 'durationMs', 'deleteAfter'])
          // The meeting's playback row; per-part rows (ADR-0011) carry a partId.
          .where('partId', 'is', null)
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', 'in', ids)
          .execute();
        const audioAssets = await tx
          .selectFrom('audioAssets')
          .select(['meetingId', 'deleteAfter'])
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', 'in', ids)
          .execute();

        const names = new Map<string, string[]>();
        for (const p of allParticipants) {
          names.set(p.meetingId, [...(names.get(p.meetingId) ?? []), p.displayName]);
        }
        const videoBy = new Map(videoAssets.map((v) => [v.meetingId, v]));
        const audioBy = new Map(audioAssets.map((a) => [a.meetingId, a]));

        const result: MeetingType[] = [];
        for (const m of pageItems) {
          const participants = (names.get(m.id) ?? []).map((displayName) => ({ displayName }));
          const videoAsset = videoBy.get(m.id);
          const audioAsset = audioBy.get(m.id);
          const recordingExpires = videoAsset?.deleteAfter ?? audioAsset?.deleteAfter;

          result.push({
            id: m.id,
            platform: m.platform,
            title: m.title,
            startedAt: new Date(m.startedAt).toISOString(),
            endedAt: m.endedAt ? new Date(m.endedAt).toISOString() : null,
            status: m.status,
            processingStep: m.processingStep,
            template: m.template,
            participantNames: participants.map((p) => p.displayName),
            recordingExpiresAt: recordingExpires ? new Date(recordingExpires).toISOString() : null,
            video: videoAsset
              ? {
                  status: videoAsset.status,
                  durationMs: videoAsset.durationMs !== null ? Number(videoAsset.durationMs) : null,
                }
              : null,
          });
        }

        return result;
      });

      const lastItem = pageItems[pageItems.length - 1];
      const nextCursor =
        hasNextPage && lastItem
          ? encodeCursor({
              id: lastItem.id,
              createdAtMs: new Date(lastItem.startedAt).getTime(),
            })
          : null;

      return reply.send({
        items: enriched,
        nextCursor,
      });
    },
  );

  // 2. GET /v1/meetings/:id (single meeting detail)
  fastify.get(
    '/v1/meetings/:id',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get single meeting details by ID',
        tags: ['meetings'],
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
      const { id } = request.params as { id: string };
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const meetingData = await request.inWorkspace(async (tx) => {
        const m = await tx
          .selectFrom('meetings')
          .selectAll()
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!m) return null;

        const participants = await tx
          .selectFrom('participants')
          .select(['displayName'])
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .where('isSelf', '=', false)
          .execute();

        const videoAsset = await tx
          .selectFrom('videoAssets')
          .select(['status', 'durationMs', 'deleteAfter'])
          .where('partId', 'is', null)
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .executeTakeFirst();

        const audioAsset = await tx
          .selectFrom('audioAssets')
          .select(['deleteAfter'])
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .executeTakeFirst();

        return { m, participants, videoAsset, audioAsset };
      });

      if (!meetingData) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      const { m, participants, videoAsset, audioAsset } = meetingData;
      const recordingExpires = videoAsset?.deleteAfter ?? audioAsset?.deleteAfter;

      const response: MeetingType = {
        id: m.id,
        platform: m.platform,
        title: m.title,
        startedAt: new Date(m.startedAt).toISOString(),
        endedAt: m.endedAt ? new Date(m.endedAt).toISOString() : null,
        status: m.status,
        processingStep: m.processingStep,
        template: m.template,
        participantNames: participants.map((p) => p.displayName),
        recordingExpiresAt: recordingExpires ? new Date(recordingExpires).toISOString() : null,
        video: videoAsset
          ? {
              status: videoAsset.status,
              durationMs: videoAsset.durationMs !== null ? Number(videoAsset.durationMs) : null,
            }
          : null,
      };

      return reply.send(response);
    },
  );

  // 3. PATCH /v1/meetings/:id (update meeting metadata)
  fastify.patch(
    '/v1/meetings/:id',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Update meeting title or template',
        tags: ['meetings'],
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
      const { id } = request.params as { id: string };
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const parseResult = UpdateMeetingRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.issues[0]?.message ?? 'Invalid update body');
      }

      const updates = parseResult.data;
      if (Object.keys(updates).length === 0) {
        throw new BadRequestError('No update fields provided');
      }

      const updated = await request.inWorkspace(async (tx) => {
        const m = await tx
          .updateTable('meetings')
          .set({
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.template !== undefined ? { template: updates.template } : {}),
          })
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .returningAll()
          .executeTakeFirst();

        if (!m) return null;

        const participants = await tx
          .selectFrom('participants')
          .select(['displayName'])
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .where('isSelf', '=', false)
          .execute();

        const videoAsset = await tx
          .selectFrom('videoAssets')
          .select(['status', 'durationMs', 'deleteAfter'])
          .where('partId', 'is', null)
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .executeTakeFirst();

        return { m, participants, videoAsset };
      });

      if (!updated) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      const { m, participants, videoAsset } = updated;
      const response: MeetingType = {
        id: m.id,
        platform: m.platform,
        title: m.title,
        startedAt: new Date(m.startedAt).toISOString(),
        endedAt: m.endedAt ? new Date(m.endedAt).toISOString() : null,
        status: m.status,
        processingStep: m.processingStep,
        template: m.template,
        participantNames: participants.map((p) => p.displayName),
        recordingExpiresAt: null,
        video: videoAsset
          ? {
              status: videoAsset.status,
              durationMs: videoAsset.durationMs !== null ? Number(videoAsset.durationMs) : null,
            }
          : null,
      };

      return reply.send(response);
    },
  );

  // 4. DELETE /v1/meetings/:id (soft delete with 10s grace period, ARCHITECTURE §14.3)
  fastify.delete(
    '/v1/meetings/:id',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Soft-delete a meeting (eligible for undo restore within grace window)',
        tags: ['meetings'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        response: {
          204: { type: 'null', description: 'Meeting deleted' },
        },
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      const { id } = request.params as { id: string };
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const scheduled = await request.inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select('id')
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!meeting) return null;

        return scheduleMeetingDeletion(tx, {
          workspaceId,
          meetingId: id,
          graceMs: 10_000,
        });
      });

      if (!scheduled) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      return reply.status(204).send();
    },
  );

  // 5. POST /v1/meetings/:id:restore and /v1/meetings/:id/restore (undo soft delete within grace period)
  const restoreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceId;
    const params = request.params as Record<string, string>;
    const rawId = params['id:restore'] ?? params.id;
    const id = rawId ? rawId.replace(/:restore$/, '') : '';
    if (!workspaceId || !request.inWorkspace || !id) {
      throw new UnauthorizedError('Unauthorized');
    }

    const restored = await request.inWorkspace(async (tx: WorkspaceTx) => {
      return cancelMeetingDeletion(tx, {
        workspaceId,
        meetingId: id,
      });
    });

    if (!restored) {
      throw new NotFoundError(`Meeting ${id} not found`);
    }

    return reply.send({ status: 'restored', id });
  };

  fastify.post(
    '/v1/meetings/:id:restore',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Restore a recently soft-deleted meeting within undo window',
        tags: ['meetings'],
      },
    },
    restoreHandler,
  );

  fastify.post(
    '/v1/meetings/:id/restore',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Restore a recently soft-deleted meeting within undo window',
        tags: ['meetings'],
      },
    },
    restoreHandler,
  );
};
