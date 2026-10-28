import { z } from 'zod';
import { LanguageTag, Lane, SegmentId, SessionMs } from './common.ts';

export const Word = z.object({
  text: z.string().min(1),
  startMs: SessionMs,
  endMs: SessionMs,
  confidence: z.number().min(0).max(1).optional(),
});
export type Word = z.infer<typeof Word>;

/**
 * Stored transcript segment (AGENTS.md §4, PRD §13, ARCHITECTURE §8.2).
 * `text` is display text (Roman for Hindi/Hinglish, decision D-01); `rawText` is the provider's
 * original output and is always kept.
 */
export const Segment = z
  .object({
    id: SegmentId,
    workspaceId: z.string().min(1),
    meetingId: z.string().min(1),
    lane: Lane,
    speakerClusterId: z.string().min(1).optional(),
    speakerName: z.string().min(1).max(200).optional(),
    startMs: SessionMs,
    endMs: SessionMs,
    text: z.string(),
    rawText: z.string(),
    language: LanguageTag,
    source: z.enum(['live', 'batch']),
    words: z.array(Word).optional(),
    flags: z.array(z.enum(['echo', 'low_confidence'])).default([]),
  })
  .refine((s) => s.endMs >= s.startMs, { message: 'endMs must be >= startMs', path: ['endMs'] });
export type Segment = z.infer<typeof Segment>;
