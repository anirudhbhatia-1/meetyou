import { z } from 'zod';

import { IsoDateTime, SessionMs } from './common.ts';
import { SessionEnded } from './events.ts';
import {
  Meeting,
  MeetingStatus,
  Note,
  page,
  SummaryItem,
  TemplateId,
  UserSettings,
} from './rest.ts';
import { Segment } from './transcript.ts';

/**
 * Request and response shapes of the Phase 1 endpoints (ARCHITECTURE §12.1) that S2-09 and
 * S3-08 implement. Defined once here and validated on both sides (§12.2): the API parses requests
 * with these schemas and the extension and web app parse responses with them. Lists use `page()`
 * (`{ items, nextCursor }`, matching the API's cursor helper). Query objects describe query-string
 * parameters, so numbers are coerced from strings.
 */

const Cursor = z.string().min(1).max(500);
const Limit = z.coerce.number().int().min(1).max(100);

/** At least one field: an empty PATCH is a client bug, not a no-op. */
function nonEmpty<T extends z.ZodObject>(schema: T) {
  return schema.refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });
}

// ---------- Me & settings ----------

// GET /v1/me
export const MeResponse = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  email: z.email(),
  displayName: z.string().min(1).max(200),
});
export type MeResponse = z.infer<typeof MeResponse>;

// GET /v1/settings → UserSettings. PATCH /v1/settings: only the fields that change.
// `consentAcknowledged: true` records the onboarding acknowledgement (FR-ONB-06); the server sets
// `consentAcknowledgedAt`, which clients never send.
export const PatchSettingsRequest = nonEmpty(
  UserSettings.omit({ consentAcknowledgedAt: true })
    .partial()
    .extend({ consentAcknowledged: z.literal(true).optional() }),
);
export type PatchSettingsRequest = z.infer<typeof PatchSettingsRequest>;

// ---------- Sessions (StartSessionRequest/Response are in rest.ts) ----------

// POST /v1/sessions/{id}/stream-token (reconnect, ADR-0004 §4.4)
export const StreamTokenResponse = z.object({
  streamUrl: z.url({ protocol: /^wss$/ }),
  streamToken: z.string().min(1),
  expiresAt: IsoDateTime,
});
export type StreamTokenResponse = z.infer<typeof StreamTokenResponse>;

// POST /v1/sessions/{id}/end
export const EndSessionRequest = z.object({
  reason: SessionEnded.shape.reason,
  /** Session clock at the end (ARCHITECTURE §5.5). */
  atMs: SessionMs,
});
export const EndSessionResponse = z.object({
  meetingId: z.string().min(1),
  status: MeetingStatus,
});

// POST /v1/sessions/{id}/recover (FR-CAP-08): after a crash, the extension still holds frames of
// this session. A live session gets a new stream token; an ended one is closed for good.
export const RecoverSessionResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resumable'), ...StreamTokenResponse.shape }),
  z.object({ state: z.literal('ended'), meetingId: z.string().min(1) }),
]);
export type RecoverSessionResponse = z.infer<typeof RecoverSessionResponse>;

// ---------- Meetings ----------

// GET /v1/meetings?cursor=&limit=&q=&template=&status=
export const ListMeetingsQuery = z.object({
  cursor: Cursor.optional(),
  limit: Limit.default(20),
  /** Title and participant search; full-text search over content is /v1/search (S3-09). */
  q: z.string().trim().min(1).max(200).optional(),
  template: TemplateId.optional(),
  status: MeetingStatus.optional(),
});
export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuery>;
export const MeetingList = page(Meeting);
export type MeetingList = z.infer<typeof MeetingList>;

// PATCH /v1/meetings/{id} (rename, change template: DESIGN §12.1–12.2)
export const PatchMeetingRequest = nonEmpty(
  z.object({
    title: z.string().trim().min(1).max(200).optional(),
    template: TemplateId.optional(),
  }),
);
export type PatchMeetingRequest = z.infer<typeof PatchMeetingRequest>;

// DELETE /v1/meetings/{id} → undo within the grace period with POST /v1/meetings/{id}:restore
export const DeleteMeetingResponse = z.object({
  deletedAt: IsoDateTime,
  /** Deletion becomes final after this (10 s grace, S2-10). */
  restoreUntil: IsoDateTime,
});

// ---------- Transcript ----------

// GET /v1/meetings/{id}/segments?cursor=&limit= (ordered by startMs)
export const ListSegmentsQuery = z.object({
  cursor: Cursor.optional(),
  limit: Limit.default(100),
});
export const SegmentList = page(Segment);
export type SegmentList = z.infer<typeof SegmentList>;

// ---------- Notes (FR-NOTE-01/05, S4-06 sync client) ----------

