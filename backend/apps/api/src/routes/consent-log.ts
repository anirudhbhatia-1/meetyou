import type { FastifyPluginAsync } from 'fastify';
import { IsoDateTime, newUlid } from '@meetyou/contracts';
import { z } from 'zod';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

const ConsentLogRequest = z.object({
  meetingId: z.string().min(1),
  mode: z.enum(['one_click', 'automatic', 'off']),
  outcome: z.enum(['posted', 'skipped', 'failed']),
  noticeText: z.string().max(2000).optional(),
  sentAt: IsoDateTime.optional(),
});

export const consentLogRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. POST /v1/consent-log (record a consent notice outcome, FR-CON-03)
  fastify.post(
    '/v1/consent-log',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Record an entry in the recording-consent audit log',
        tags: ['consent'],
        body: {
          type: 'object',
          required: ['meetingId', 'mode', 'outcome'],
          properties: {
            meetingId: { type: 'string' },
            mode: { type: 'string', enum: ['one_click', 'automatic', 'off'] },
            outcome: { type: 'string', enum: ['posted', 'skipped', 'failed'] },
            noticeText: { type: 'string' },
            sentAt: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const parseResult = ConsentLogRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(
          parseResult.error.issues[0]?.message ?? 'Invalid consent log body',
        );
      }

      const body = parseResult.data;
      const logId = `clg_${newUlid()}`;
      const sentAtDate = body.sentAt ? new Date(body.sentAt) : new Date();

      const created = await request.inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id'])
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', body.meetingId)
          .executeTakeFirst();

        if (!meeting) return null;

        const row = await tx
          .insertInto('consentLogs')
          .values({
            id: logId,
            workspaceId,
            meetingId: body.meetingId,
            mode: body.mode,
            outcome: body.outcome,
            noticeText: body.noticeText ?? null,
            sentAt: sentAtDate,
          })
          .returningAll()
          .executeTakeFirst();

        return row;
      });

      if (!created) {
        throw new NotFoundError(`Meeting ${body.meetingId} not found`);
      }

      return reply.status(201).send({
        id: created.id,
        meetingId: created.meetingId,
        mode: created.mode,
        outcome: created.outcome,
        noticeText: created.noticeText,
        sentAt: created.sentAt ? new Date(created.sentAt).toISOString() : null,
      });
    },
  );

  // 2. GET /v1/meetings/:id/consent-log
  fastify.get(
    '/v1/meetings/:id/consent-log',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get consent log entries for a meeting',
        tags: ['consent'],
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

      const logs = await request.inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id'])
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!meeting) return null;

        const rows = await tx
          .selectFrom('consentLogs')
          .selectAll()
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .orderBy('createdAt', 'desc')
          .execute();

        return rows;
      });

      if (!logs) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      // ConsentLogResponse (shared/contracts): the web sheet parses `{entries}` with createdAt.
      const entries = logs.map((l) => ({
        id: l.id,
        meetingId: l.meetingId,
        mode: l.mode,
        outcome: l.outcome,
        noticeText: l.noticeText,
        sentAt: l.sentAt ? new Date(l.sentAt).toISOString() : null,
        createdAt: new Date(l.createdAt).toISOString(),
      }));

      return reply.send({ entries });
    },
  );
};
