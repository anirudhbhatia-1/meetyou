import type { FastifyPluginAsync } from 'fastify';
import {
  ASK_LIMITS,
  AskQuestionRequest,
  newUlid,
  type AskUsage,
  type MeetingQuestion,
  type QuestionStatus,
} from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import { LlmHttpError, type LlmProvider } from '@meetyou/providers';
import { answerQuestion, GenerationFailedError, summarySegments } from '@meetyou/summarizer';
import { recordSpan } from '@meetyou/tracing';

import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

/**
 * "Ask this meeting" (FEATURES E4, Phase 1 since 2026-11-07, AGENTS §9). Guardrails against misuse:
 * - one recording, its owner only: every read runs in the caller's workspace (forced RLS), so
 *   another user's meeting is simply not found;
 * - the model sees only this recording and classifies the question first; off-topic questions get
 *   a fixed refusal text in the UI, never model-written text;
 * - answers must cite this meeting's own segments, or they are downgraded to "not in meeting";
 * - 500 characters per question, 30 per hour and 150 per 24 hours per user (rows counted here;
 *   two requests racing at the limit can pass together, which is acceptable for cost control);
 * - token use is stored per question (AGENTS §3 rule 10). Question and answer never reach logs.
 */
export interface AskRoutesOptions {
  llm: LlmProvider | null;
  now?: () => number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

class TooManyQuestionsError extends AppError {
  constructor() {
    super(429, 'rate_limited', 'question limit reached; try again later', true);
  }
}

async function usageFor(tx: WorkspaceTx, userId: string, now: number): Promise<AskUsage> {
  const row = await tx
    .selectFrom('meetingQuestions')
    .select((eb) => [
      eb.fn
        .count<number>('id')
        .filterWhere('createdAt', '>=', new Date(now - HOUR_MS))
        .as('hour'),
      eb.fn.count<number>('id').as('day'),
    ])
    .where('userId', '=', userId)
    .where('createdAt', '>=', new Date(now - DAY_MS))
    .executeTakeFirst();
  return {
    usedLastHour: Number(row?.hour ?? 0),
    usedLastDay: Number(row?.day ?? 0),
    perHour: ASK_LIMITS.perHour,
    perDay: ASK_LIMITS.perDay,
  };
}

function toQuestion(
  row: {
    id: string;
    question: string;
    status: QuestionStatus;
    answer: string | null;
    segmentIds: string[];
    createdAt: Date;
  },
  startOf: Map<string, number>,
): MeetingQuestion {
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    answer: row.answer,
    citations: row.segmentIds
      .filter((id) => startOf.has(id))
      .map((id) => ({ segmentId: id, startMs: startOf.get(id) ?? 0 }))
      .sort((a, b) => a.startMs - b.startMs),
    createdAt: row.createdAt.toISOString(),
  };
}

