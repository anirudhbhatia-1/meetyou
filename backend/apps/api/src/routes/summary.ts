import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  FeedbackRequest,
  ListActionItemsQuery,
  newUlid,
  PatchSummaryItemRequest,
  RegenerateSummaryRequest,
  SummaryVersionRequest,
  type ActionItem,
  type MeetingProgress,
  type MeetingSummaryResponse,
  type SummaryItem,
  type SummaryVersion,
} from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import { summarizeJob, summarizeJobKey } from '@meetyou/pipeline';
import { enqueue } from '@meetyou/queue';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';
import { decodeCursor, encodeCursor } from '../utils/pagination.ts';

/**
 * Summary endpoints (S3-08, ARCHITECTURE §12.1, DESIGN §12 and §14) and the processing progress
 * stream (S3-03). Every read and write runs in the caller's workspace (forced RLS), so items,
 * owners and citations of other users are never reachable.
 */

function scope(request: FastifyRequest) {
  const { workspaceId, userId, inWorkspace } = request;
  if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
  return { workspaceId, userId, inWorkspace };
}

const idParams = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

type ItemRow = {
  id: string;
  kind: SummaryItem['kind'];
  text: string;
  anchorNoteId: string | null;
  ownerParticipantId: string | null;
  dueDate: string | Date | null;
  duePhrase: string | null;
  status: 'open' | 'done' | null;
  userEdited: boolean;
  flagged: boolean;
};

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/** Items with their citations, in display order. */
async function itemsOf(tx: WorkspaceTx, summaryIds: string[]): Promise<Map<string, SummaryItem[]>> {
  const result = new Map<string, SummaryItem[]>(summaryIds.map((id) => [id, []]));
  if (summaryIds.length === 0) return result;
  const rows = await tx
    .selectFrom('summaryItems')
    .select([
      'id',
      'summaryId',
      'kind',
      'text',
      'anchorNoteId',
      'ownerParticipantId',
      'dueDate',
      'duePhrase',
      'status',
      'userEdited',
      'flagged',
    ])
    .where('summaryId', 'in', summaryIds)
    .orderBy('order', 'asc')
    .execute();
  const cites = rows.length
    ? await tx
        .selectFrom('citations as c')
        .innerJoin('transcriptSegments as s', 's.id', 'c.segmentId')
        .select(['c.summaryItemId', 'c.segmentId', 's.startMs'])
        .where(
          'c.summaryItemId',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('s.startMs', 'asc')
        .execute()
    : [];
  const byItem = new Map<string, string[]>();
  for (const c of cites)
    byItem.set(c.summaryItemId, [...(byItem.get(c.summaryItemId) ?? []), c.segmentId]);
  for (const r of rows) {
    result.get(r.summaryId)?.push(toItem(r as ItemRow, byItem.get(r.id) ?? []));
  }
  return result;
}

function toItem(r: ItemRow, segmentIds: string[]): SummaryItem {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    anchorNoteId: r.anchorNoteId,
    ownerParticipantId: r.ownerParticipantId,
    dueDate: dateOnly(r.dueDate),
    duePhrase: r.duePhrase,
    status: r.status,
    segmentIds,
    userEdited: r.userEdited,
    flagged: r.flagged,
  };
}

