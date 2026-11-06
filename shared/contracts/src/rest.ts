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

export const VideoStatus = z.enum(['uploading', 'processing', 'ready', 'failed', 'expired']);

// GET /v1/me (ARCHITECTURE §12.1)
export const MeResponse = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string(),
    displayName: z.string(),
  }),
  workspace: z.object({
    id: z.string().min(1),
    name: z.string(),
    plan: z.enum(['free']),
    role: z.enum(['owner']),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;

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
  /** When the retention policy deletes the recordings (audio and video). */
  recordingExpiresAt: IsoDateTime.nullable(),
  /** Null when video was not recorded for this meeting (ADR-0011). */
  video: z
    .object({
      status: VideoStatus,
      durationMs: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
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
  /** Applies to audio and video (D-02, ADR-0011). */
  retentionPolicy: z.enum(['immediate', '7d', '30d']),
  /** Record the meeting screen with the audio (ADR-0011). Ignored when retention is immediate. */
  recordVideo: z.boolean(),
  videoQuality: z.enum(['standard', 'data_saver']),
  consentMode: z.enum(['one_click', 'automatic', 'off']),
  consentMessage: z.string().max(1000),
  consentAcknowledgedAt: IsoDateTime.nullable(),
  followMeetMute: z.boolean(),
  offerPrompt: z.boolean(),
  defaultTemplate: TemplateId,
  analyticsOptOut: z.boolean(),
});
export type UserSettings = z.infer<typeof UserSettings>;

/** Default consent notice when video is off and the user has not edited the text (DESIGN §8.5). */
export const CONSENT_MESSAGE_AUDIO_ONLY =
  "Hi all — I'm using Minutes to take notes on this call. Batayein agar aap comfortable nahi hain.";

/** Defaults from decisions D-01, D-02, PRD FR-CON-01, FR-CAP-11, ADR-0011. */
export const DEFAULT_USER_SETTINGS: Omit<UserSettings, 'consentAcknowledgedAt'> = {
  transcriptLanguageMode: 'auto',
  summaryLanguage: 'english',
  hindiScript: 'roman',
  retentionPolicy: '7d',
  recordVideo: true,
  videoQuality: 'standard',
  consentMode: 'one_click',
  consentMessage:
    "Hi all — I'm using Minutes to record this call (audio and screen) and take notes. Batayein agar aap comfortable nahi hain.",
  followMeetMute: true,
  offerPrompt: true,
  defaultTemplate: 'general',
  analyticsOptOut: false,
};

// POST /v1/auth/google (ADR-0004 §4.1): the authorization code from launchWebAuthFlow with PKCE.
export const GoogleSignInRequest = z.object({
  code: z.string().min(1).max(2048),
  /** RFC 7636: 43–128 characters of [A-Za-z0-9-._~]. */
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  redirectUri: z.url({ protocol: /^https$/ }),
});

// Response of /v1/auth/google and /v1/auth/refresh (ADR-0004 §4.2). The web app receives the
// refresh token as an HttpOnly cookie instead (§4.5).
export const TokenResponse = z.object({
  accessToken: z.string().min(1),
  accessExpiresAt: IsoDateTime,
  refreshToken: z.string().min(1),
  refreshExpiresAt: IsoDateTime,
});
export type TokenResponse = z.infer<typeof TokenResponse>;

// POST /v1/auth/refresh and POST /v1/auth/logout
export const RefreshRequest = z.object({
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a 256-bit base64url token'),
});

// POST /v1/sessions (ARCHITECTURE §5.1)
export const StartSessionRequest = z.object({
  platform: Platform,
  meetingCode: z.string().min(1).max(100),
  title: z.string().max(200).optional(),
  recordVideo: z.boolean(),
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
  /** Null when the server does not accept video for this session (setting off, immediate retention). */
  video: z
    .object({
      fragmentMs: z.literal(10_000),
      maxFragmentBytes: z.number().int().positive(),
      maxWidth: z.number().int().positive(),
      maxHeight: z.number().int().positive(),
      fps: z.number().int().positive(),
    })
    .nullable(),
});
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

// POST /v1/sessions/{sessionId}/video/fragments:sign (ADR-0011 §3.3)
export const SignVideoFragmentsRequest = z.object({
  partId: z.string().regex(/^vp_[0-9A-HJKMNP-TV-Z]{26}$/),
  indices: z.array(z.number().int().nonnegative()).min(1).max(50),
  contentType: z.enum(['video/mp4', 'video/webm']),
});
export const SignVideoFragmentsResponse = z.object({
  fragments: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      url: z.url({ protocol: /^https$/ }),
      expiresAt: IsoDateTime,
    }),
  ),
  /**
   * Headers every PUT must send exactly as given: Cloud Storage checks the signed size range
   * (`x-goog-content-length-range: 0,8388608`, `@meetyou/storage` signFragmentUploads).
   */
  headers: z.record(z.string().regex(/^x-goog-[a-z0-9-]+$/), z.string().max(200)),
});

// GET /v1/meetings/{meetingId}/video
export const VideoPlaybackResponse = z.object({
  url: z.url({ protocol: /^https$/ }),
  posterUrl: z.url({ protocol: /^https$/ }).nullable(),
  expiresAt: IsoDateTime,
  /** Session time at playback position 0, for transcript click-to-seek. */
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