export const askRoutes: FastifyPluginAsync<AskRoutesOptions> = async (fastify, options) => {
  const now = options.now ?? Date.now;
  const params = {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  } as const;

  fastify.post(
    '/v1/meetings/:id/ask',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Ask a question about one of your recordings (answered from it only)',
        tags: ['ask'],
        params,
      },
    },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = request;
      if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id: meetingId } = request.params as { id: string };
      const body = AskQuestionRequest.safeParse(request.body);
      if (!body.success) {
        throw new BadRequestError(
          `question must be 1 to ${ASK_LIMITS.questionChars} characters`,
          'invalid_question',
        );
      }
      if (options.llm === null) {
        throw new AppError(503, 'answers_unavailable', 'answers are not enabled', false);
      }
      const llm = options.llm;
      const startedAt = now();

      // Reads in one short transaction; the model call happens outside it.
      const data = await inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['id', 'title', 'startedAt', 'endedAt'])
          .where('id', '=', meetingId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();
        if (meeting === undefined) return null;
        const usage = await usageFor(tx, userId, startedAt);
        if (usage.usedLastHour >= usage.perHour || usage.usedLastDay >= usage.perDay) {
          return { limited: true as const };
        }
        const [segments, notes, participants] = await Promise.all([
          tx
            .selectFrom('transcriptSegments as s')
            .leftJoin('speakerClusters as sc', 'sc.id', 's.speakerClusterId')
            .leftJoin('participants as p', 'p.id', 'sc.participantId')
            .select([
              's.id',
              's.lane',
              's.speakerClusterId',
              's.startMs',
              's.endMs',
              's.text',
              's.flags',
              'p.displayName as speakerName',
            ])
            .where('s.meetingId', '=', meetingId)
            .orderBy('s.startMs', 'asc')
            .orderBy('s.id', 'asc')
            .execute(),
          tx
            .selectFrom('notes')
            .select(['id', 'sessionMs', 'marker', 'text'])
            .where('meetingId', '=', meetingId)
            .orderBy('order', 'asc')
            .execute(),
          tx
            .selectFrom('participants')
            .select(['id', 'displayName', 'isSelf'])
            .where('meetingId', '=', meetingId)
            .execute(),
        ]);
        return { limited: false as const, meeting, usage, segments, notes, participants };
      });
      if (data === null) throw new NotFoundError(`Meeting ${meetingId} not found`);
      if (data.limited) throw new TooManyQuestionsError();

      const selfName = data.participants.find((p) => p.isSelf)?.displayName ?? 'You';
      const segments = summarySegments(
        data.segments.map((s) => ({
          id: s.id,
          workspaceId,
          meetingId,
          lane: s.lane,
          ...(s.speakerClusterId !== null ? { speakerClusterId: s.speakerClusterId } : {}),
          ...(s.speakerName !== null ? { speakerName: s.speakerName } : {}),
          startMs: Number(s.startMs),
          endMs: Number(s.endMs),
          text: s.text,
          rawText: s.text,
          language: 'und',
          source: 'live' as const,
          flags: (s.flags ?? []) as ('echo' | 'low_confidence')[],
        })),
        selfName,
      );
      const endedAt = data.meeting.endedAt ?? data.meeting.startedAt;

      let run;
      try {
        run = await answerQuestion(
          {
            meeting: {
              title: data.meeting.title === '' ? null : data.meeting.title,
              date: data.meeting.startedAt.toISOString().slice(0, 10),
              durationMs: Math.max(0, endedAt.getTime() - data.meeting.startedAt.getTime()),
            },
            participants: data.participants.map((p) => ({
              id: p.id,
              name: p.displayName,
              isSelf: p.isSelf,
            })),
            notes: data.notes.map((n) => ({
              id: n.id,
              sessionMs: Number(n.sessionMs),
              marker: n.marker,
              text: n.text,
            })),
            segments,
          },
          body.data.question,
          llm,
        );
      } catch (error) {
        recordSpan('meeting.ask', meetingId, { status: 'failed' }, startedAt, now(), error);
        if (error instanceof GenerationFailedError) {
          if (error.reason === 'no_transcript') {
            throw new AppError(409, 'no_transcript', 'this recording has no transcript yet', false);
          }
          if (error.reason === 'too_long') {
            throw new AppError(
              413,
              'recording_too_long',
              'this recording is too long to ask',
              false,
            );
          }
          throw new AppError(502, 'answer_failed', 'no answer could be produced', true);
        }
        if (error instanceof LlmHttpError) {
          throw new AppError(
            503,
            'answers_unavailable',
            'answers are unavailable',
            error.retryable,
          );
        }
        throw error;
      }

      // Citations must be this meeting's own, non-echo segments (AGENTS §3 rule 7).
      const visible = new Map(segments.filter((s) => !s.echo).map((s) => [s.id, s.startMs]));
      const cited = [...new Set(run.output.segment_ids)].filter((id) => visible.has(id));
      let status: QuestionStatus = 'answered';
      if (!run.output.about_this_meeting) status = 'off_topic';
      else if (!run.output.found || cited.length === 0 || run.output.answer.trim() === '') {
        status = 'not_in_meeting';
      }

      const row = await inWorkspace((tx) =>
        tx
          .insertInto('meetingQuestions')
          .values({
            id: `qst_${newUlid()}`,
            workspaceId,
            meetingId,
            userId,
            question: body.data.question,
            status,
            answer: status === 'answered' ? run.output.answer.trim() : null,
            segmentIds: status === 'answered' ? cited : [],
            model: run.model,
            inputTokens: run.usage.inputTokens,
            outputTokens: run.usage.outputTokens,
            thinkingTokens: run.usage.thinkingTokens,
          })
          .returning(['id', 'question', 'status', 'answer', 'segmentIds', 'createdAt'])
          .executeTakeFirstOrThrow(),
      );
      recordSpan(
        'meeting.ask',
        meetingId,
        { status, count: run.llmCalls, inputTokenCount: run.usage.inputTokens },
        startedAt,
      );
      return reply.send({
        question: toQuestion(row, visible),
        usage: {
          ...data.usage,
          usedLastHour: data.usage.usedLastHour + 1,
          usedLastDay: data.usage.usedLastDay + 1,
        },
      });
    },
  );

  fastify.get(
    '/v1/meetings/:id/questions',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Questions asked about one of your recordings, oldest first',
        tags: ['ask'],
        params,
      },
    },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = request;
      if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id: meetingId } = request.params as { id: string };
      const result = await inWorkspace(async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select('id')
          .where('id', '=', meetingId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();
        if (meeting === undefined) return null;
        const [rows, starts, usage] = await Promise.all([
          tx
            .selectFrom('meetingQuestions')
            .select(['id', 'question', 'status', 'answer', 'segmentIds', 'createdAt'])
            .where('meetingId', '=', meetingId)
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc')
            .execute(),
          tx
            .selectFrom('transcriptSegments')
            .select(['id', 'startMs'])
            .where('meetingId', '=', meetingId)
            .execute(),
          usageFor(tx, userId, now()),
        ]);
        return { rows, starts, usage };
      });
      if (result === null) throw new NotFoundError(`Meeting ${meetingId} not found`);
      const startOf = new Map(result.starts.map((s) => [s.id, Number(s.startMs)]));
      return reply.send({
        items: result.rows.map((row) => toQuestion(row, startOf)),
        usage: result.usage,
      });
    },
  );
};
