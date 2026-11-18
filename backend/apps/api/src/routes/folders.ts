import type { FastifyPluginAsync } from 'fastify';
import { FolderRequest, MAX_FOLDERS, newUlid, type Folder } from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import { sql } from 'kysely';

import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../errors.ts';

/**
 * Folders (DESIGN §11.1): personal folders for the library, one per meeting at most. Names are
 * unique per workspace ignoring case (the database index is the final check); deleting a folder
 * unfiles its meetings (`0011`).
 */

async function listFolders(tx: WorkspaceTx): Promise<Folder[]> {
  const rows = await tx
    .selectFrom('folders as f')
    .leftJoin('meetings as m', (join) =>
      join.onRef('m.folderId', '=', 'f.id').on('m.deletedAt', 'is', null),
    )
    .select(['f.id', 'f.name', (eb) => eb.fn.count<string>('m.id').as('meetingCount')])
    .groupBy(['f.id', 'f.name'])
    .orderBy(sql`lower(f.name)`)
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, meetingCount: Number(r.meetingCount) }));
}

async function nameTaken(tx: WorkspaceTx, name: string, exceptId?: string): Promise<boolean> {
  let q = tx
    .selectFrom('folders')
    .select('id')
    .where(sql<boolean>`lower(name) = lower(${name})`);
  if (exceptId !== undefined) q = q.where('id', '<>', exceptId);
  return (await q.executeTakeFirst()) !== undefined;
}

const exists = () => new ConflictError('A folder with this name already exists.', 'folder_exists');

/** The unique index catches a race between two creates with the same name. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const folderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/folders',
    { preHandler: fastify.requireAuth, schema: { tags: ['folders'] } },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      return reply.send({ folders: await inWorkspace(listFolders) });
    },
  );

  fastify.post(
    '/v1/folders',
    { preHandler: fastify.requireAuth, schema: { tags: ['folders'] } },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = request;
      if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const body = FolderRequest.safeParse(request.body);
      if (!body.success) throw new BadRequestError('Use 1–60 characters.', 'invalid_folder');
      const name = body.data.name;
      try {
        const folder = await inWorkspace(async (tx) => {
          // Serialized per workspace, so the count and the name check hold until the insert.
          await sql`select pg_advisory_xact_lock(hashtext(${`folders:${workspaceId}`}))`.execute(
            tx,
          );
          const count = await tx
            .selectFrom('folders')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .executeTakeFirstOrThrow();
          if (Number(count.n) >= MAX_FOLDERS) {
            throw new AppError(
              422,
              'too_many_folders',
              `You can have up to ${MAX_FOLDERS} folders.`,
            );
          }
          if (await nameTaken(tx, name)) throw exists();
          const id = `fld_${newUlid()}`;
          await tx
            .insertInto('folders')
            .values({ id, workspaceId, name, createdBy: userId })
            .execute();
          return { id, name, meetingCount: 0 } satisfies Folder;
        });
        return reply.status(201).send(folder);
      } catch (error) {
        if (isUniqueViolation(error)) throw exists();
        throw error;
      }
    },
  );

  fastify.patch(
    '/v1/folders/:id',
    { preHandler: fastify.requireAuth, schema: { tags: ['folders'] } },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id } = request.params as { id: string };
      const body = FolderRequest.safeParse(request.body);
      if (!body.success) throw new BadRequestError('Use 1–60 characters.', 'invalid_folder');
      const name = body.data.name;
      try {
        const folder = await inWorkspace(async (tx) => {
          if (await nameTaken(tx, name, id)) throw exists();
          const row = await tx
            .updateTable('folders')
            .set({ name })
            .where('id', '=', id)
            .returning('id')
            .executeTakeFirst();
          if (row === undefined) return null;
          return (await listFolders(tx)).find((f) => f.id === id) ?? null;
        });
        if (folder === null) throw new NotFoundError('Folder not found');
        return reply.send(folder);
      } catch (error) {
        if (isUniqueViolation(error)) throw exists();
        throw error;
      }
    },
  );

  fastify.delete(
    '/v1/folders/:id',
    { preHandler: fastify.requireAuth, schema: { tags: ['folders'] } },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id } = request.params as { id: string };
      const deleted = await inWorkspace((tx) =>
        tx.deleteFrom('folders').where('id', '=', id).returning('id').executeTakeFirst(),
      );
      if (deleted === undefined) throw new NotFoundError('Folder not found');
      return reply.status(204).send();
    },
  );
};
