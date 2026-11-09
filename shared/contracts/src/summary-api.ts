import { z } from 'zod';

import { IsoDateTime } from './common.ts';
import { MeetingStatus, Note, ProcessingStep, SummaryItem, TemplateId } from './rest.ts';

/**
 * Stored summaries over the API (S3-08, DESIGN §12): versions, keep / go back (FR-SUM-07),
 * feedback (FR-SUM-09) and the processing progress stream (S3-03).
 */

export const SummaryVersion = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  template: TemplateId,
  language: z.string().min(1),
  model: z.string().min(1),
  overview: z.string(),
  createdAt: IsoDateTime,
  /** In display order: anchored details, decisions, action items, questions, topics. */
  items: z.array(SummaryItem),
});
export type SummaryVersion = z.infer<typeof SummaryVersion>;

export const SummaryParticipant = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  isSelf: z.boolean(),
});

// GET /v1/meetings/{id}/summary
export const MeetingSummaryResponse = z.object({
  /** The version the user reads (accepted); null before the first one exists. */
  current: SummaryVersion.nullable(),
  /** A regenerated version waiting for Keep / Go back (FR-SUM-07). */
  candidate: SummaryVersion.nullable(),
  /** The latest run failed and no notes exist: the UI offers to try again. */
  failed: z.boolean(),
  participants: z.array(SummaryParticipant),
  /** The user's notes, for the anchored sections' headings (DESIGN §12.4). */
  notes: z.array(Note),
});
export type MeetingSummaryResponse = z.infer<typeof MeetingSummaryResponse>;

// POST /v1/meetings/{id}/summary:regenerate → 202
export const RegenerateSummaryRequest = z.object({ template: TemplateId.optional() });
export type RegenerateSummaryRequest = z.infer<typeof RegenerateSummaryRequest>;

// POST /v1/meetings/{id}/summary:keep and summary:discard
export const SummaryVersionRequest = z.object({ version: z.number().int().positive() });
export type SummaryVersionRequest = z.infer<typeof SummaryVersionRequest>;

// POST /v1/feedback (FR-SUM-09): useful / not useful, optional comment.
export const FeedbackRequest = z.object({
  targetType: z.enum(['summary', 'summary_item']),
  targetId: z.string().min(1),
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  comment: z.string().trim().max(2000).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequest>;

// GET /v1/meetings/{id}/events: `event: progress` lines carrying this JSON (S3-03).
export const MeetingProgress = z.object({
  status: MeetingStatus,
  processingStep: ProcessingStep.nullable(),
});
export type MeetingProgress = z.infer<typeof MeetingProgress>;

// GET /v1/search?q=&limit= (S3-09, DESIGN §11 item 5): the caller's meetings, best match first.
export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
/** Snippets mark matched words with U+0001 … U+0002 so the UI can highlight without HTML. */
export const SEARCH_MARK_START = '\u0001';
export const SEARCH_MARK_END = '\u0002';
export const SearchHit = z.object({
  kind: z.enum(['title', 'segment', 'note', 'summary_item']),
  id: z.string().min(1),
  /** Session time of a transcript line or note; null for titles and summary items. */
  startMs: z.number().int().nonnegative().nullable(),
  snippet: z.string(),
});
export const SearchResult = z.object({
  meeting: z.object({ id: z.string().min(1), title: z.string(), startedAt: IsoDateTime }),
  hits: z.array(SearchHit).max(3),
});
export const SearchResponse = z.object({ results: z.array(SearchResult) });
export type SearchResponse = z.infer<typeof SearchResponse>;
