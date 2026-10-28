import { z } from 'zod';
import { IsoDateTime, Platform, SessionMs, UntrustedName, UntrustedText } from './common.ts';

/**
 * Normalized capture events (AGENTS.md §4, ARCHITECTURE §5.4).
 * Every adapter (Meet extension, desktop app, upload, bot) emits only these events.
 * Audio itself travels as binary frames (ws-protocol.ts), not as an event.
 */

const sessionId = z.string().min(1);

export const SessionStarted = z.object({
  type: z.literal('session.started'),
  sessionId,
  platform: Platform,
  meetingTitle: UntrustedName.optional(),
  startedAt: IsoDateTime,
});

export const ParticipantJoined = z.object({
  type: z.literal('participant.joined'),
  sessionId,
  participantId: z.string().min(1).max(200),
  displayName: UntrustedName,
  at: SessionMs,
});

export const ParticipantLeft = z.object({
  type: z.literal('participant.left'),
  sessionId,
  participantId: z.string().min(1).max(200),
  at: SessionMs,
});

export const SpeakerActive = z.object({
  type: z.literal('speaker.active'),
  sessionId,
  participantId: z.string().min(1).max(200),
  at: SessionMs,
});

/** Local mic mute state in the meeting app, used for `me`-lane gating (PRD FR-CAP-11). */
export const MicMuteChanged = z.object({
  type: z.literal('mic.mute_changed'),
  sessionId,
  muted: z.boolean(),
  at: SessionMs,
});

/** Optional naming/timing signal; never the transcript source. */
export const CaptionObserved = z.object({
  type: z.literal('caption.observed'),
  sessionId,
  participantId: z.string().min(1).max(200).optional(),
  text: UntrustedText,
  at: SessionMs,
});

/** Result of posting the consent notice into the meeting chat (PRD FR-CON-01..03). */
export const ConsentNotice = z.object({
  type: z.literal('consent.notice'),
  sessionId,
  mode: z.enum(['one_click', 'automatic', 'off']),
  outcome: z.enum(['posted', 'skipped', 'failed']),
  text: UntrustedText.optional(),
  at: SessionMs,
});

export const SessionEnded = z.object({
  type: z.literal('session.ended'),
  sessionId,
  reason: z.enum(['user_stopped', 'left_call', 'tab_closed', 'limit_reached', 'error']),
  endedAt: IsoDateTime,
});

export const CaptureEvent = z.discriminatedUnion('type', [
  SessionStarted,
  ParticipantJoined,
  ParticipantLeft,
  SpeakerActive,
  MicMuteChanged,
  CaptionObserved,
  ConsentNotice,
  SessionEnded,
]);
export type CaptureEvent = z.infer<typeof CaptureEvent>;
export type CaptureEventType = CaptureEvent['type'];
