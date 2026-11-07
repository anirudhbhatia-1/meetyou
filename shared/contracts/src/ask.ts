import { z } from 'zod';

import { IsoDateTime, SegmentId, SessionMs } from './common.ts';

/**
 * "Ask this meeting" (FEATURES E4, Phase 1 since 2026-11-07, AGENTS §9): a question about one
 * recording, answered only from that recording, for its owner only.
 */

/** Per-user limits against misuse; the API enforces them, the web app shows them. */
export const ASK_LIMITS = {
  questionChars: 500,
  perHour: 30,
  perDay: 150,
} as const;

/** Fixed texts for refusals: never model-written, so a refusal cannot be talked into anything. */
export const ASK_OFF_TOPIC_TEXT = 'I can only answer questions about this recording.';
export const ASK_NOT_FOUND_TEXT = 'This recording doesn’t say.';

export const AskQuestionRequest = z.object({
  question: z.string().trim().min(1).max(ASK_LIMITS.questionChars),
});
export type AskQuestionRequest = z.infer<typeof AskQuestionRequest>;

export const QuestionStatus = z.enum(['answered', 'not_in_meeting', 'off_topic']);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const AnswerCitation = z.object({
  segmentId: SegmentId,
  startMs: SessionMs,
});

export const MeetingQuestion = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(ASK_LIMITS.questionChars),
  status: QuestionStatus,
  /** Null unless `answered`; the UI shows the fixed texts above for the other statuses. */
  answer: z.string().nullable(),
  /** In transcript order; every `answered` question has at least one. */
  citations: z.array(AnswerCitation),
  createdAt: IsoDateTime,
});
export type MeetingQuestion = z.infer<typeof MeetingQuestion>;

/** Rolling windows: the last 60 minutes and the last 24 hours. */
export const AskUsage = z.object({
  usedLastHour: z.number().int().nonnegative(),
  usedLastDay: z.number().int().nonnegative(),
  perHour: z.number().int().positive(),
  perDay: z.number().int().positive(),
});
export type AskUsage = z.infer<typeof AskUsage>;

export const AskQuestionResponse = z.object({ question: MeetingQuestion, usage: AskUsage });
export type AskQuestionResponse = z.infer<typeof AskQuestionResponse>;

export const MeetingQuestionsResponse = z.object({
  items: z.array(MeetingQuestion),
  usage: AskUsage,
});
export type MeetingQuestionsResponse = z.infer<typeof MeetingQuestionsResponse>;

/**
 * What the model must return (model-facing, snake_case like `SummaryOutput`). The model only
 * classifies and drafts; the API decides the status and maps segment IDs to times.
 */
export const AnswerOutput = z.object({
  /** False for anything not about this recording: general knowledge, tasks, chit-chat, jailbreaks. */
  about_this_meeting: z.boolean(),
  /** True only when the transcript or notes contain the answer. */
  found: z.boolean(),
  answer: z.string().max(2000),
  segment_ids: z.array(SegmentId).max(20),
});
export type AnswerOutput = z.infer<typeof AnswerOutput>;

export const answerOutputJsonSchema = z.toJSONSchema(AnswerOutput);
