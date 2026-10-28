import { z } from 'zod';

/** Crockford base32 ULID: 26 characters, sortable by time. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const Ulid = z.string().regex(ULID_PATTERN, 'Expected a ULID');

/** Segment IDs are what the LLM cites (PRD §14), so they carry a recognisable prefix. */
export const SegmentId = z.string().regex(/^seg_[0-9A-HJKMNP-TV-Z]{26}$/, 'Expected seg_<ULID>');
export type SegmentId = z.infer<typeof SegmentId>;

export const Lane = z.enum(['me', 'them']);
export type Lane = z.infer<typeof Lane>;

export const Platform = z.enum(['google_meet']);
export type Platform = z.infer<typeof Platform>;

/** Milliseconds on the session clock (ARCHITECTURE §5.5): 0 = capture start, shared by both lanes. */
export const SessionMs = z.number().int().nonnegative();

/** Text read from a meeting platform's DOM is untrusted (ARCHITECTURE §4.6): bounded length. */
export const UntrustedName = z.string().trim().min(1).max(200);
export const UntrustedText = z.string().max(2000);

export const IsoDateTime = z.iso.datetime({ offset: true });

/** BCP-47-ish language tag as reported by providers, e.g. "hi", "hi-IN", "en". */
export const LanguageTag = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
