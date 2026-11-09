import type { FastifyPluginAsync } from 'fastify';
import { newUlid, type ExportView } from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import { exportJob } from '@meetyou/pipeline';
import { enqueue } from '@meetyou/queue';
import { sql } from 'kysely';

import { NotFoundError, UnauthorizedError } from '../errors.ts';

/** A signed, short-lived download link for an export file (Cloud Storage V4 in the app). */
export type SignExportDownload = (storageKey: string, fileName: string) => Promise<string>;

export interface ExportRoutesOptions {
  /** Without a signer (no bucket configured) ready exports carry no link. */
  signDownload?: SignExportDownload;
}

/** An export still preparing after this long is reported failed: the job gave up or was lost. */
const STALE_MS = 30 * 60 * 1000;
/** A new request this soon after a finished export returns that one instead of building again. */
const REUSE_MS = 10 * 60 * 1000;

type Row = {
  id: string;
  status: ExportView['status'];
  storageKey: string | null;
  sizeBytes: number | null;
  meetingCount: number | null;
  readyAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

const latest = (tx: WorkspaceTx, userId: string) =>
  tx
    .selectFrom('exports')
    .select([
      'id',
      'status',
      'storageKey',
      'sizeBytes',
      'meetingCount',
      'readyAt',
      'expiresAt',
      'createdAt',
    ])
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst();

/**
 * "Download all my data" (S3-11, FR-SET-04, DESIGN §13.2): POST starts the `account.export` job in
 * the same transaction as the row (outbox, ADR-0005); GET reports progress and, once ready, a
 * fresh signed link. The file itself is kept 24 hours.
 */
export const exportRoutes: FastifyPluginAsync<ExportRoutesOptions> = async (fastify, options) => {
  const view = async (row: Row, now: number): Promise<ExportView> => {
    let status = row.status;
    if (status === 'preparing' && now - row.createdAt.getTime() > STALE_MS) status = 'failed';
    if (status === 'ready' && (row.expiresAt?.getTime() ?? 0) <= now) status = 'expired';
    const downloadUrl =
      status === 'ready' && row.storageKey !== null && options.signDownload !== undefined
        ? await options.signDownload(
            row.storageKey,
            `minutes-export-${row.createdAt.toISOString().slice(0, 10)}.zip`,
          )
        : null;
    return {
      id: row.id,
      status,
      createdAt: row.createdAt.toISOString(),
      readyAt: row.readyAt?.toISOString() ?? null,
      expiresAt: status === 'ready' ? (row.expiresAt?.toISOString() ?? null) : null,
      sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
      meetingCount: row.meetingCount,
      downloadUrl,
    };
  };

  fastify.post(
    '/v1/exports',
    { preHandler: fastify.requireAuth, schema: { tags: ['exports'] } },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = request;
      if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const now = Date.now();
      const row = await inWorkspace(async (tx): Promise<Row> => {
        // Two clicks or two tabs at once: one request per user at a time, so one export.
        await sql`select pg_advisory_xact_lock(hashtext(${`export:${userId}`}))`.execute(tx);
        const last = await latest(tx, userId);
        const age = last === undefined ? Infinity : now - last.createdAt.getTime();
        if (last?.status === 'preparing' && age <= STALE_MS) return last;
        if (last?.status === 'ready' && age <= REUSE_MS) return last;
        const id = `exp_${newUlid()}`;
        await tx.insertInto('exports').values({ id, workspaceId, userId }).execute();
        await enqueue(
          tx,
          exportJob,
          { workspaceId, userId, exportId: id },
          { jobKey: `${exportJob.name}:${id}` },
        );
        const created = await latest(tx, userId);
        if (created === undefined) throw new Error('export row missing');
        return created;
      });
      return reply.code(202).send({ export: await view(row, now) });
    },
  );

  fastify.get(
    '/v1/exports',
    { preHandler: fastify.requireAuth, schema: { tags: ['exports'] } },
    async (request, reply) => {
      const { userId, inWorkspace } = request;
      if (!userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const row = await inWorkspace((tx) => latest(tx, userId));
      return reply.send({ latest: row === undefined ? null : await view(row, Date.now()) });
    },
  );

  fastify.get(
    '/v1/exports/:id',
    {
      preHandler: [
        fastify.requireAuth,
        fastify.rateLimit({ name: 'exports', limit: 5, windowMs: 60 * 60_000, by: 'workspace' }),
      ],
      schema: {
        tags: ['exports'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },
    async (request, reply) => {
      const { userId, inWorkspace } = request;
      if (!userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id } = request.params as { id: string };
      const row = await inWorkspace((tx) =>
        tx
          .selectFrom('exports')
          .select([
            'id',
            'status',
            'storageKey',
            'sizeBytes',
            'meetingCount',
            'readyAt',
            'expiresAt',
            'createdAt',
          ])
          .where('id', '=', id)
          .where('userId', '=', userId)
          .executeTakeFirst(),
      );
      if (row === undefined) throw new NotFoundError('export not found');
      return reply.send({ export: await view(row, Date.now()) });
    },
  );
};