async function meetingExists(tx: WorkspaceTx, meetingId: string): Promise<boolean> {
  const row = await tx
    .selectFrom('meetings')
    .select('id')
    .where('id', '=', meetingId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

const SETTLED: ReadonlySet<string> = new Set(['ready', 'updated', 'failed', 'too_short']);
/** Cloud Run's request timeout is 60 s: end before it; EventSource-style clients reconnect. */
const STREAM_MS = 55_000;
const POLL_MS = 1_500;

export const summaryRoutes: FastifyPluginAsync<{ pollMs?: number; streamMs?: number }> = async (
  fastify,
  options,
) => {
  // GET /v1/meetings/{id}/summary
  fastify.get(
    '/v1/meetings/:id/summary',
    { preHandler: fastify.requireAuth, schema: { tags: ['summary'], params: idParams } },
    async (request, reply) => {
      const { inWorkspace } = scope(request);
      const { id: meetingId } = request.params as { id: string };
      const body = await inWorkspace(async (tx): Promise<MeetingSummaryResponse | null> => {
        if (!(await meetingExists(tx, meetingId))) return null;
        const versions = await tx
          .selectFrom('summaries')
          .select([
            'id',
            'version',
            'template',
            'language',
            'model',
            'overview',
            'status',
            'accepted',
            'createdAt',
          ])
          .where('meetingId', '=', meetingId)
          .orderBy('version', 'desc')
          .execute();
        const current = versions.find((v) => v.accepted && v.status === 'ready') ?? null;
        const candidate =
          versions.find(
            (v) =>
              !v.accepted &&
              v.status === 'ready' &&
              (current === null || v.version > current.version),
          ) ?? null;
        const items = await itemsOf(
          tx,
          [current?.id, candidate?.id].filter((x): x is string => x !== undefined),
        );
        const toVersion = (v: (typeof versions)[number]): SummaryVersion => ({
          id: v.id,
          version: v.version,
          template: v.template,
          language: v.language,
          model: v.model,
          overview: v.overview ?? '',
          createdAt: v.createdAt.toISOString(),
          items: items.get(v.id) ?? [],
        });
        const [participants, notes] = await Promise.all([
          tx
            .selectFrom('participants')
            .select(['id', 'displayName', 'isSelf'])
            .where('meetingId', '=', meetingId)
            .orderBy('isSelf', 'desc')
            .execute(),
          tx
            .selectFrom('notes')
            .select(['id', 'sessionMs', 'marker', 'text'])
            .where('meetingId', '=', meetingId)
            .orderBy('order', 'asc')
            .execute(),
        ]);
        return {
          current: current === null ? null : toVersion(current),
          candidate: candidate === null ? null : toVersion(candidate),
          failed: current === null && versions[0]?.status === 'failed',
          participants,
          notes: notes.map((n) => ({ ...n, sessionMs: Number(n.sessionMs) })),
        };
      });
      if (body === null) throw new NotFoundError(`Meeting ${meetingId} not found`);
      return reply.send(body);
    },
  );

  // POST /v1/meetings/{id}/summary:regenerate (FR-SUM-07): a candidate version, kept or not later.
  fastify.post(
    '/v1/meetings/:id/summary::regenerate',
    { preHandler: fastify.requireAuth, schema: { tags: ['summary'], params: idParams } },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = scope(request);
      const { id: meetingId } = request.params as { id: string };
      const body = RegenerateSummaryRequest.safeParse(request.body ?? {});
      if (!body.success) throw new BadRequestError('unknown template', 'invalid_template');
      const ok = await inWorkspace(async (tx) => {
        if (!(await meetingExists(tx, meetingId))) return false;
        await enqueue(
          tx,
          summarizeJob,
          {
            workspaceId,
            meetingId,
            reason: 'regenerate',
            ...(body.data.template !== undefined ? { template: body.data.template } : {}),
          },
          { jobKey: summarizeJobKey(meetingId, 'regenerate') },
        );
        return true;
      });
      if (!ok) throw new NotFoundError(`Meeting ${meetingId} not found`);
      return reply.status(202).send({ accepted: true });
    },
  );

  // POST /v1/meetings/{id}/summary:keep — the candidate becomes the notes the user reads.
  // POST /v1/meetings/{id}/summary:discard — "Go back": the candidate is removed.
  for (const action of ['keep', 'discard'] as const) {
    fastify.post(
      `/v1/meetings/:id/summary::${action}`,
      { preHandler: fastify.requireAuth, schema: { tags: ['summary'], params: idParams } },
      async (request, reply) => {
        const { inWorkspace } = scope(request);
        const { id: meetingId } = request.params as { id: string };
        const body = SummaryVersionRequest.safeParse(request.body);
        if (!body.success) throw new BadRequestError('version required', 'invalid_version');
        const done = await inWorkspace(async (tx) => {
          const target = await tx
            .selectFrom('summaries')
            .select(['id', 'status'])
            .where('meetingId', '=', meetingId)
            .where('version', '=', body.data.version)
            .where('accepted', '=', false)
            .executeTakeFirst();
          if (target === undefined || target.status !== 'ready') return false;
          if (action === 'discard') {
            await tx.deleteFrom('summaries').where('id', '=', target.id).execute();
            return true;
          }
          await tx
            .updateTable('summaries')
            .set({ accepted: false })
            .where('meetingId', '=', meetingId)
            .execute();
          await tx
            .updateTable('summaries')
            .set({ accepted: true })
            .where('id', '=', target.id)
            .execute();
          return true;
        });
        if (!done) throw new NotFoundError('No such candidate version');
        return reply.status(204).send();
      },
    );
  }

  // PATCH /v1/summary-items/{id}: text, owner (participants only), due date, done/open.
  fastify.patch(
    '/v1/summary-items/:id',
    { preHandler: fastify.requireAuth, schema: { tags: ['summary'], params: idParams } },
    async (request, reply) => {
      const { inWorkspace } = scope(request);
      const { id: itemId } = request.params as { id: string };
      const body = PatchSummaryItemRequest.safeParse(request.body);
      if (!body.success) throw new BadRequestError('invalid change', 'invalid_item_change');
      const patch = body.data;
      const item = await inWorkspace(async (tx) => {
        const row = await tx
          .selectFrom('summaryItems')
          .select(['id', 'meetingId', 'kind'])
          .where('id', '=', itemId)
          .executeTakeFirst();
        if (row === undefined) return null;
        if (patch.status !== undefined && row.kind !== 'action_item') {
          throw new BadRequestError('only action items have a status', 'not_an_action_item');
        }
        if (patch.ownerParticipantId !== undefined && patch.ownerParticipantId !== null) {
          // AGENTS §3 rule 7: owners come from the meeting's own participant list.
          const owner = await tx
            .selectFrom('participants')
            .select('id')
            .where('id', '=', patch.ownerParticipantId)
            .where('meetingId', '=', row.meetingId)
            .executeTakeFirst();
          if (owner === undefined)
            throw new BadRequestError('owner is not a participant', 'invalid_owner');
        }
        await tx
          .updateTable('summaryItems')
          .set({
            ...(patch.text !== undefined ? { text: patch.text, userEdited: true } : {}),
            ...(patch.ownerParticipantId !== undefined
              ? { ownerParticipantId: patch.ownerParticipantId, userEdited: true }
              : {}),
            ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate, userEdited: true } : {}),
            ...(patch.status !== undefined
              ? { status: patch.status, completedAt: patch.status === 'done' ? new Date() : null }
              : {}),
          })
          .where('id', '=', itemId)
          .execute();
        const updated = await tx
          .selectFrom('summaryItems')
          .select([
            'id',
            'kind',
            'text',
            'anchorNoteId',
            'ownerParticipantId',
            'dueDate',
            'duePhrase',
            'status',
            'userEdited',
            'flagged',
          ])
          .where('id', '=', itemId)
          .executeTakeFirstOrThrow();
        const cites = await tx
          .selectFrom('citations')
          .select('segmentId')
          .where('summaryItemId', '=', itemId)
          .execute();
        return toItem(
          updated as ItemRow,
          cites.map((c) => c.segmentId),
        );
      });
      if (item === null) throw new NotFoundError(`Item ${itemId} not found`);
      return reply.send(item);
    },
  );

  // POST /v1/feedback (FR-SUM-09)
  fastify.post(
    '/v1/feedback',
    { preHandler: fastify.requireAuth, schema: { tags: ['summary'] } },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = scope(request);
      const body = FeedbackRequest.safeParse(request.body);
      if (!body.success) throw new BadRequestError('invalid feedback', 'invalid_feedback');
      const ok = await inWorkspace(async (tx) => {
        const table = body.data.targetType === 'summary' ? 'summaries' : 'summaryItems';
        const target = await tx
          .selectFrom(table)
          .select('id')
          .where('id', '=', body.data.targetId)
          .executeTakeFirst();
        if (target === undefined) return false;
        await tx
          .insertInto('feedback')
          .values({
            id: `fbk_${newUlid()}`,
            workspaceId,
            targetType: body.data.targetType,
            targetId: body.data.targetId,
            rating: body.data.rating,
            comment: body.data.comment ?? null,
          })
          .execute();
        return true;
      });
      if (!ok) throw new NotFoundError('Feedback target not found');
      return reply.status(201).send({ accepted: true });
    },
  );

  // GET /v1/action-items (DESIGN §14): action items of the notes the user reads, across meetings.
  fastify.get(
    '/v1/action-items',
    { preHandler: fastify.requireAuth, schema: { tags: ['summary'] } },
    async (request, reply) => {
      const { inWorkspace } = scope(request);
      const query = ListActionItemsQuery.safeParse(request.query ?? {});
      if (!query.success) throw new BadRequestError('invalid query', 'invalid_query');
      const { status, owner, limit } = query.data;
      const cursor = decodeCursor(query.data.cursor);
      const page = await inWorkspace(async (tx) => {
        let q = tx
          .selectFrom('summaryItems as i')
          .innerJoin('summaries as s', 's.id', 'i.summaryId')
          .innerJoin('meetings as m', 'm.id', 'i.meetingId')
          .leftJoin('participants as p', 'p.id', 'i.ownerParticipantId')
          .select([
            'i.id',
            'i.kind',
            'i.text',
            'i.anchorNoteId',
            'i.ownerParticipantId',
            'i.dueDate',
            'i.duePhrase',
            'i.status',
            'i.userEdited',
            'i.flagged',
            'i.createdAt',
            'm.id as meetingId',
            'm.title as meetingTitle',
            'm.startedAt as meetingStartedAt',
            'p.displayName as ownerName',
            'p.isSelf as ownerIsSelf',
          ])
          .where('i.kind', '=', 'action_item')
          .where('s.accepted', '=', true)
          .where('m.deletedAt', 'is', null);
        if (status !== 'all') q = q.where('i.status', '=', status);
        if (owner === 'me') q = q.where('p.isSelf', '=', true);
        if (cursor?.createdAtMs !== undefined) {
          const at = new Date(cursor.createdAtMs);
          q = q.where((eb) =>
            eb.or([
              eb('i.createdAt', '<', at),
              eb.and([eb('i.createdAt', '=', at), eb('i.id', '<', cursor.id)]),
            ]),
          );
        }
        const rows = await q
          .orderBy('i.createdAt', 'desc')
          .orderBy('i.id', 'desc')
          .limit(limit + 1)
          .execute();
        const pageRows = rows.slice(0, limit);
        const cites = pageRows.length
          ? await tx
              .selectFrom('citations')
              .select(['summaryItemId', 'segmentId'])
              .where(
                'summaryItemId',
                'in',
                pageRows.map((r) => r.id),
              )
              .execute()
          : [];
        const items: ActionItem[] = pageRows.map((r) => ({
          ...toItem(
            r as ItemRow,
            cites.filter((c) => c.summaryItemId === r.id).map((c) => c.segmentId),
          ),
          meetingId: r.meetingId,
          meetingTitle: r.meetingTitle,
          meetingStartedAt: r.meetingStartedAt.toISOString(),
          ownerName: r.ownerName ?? null,
        ownerIsSelf: r.ownerIsSelf === true,
        }));
        const last = pageRows.at(-1);
        return {
          items,
          nextCursor:
            rows.length > limit && last !== undefined
              ? encodeCursor({ id: last.id, createdAtMs: last.createdAt.getTime() })
              : null,
        };
      });
      return reply.send(page);
    },
  );

  // GET /v1/meetings/{id}/events (S3-03): server-sent `progress` events until the notes are ready.
  fastify.get(
    '/v1/meetings/:id/events',
    { preHandler: fastify.requireAuth, schema: { tags: ['summary'], params: idParams } },
    async (request, reply) => {
      const { inWorkspace } = scope(request);
      const { id: meetingId } = request.params as { id: string };
      const read = () =>
        inWorkspace((tx) =>
          tx
            .selectFrom('meetings')
            .select(['status', 'processingStep'])
            .where('id', '=', meetingId)
            .where('deletedAt', 'is', null)
            .executeTakeFirst(),
        );
      const first = await read();
      if (first === undefined) throw new NotFoundError(`Meeting ${meetingId} not found`);

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      let last = '';
      const send = (row: { status: string; processingStep: string | null }) => {
        const progress = {
          status: row.status,
          processingStep: row.processingStep,
        } as MeetingProgress;
        const json = JSON.stringify(progress);
        if (json === last) return;
        last = json;
        res.write(`event: progress\ndata: ${json}\n\n`);
      };
      send(first);
      const until = Date.now() + (options.streamMs ?? STREAM_MS);
      let closed = false;
      request.raw.on('close', () => {
        closed = true;
      });
      try {
        let row: { status: string; processingStep: string | null } | undefined = first;
        while (!closed && row !== undefined && !SETTLED.has(row.status) && Date.now() < until) {
          await new Promise((r) => setTimeout(r, options.pollMs ?? POLL_MS));
          row = await read();
          if (row !== undefined) send(row);
        }
      } catch {
        // The client reconnects; the stream carries no error details.
      }
      res.end();
    },
  );
};
