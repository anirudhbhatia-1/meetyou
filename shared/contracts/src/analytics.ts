import { z } from 'zod';

import { IsoDateTime } from './common.ts';

/**
 * Product analytics (S4-15, PRD §19.2 and §19.6, FEATURES O5). Every event has its own strict
 * props of IDs, counts, durations and enums only — never transcript text, notes, names or meeting
 * titles. Unknown events and extra fields are rejected, so free text cannot ride along. Users can
 * opt out (`analyticsOptOut`); the API then stores nothing.
 */

/** A meeting ID as the API issues it: a prefix and ULID-style characters, nothing else. */
const MeetingId = z.string().regex(/^mtg_[0-9A-Za-z_]{1,64}$/);
const Count = z.number().int().nonnegative().max(1_000_000);
const DurationMs = z
  .number()
  .int()
  .nonnegative()
  .max(24 * 60 * 60 * 1000);

const event = <N extends string, P extends z.ZodRawShape>(name: N, props: P) =>
  z.strictObject({ name: z.literal(name), at: IsoDateTime, props: z.strictObject(props) });

export const ProductEvent = z.discriminatedUnion('name', [
  // Extension: recording funnel (activation, meetings per user, capture failure rate).
  event('recording_started', {
    video: z.boolean(),
    videoQuality: z.enum(['standard', 'data_saver']),
    consentMode: z.enum(['one_click', 'automatic', 'off']),
  }),
  event('recording_stopped', { durationMs: DurationMs }),
  event('recording_failed', {
    error: z.enum([
      'tab_capture_failed',
      'audio_context_failed',
      'not_meet_tab',
      'no_active_tab',
      'capture_not_allowed',
      'offscreen_failed',
      'capture_lost',
      'signed_out',
      'server_unreachable',
    ]),
  }),
  // Web: summary open rate, citation interaction, copy/export rate, thumbs-up rate.
  event('summary_opened', { meetingId: MeetingId }),
  event('citation_opened', { meetingId: MeetingId }),
  event('notes_shared', {
    meetingId: MeetingId,
    action: z.enum(['copy', 'download']),
    format: z.enum(['markdown', 'plain']),
  }),
  event('summary_feedback', { meetingId: MeetingId, useful: z.boolean() }),
  event('transcript_searched', { meetingId: MeetingId, matches: Count }),
  event('library_searched', { results: Count }),
  event('action_item_status', { status: z.enum(['open', 'done']) }),
  event('export_started', {}),
]);
export type ProductEvent = z.infer<typeof ProductEvent>;
export type ProductEventName = ProductEvent['name'];

/** Events are sent in small batches; the client says where they came from. */
export const ProductEventsRequest = z.strictObject({
  client: z.enum(['web', 'extension']),
  events: z.array(ProductEvent).min(1).max(25),
});
export type ProductEventsRequest = z.infer<typeof ProductEventsRequest>;
