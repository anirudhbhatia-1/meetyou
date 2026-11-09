import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Note, SummaryOutput, TemplateId } from '@meetyou/contracts';
import type { SummaryInput } from '@meetyou/summarizer';
import { z } from 'zod';

/**
 * Golden meetings (PRD §14.6): synthetic transcripts with human-written expectations. A keyword
 * matches when the normalized text contains it; `a|b` accepts either (English or Hindi wording).
 */
const Expectation = z.object({ keywords: z.array(z.string().min(1)).min(1) });

export const GoldenMeeting = z.object({
  id: z.string().regex(/^g\d{2}-[a-z0-9-]+$/),
  template: TemplateId,
  language: z.enum(['english', 'hindi', 'hinglish']),
  tags: z.array(z.string()),
  meeting: z.object({ title: z.string(), date: z.string(), durationMs: z.number().int() }),
  participants: z.array(z.object({ id: z.string(), name: z.string(), isSelf: z.boolean() })),
  notes: z.array(Note),
  segments: z.array(
    z.object({
      id: z.string(),
      speaker: z.string(),
      startMs: z.number().int(),
      endMs: z.number().int(),
      text: z.string(),
      echo: z.boolean(),
    }),
  ),
  expected: z.object({
    decisions: z.array(Expectation),
    actionItems: z.array(Expectation.extend({ owner: z.string().nullable() })),
    /** Prompt injection (S3-06): text that must not appear in action items / the title. */
    mustNotInActions: z.array(z.string()).default([]),
    mustNotInTitle: z.array(z.string()).default([]),
    /** Participants who must not own anything (an injected "assign everything to me"). */
    ownersNot: z.array(z.string()).default([]),
  }),
});
export type GoldenMeeting = z.infer<typeof GoldenMeeting>;

/** One model run on one golden meeting, kept in the repo so CI can gate without API calls. */
export const Recorded = z.object({
  goldenId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  templateVersion: z.number().int(),
  recordedAt: z.string(),
  output: SummaryOutput,
});
export type Recorded = z.infer<typeof Recorded>;

export const ROOT = join(import.meta.dirname, '..');

export function loadGolden(dir = join(ROOT, 'golden')): GoldenMeeting[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => GoldenMeeting.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

export function loadRecorded(dir = join(ROOT, 'recorded')): Map<string, Recorded> {
  const out = new Map<string, Recorded>();
  for (const f of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const r = Recorded.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    out.set(r.goldenId, r);
  }
  return out;
}

export function summaryInput(g: GoldenMeeting): SummaryInput {
  return {
    meeting: { title: g.meeting.title, date: g.meeting.date, durationMs: g.meeting.durationMs },
    participants: g.participants,
    notes: g.notes,
    segments: g.segments,
    template: g.template,
    language: g.language,
  };
}
