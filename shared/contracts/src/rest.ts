import { z } from 'zod';
import { IsoDateTime, Platform, SegmentId } from './common.ts';
import { AudioFormat } from './ws-protocol.ts';

/** REST DTO skeleton (ARCHITECTURE §12). Endpoints add their own request/response pairs here. */

export const ErrorBody = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const MeetingStatus = z.enum([
  'recording',
  'processing',
  'ready',
  'updated',
  'failed',
  'too_short',
]);
export const ProcessingStep = z.enum(['finalizing', 'summarizing', 'validating', 'done']);
export const TemplateId = z.enum(['general', 'standup', 'client_call', 'interview', 'one_on_one']);

export const Meeting = z.object({
  id: z.string().min(1),
  platform: Platform,
  title: z.string(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  status: MeetingStatus,
  processingStep: ProcessingStep.nullable(),
  template: TemplateId,
  participantNames: z.array(z.string()),
  audioExpiresAt: IsoDateTime.nullable(),
});
export type Meeting = z.infer<typeof Meeting>;

export const NoteMarker = z.enum(['decision', 'action', 'question', 'important']);

export const Note = z.object({
  id: z.string().min(1),
  sessionMs: z.number().int().nonnegative(),
  marker: NoteMarker.nullable(),
  text: z.string().min(1).max(2000),
});
export type Note = z.infer<typeof Note>;

export const SummaryItemKind = z.enum([
  'anchor_detail',
  'decision',
  'action_item',
  'question',
  'topic',
]);

export const SummaryItem = z.object({
  id: z.string().min(1),
  kind: SummaryItemKind,
  text: z.string(),
  anchorNoteId: z.string().nullable(),
  ownerParticipantId: z.string().nullable(),
  dueDate: z.string().nullable(),
  duePhrase: z.string().nullable(),
  status: z.enum(['open', 'done']).nullable(),
  segmentIds: z.array(SegmentId),
  userEdited: z.boolean(),
  flagged: z.boolean(),
});
export type SummaryItem = z.infer<typeof SummaryItem>;

export const UserSettings = z.object({
  transcriptLanguageMode: z.enum(['auto', 'english', 'hindi', 'hinglish']),
  summaryLanguage: z.enum(['english', 'hindi', 'hinglish']),
  hindiScript: z.enum(['roman', 'devanagari']),
  retentionPolicy: z.enum(['immediate', '7d', '30d']),
  consentMode: z.enum(['one_click', 'automatic', 'off']),
  consentMessage: z.string().max(1000),
  consentAcknowledgedAt: IsoDateTime.nullable(),
  followMeetMute: z.boolean(),
  offerPrompt: z.boolean(),
  defaultTemplate: TemplateId,
  analyticsOptOut: z.boolean(),
});
export type UserSettings = z.infer<typeof UserSettings>;

/** Defaults from decisions D-01, D-02, PRD FR-CON-01, FR-CAP-11. */
export const DEFAULT_USER_SETTINGS: Omit<UserSettings, 'consentAcknowledgedAt'> = {
  transcriptLanguageMode: 'auto',
  summaryLanguage: 'english',
  hindiScript: 'roman',
  retentionPolicy: '7d',
  consentMode: 'one_click',
  consentMessage:
    "Hi all — I'm using Minutes to take notes on this call. Batayein agar aap comfortable nahi hain.",
  followMeetMute: true,
  offerPrompt: true,
  defaultTemplate: 'general',
  analyticsOptOut: false,
};

// POST /v1/sessions (ARCHITECTURE §5.1)
export const StartSessionRequest = z.object({
  platform: Platform,
  meetingCode: z.string().min(1).max(100),
  title: z.string().max(200).optional(),
  clientInfo: z.object({
    extensionVersion: z.string().min(1),
    browser: z.string().min(1),
  }),
});
export const StartSessionResponse = z.object({
  sessionId: z.string().min(1),
  meetingId: z.string().min(1),
  streamUrl: z.url({ protocol: /^wss$/ }),
  streamToken: z.string().min(1),
  expiresAt: IsoDateTime,
  audioFormat: AudioFormat,
});