// GET /v1/meetings/{id}/notes. `version` is also sent as the ETag; PUT sends it back as If-Match
// and gets 412 when another device saved in between (ARCHITECTURE §12.2).
export const NotesResponse = z.object({
  notes: z.array(Note).max(500),
  version: z.string().min(1),
});
export type NotesResponse = z.infer<typeof NotesResponse>;
// PUT /v1/meetings/{id}/notes: the whole list (replace), with If-Match.
export const PutNotesRequest = z.object({ notes: z.array(Note).max(500) });
export type PutNotesRequest = z.infer<typeof PutNotesRequest>;

// ---------- Action items and summary items (S3-08, DESIGN §14) ----------

// GET /v1/action-items?status=&owner=&cursor=&limit=
export const ListActionItemsQuery = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  owner: z.enum(['me', 'any']).default('any'),
  cursor: Cursor.optional(),
  limit: Limit.default(50),
});
export const ActionItem = SummaryItem.extend({
  meetingId: z.string().min(1),
  meetingTitle: z.string(),
  meetingStartedAt: IsoDateTime,
  /** Display name of the owner from the participant list, or null when unassigned. */
  ownerName: z.string().nullable(),
  /** The owner is the user who recorded the meeting. */
  ownerIsSelf: z.boolean(),
});
export type ActionItem = z.infer<typeof ActionItem>;
export const ActionItemList = page(ActionItem);
export type ActionItemList = z.infer<typeof ActionItemList>;

// PATCH /v1/summary-items/{id}: owner must be a participant of the meeting (AGENTS §3 rule 7).
export const PatchSummaryItemRequest = nonEmpty(
  z.object({
    text: z.string().trim().min(1).max(2000).optional(),
    ownerParticipantId: z.string().min(1).nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    status: z.enum(['open', 'done']).optional(),
  }),
);
export type PatchSummaryItemRequest = z.infer<typeof PatchSummaryItemRequest>;

// ---------- Consent log (FR-CON-03, DESIGN §13.4) ----------

// GET /v1/meetings/{id}/consent-log
export const ConsentLogEntry = z.object({
  id: z.string().min(1),
  mode: z.enum(['one_click', 'automatic', 'off']),
  outcome: z.enum(['posted', 'skipped', 'failed']),
  noticeText: z.string().nullable(),
  sentAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type ConsentLogEntry = z.infer<typeof ConsentLogEntry>;
export const ConsentLogResponse = z.object({ entries: z.array(ConsentLogEntry) });
export type ConsentLogResponse = z.infer<typeof ConsentLogResponse>;

// ---------- Audio (GET /v1/meetings/{id}/audio?lane=me|them) ----------
// One lane's stored chunks joined into an Ogg Opus file (S4-09); the `x-audio-spans` header
// carries `AudioSpans` (below) to map file time to the meeting clock.

// ---------- Glossary (GET/PUT /v1/glossary) ----------

// Validated against the STT provider's limits (Deepgram keyterm: ≤ 50 terms recommended,
// 500 tokens per request — STT_PREFLIGHT §3.3); commas are not allowed in a key term.
export const GlossaryTerm = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((t) => !t.includes(','), { message: 'Commas are not allowed' });
export const GlossaryResponse = z.object({
  terms: z.array(GlossaryTerm),
  /** The provider's term limit, for "{n} of {max}" near the limit (DESIGN §15.5). */
  maxTerms: z.number().int().positive(),
});
export type GlossaryResponse = z.infer<typeof GlossaryResponse>;
export const PutGlossaryRequest = z.object({ terms: z.array(GlossaryTerm).max(50) });
export type PutGlossaryRequest = z.infer<typeof PutGlossaryRequest>;

// PATCH /v1/meetings/{id}/speakers/{clusterId} (S4-09, FR-SPK-05): one of the meeting's
// participants, or a new name typed by the user. Applies to the whole meeting.
export const RenameSpeakerRequest = z.union([
  z.object({ participantId: z.string().min(1).max(100) }).strict(),
  z.object({ name: z.string().trim().min(1).max(200) }).strict(),
]);
export type RenameSpeakerRequest = z.infer<typeof RenameSpeakerRequest>;
export const RenameSpeakerResponse = z.object({
  clusterId: z.string(),
  participantId: z.string(),
  displayName: z.string(),
});
export type RenameSpeakerResponse = z.infer<typeof RenameSpeakerResponse>;

/** `x-audio-spans` on GET /v1/meetings/{id}/audio: where each stretch of the file sits in the meeting. */
export const AudioSpans = z.array(
  z.object({
    fileMs: z.number().nonnegative(),
    sessionMs: z.number().nonnegative(),
    durationMs: z.number().nonnegative(),
  }),
);
export type AudioSpans = z.infer<typeof AudioSpans>;
