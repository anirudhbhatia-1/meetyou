import type { FastifyPluginAsync } from 'fastify';
import { Note, NoteMarker, newUlid, PutNotesRequest } from '@meetyou/contracts';
import { z } from 'zod';

import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../errors.ts';

/** Client note ids are opaque but bounded (`note_<ulid>` from the panel). */
const NoteId = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/);

const CreateNoteRequest = z.object({
  id: NoteId.optional(),
  text: z.string().min(1).max(2000),
  sessionMs: z.number().int().nonnegative(),
  marker: NoteMarker.nullable().optional(),
});

export const notesRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /v1/meetings/:id/notes (list anchor notes for meeting)
  fastify.get(
    '/v1/meetings/:id/notes',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get user live notes for a meeting (summary anchors)',
        tags: ['notes'],
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
              notes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    sessionMs: { type: 'integer' },
                    marker: { type: ['string', 'null'] },
                    text: { type: 'string' },
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

      const notes = await request.inWorkspace(async (tx) => {
        // Verify meeting belongs to workspace
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id'])
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!meeting) return null;

        const rows = await tx
          .selectFrom('notes')
          .select(['id', 'sessionMs', 'marker', 'text'])
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .orderBy('sessionMs', 'asc')
          .orderBy('order', 'asc')
          .execute();

        return rows;
      });

      if (!notes) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      const list: Note[] = notes.map((n) => ({
        id: n.id,
        sessionMs: Number(n.sessionMs),
        marker: n.marker,
        text: n.text,
      }));

      return reply.send({ notes: list });
    },
  );

  // 2. POST /v1/meetings/:id/notes (append a live note)
  fastify.post(
    '/v1/meetings/:id/notes',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Add a live note to a meeting',
        tags: ['notes'],
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

      const parseResult = CreateNoteRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.issues[0]?.message ?? 'Invalid note body');
      }

      const body = parseResult.data;
      const noteId = body.id ?? `not_${newUlid()}`;

      const created = await request.inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id'])
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!meeting) return null;

        const maxOrder = await tx
          .selectFrom('notes')
          .select((eb) => eb.fn.max('order').as('maxOrder'))
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .executeTakeFirst();

        const nextOrder = (maxOrder?.maxOrder ?? 0) + 1;

        const duplicate = await tx
          .selectFrom('notes')
          .select('id')
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', noteId)
          .executeTakeFirst();
        if (duplicate !== undefined) throw new ConflictError('note id already exists');
        const row = await tx
          .insertInto('notes')
          .values({
            id: noteId,
            workspaceId,
            meetingId: id,
            text: body.text,
            sessionMs: body.sessionMs,
            marker: body.marker ?? null,
            order: nextOrder,
          })
          .returningAll()
          .executeTakeFirst();

        return row;
      });

      if (!created) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      const response: Note = {
        id: created.id,
        sessionMs: Number(created.sessionMs),
        marker: created.marker,
        text: created.text,
      };

      return reply.status(201).send(response);
    },
  );

  // 3. PUT /v1/meetings/:id/notes (full sync/replace notes array)
  fastify.put(
    '/v1/meetings/:id/notes',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Bulk update / sync notes for a meeting',
        tags: ['notes'],
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

      const parseResult = PutNotesRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(
          parseResult.error.issues[0]?.message ?? 'Invalid sync notes body',
        );
      }

      const { notes } = parseResult.data;

      const synced = await request.inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id'])
          .where('workspaceId', '=', workspaceId)
          .where('id', '=', id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!meeting) return null;

        // Clear existing notes and re-insert in order
        await tx
          .deleteFrom('notes')
          .where('workspaceId', '=', workspaceId)
          .where('meetingId', '=', id)
          .execute();

        if (notes.length > 0) {
          await tx
            .insertInto('notes')
            .values(
              notes.map((n, idx) => ({
                id: n.id,
                workspaceId,
                meetingId: id,
                text: n.text,
                sessionMs: n.sessionMs,
                marker: n.marker,
                order: idx + 1,
              })),
            )
            .execute();
        }

        return notes;
      });

      if (!synced) {
        throw new NotFoundError(`Meeting ${id} not found`);
      }

      return reply.send({ notes: synced });
    },
  );
};
