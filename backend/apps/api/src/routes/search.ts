import type { FastifyPluginAsync } from 'fastify';
import {
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  SearchQuery,
  type SearchResponse,
} from '@meetyou/contracts';
import { SpellingNormalizer } from '@meetyou/hinglish';
import { sql } from 'kysely';

import { BadRequestError, UnauthorizedError } from '../errors.ts';

/**
 * Search (S3-09, ARCHITECTURE §11.5, DESIGN §11 item 5): Postgres full-text search over the caller's
 * transcript lines, notes and summary items (current notes only), plus titles. Runs inside the
 * caller's workspace (forced RLS). Query words are lowercased, mapped to canonical Hinglish
 * spellings and matched as prefixes; Roman ↔ Devanagari matching is P2 (ML-07).
 */
const normalizer = new SpellingNormalizer();
const MAX_WORDS = 8;
const HITS_PER_MEETING = 3;
const MIN_WORD_LENGTH = 2;

/** `word:* & word:*` from letters and digits only, so the query cannot carry tsquery syntax. */
export function toTsQuery(q: string): string | null {
  const words = normalizer
    .normalize(q.normalize('NFKC'))
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+/gu);
  // One-letter words match nearly everything as a prefix: they are left out.
  const useful = words?.filter((w) => [...w].length >= MIN_WORD_LENGTH) ?? [];
  if (useful.length === 0) return null;
  return useful
    .slice(0, MAX_WORDS)
    .map((w) => `${w}:*`)
    .join(' & ');
}

const HEADLINE = `StartSel=${SEARCH_MARK_START}, StopSel=${SEARCH_MARK_END}, MaxWords=18, MinWords=6, MaxFragments=1`;

/** Result columns arrive camelCased (the database's CamelCasePlugin applies to raw SQL too). */
interface Row {
  kind: 'title' | 'segment' | 'note' | 'summary_item';
  id: string;
  meetingId: string;
  startMs: number | string | null;
  snippet: string;
  rank: number;
}

export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/search',
    {
      preHandler: [
        fastify.requireAuth,
        fastify.rateLimit({ name: 'search', limit: 60, windowMs: 60_000, by: 'workspace' }),
      ],
      schema: { tags: ['search'] },
    },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const parsed = SearchQuery.safeParse(request.query ?? {});
      if (!parsed.success)
        throw new BadRequestError('q must be 1 to 200 characters', 'invalid_query');
      const tsquery = toTsQuery(parsed.data.q);
      if (tsquery === null) return reply.send({ results: [] } satisfies SearchResponse);
      const like = `%${parsed.data.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

      const body = await inWorkspace(async (tx): Promise<SearchResponse> => {
        // Text never leaves the database unmatched: only headline snippets of matching rows.
        // Rank and cut first: ts_headline is the expensive part, so only kept rows get a snippet.
        const rows = await sql<Row>`
        with q as (select to_tsquery('simple', ${tsquery}) as query),
        hits as (
          select 'segment' as kind, s.id, s.meeting_id, s.start_ms, s.text,
                 ts_rank(to_tsvector('simple', s.text), q.query) as rank
            from transcript_segments s
            join meetings lm on lm.id = s.meeting_id and lm.deleted_at is null, q
           where to_tsvector('simple', s.text) @@ q.query
          union all
          select 'note', n.id, n.meeting_id, n.session_ms, n.text,
                 ts_rank(to_tsvector('simple', n.text), q.query) * 1.5
            from notes n
            join meetings lm on lm.id = n.meeting_id and lm.deleted_at is null, q
           where to_tsvector('simple', n.text) @@ q.query
          union all
          select 'summary_item', i.id, i.meeting_id, null, i.text,
                 ts_rank(to_tsvector('simple', i.text), q.query) * 1.2
            from summary_items i
            join summaries su on su.id = i.summary_id and su.accepted
            join meetings lm on lm.id = i.meeting_id and lm.deleted_at is null, q
           where to_tsvector('simple', i.text) @@ q.query
          union all
          select 'title', m.id, m.id, null, m.title, 2.0
            from meetings m
           where m.title ilike ${like} and m.deleted_at is null
          order by rank desc
          limit 300
        )
        select h.kind, h.id, h.meeting_id, h.start_ms, h.rank,
               case when h.kind = 'title' then h.text
                    else ts_headline('simple', h.text, q.query, ${HEADLINE}) end as snippet
          from hits h, q
         order by h.rank desc
      `.execute(tx);

        const meetingIds = [...new Set(rows.rows.map((r) => r.meetingId))];
        if (meetingIds.length === 0) return { results: [] };
        const meetings = await tx
          .selectFrom('meetings')
          .select(['id', 'title', 'startedAt'])
          .where('id', 'in', meetingIds)
          .where('deletedAt', 'is', null)
          .execute();
        const live = new Map(meetings.map((m) => [m.id, m]));
        const byMeeting = new Map<string, Row[]>();
        for (const row of rows.rows) {
          if (!live.has(row.meetingId)) continue;
          const hits = byMeeting.get(row.meetingId) ?? [];
          if (hits.length < HITS_PER_MEETING) hits.push(row);
          byMeeting.set(row.meetingId, hits);
        }
        return {
          results: [...byMeeting.entries()].slice(0, parsed.data.limit).map(([id, hits]) => {
            const m = live.get(id);
            return {
              meeting: {
                id,
                title: m?.title ?? '',
                startedAt: (m?.startedAt ?? new Date(0)).toISOString(),
              },
              hits: hits.map((h) => ({
                kind: h.kind,
                id: h.id,
                startMs: h.startMs === null ? null : Number(h.startMs),
                snippet: h.snippet,
              })),
            };
          }),
        };
      });
      return reply.send(body);
    },
  );
};
