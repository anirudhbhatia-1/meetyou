import type { TemplateId as TemplateIdSchema } from '@meetyou/contracts';
import type { z } from 'zod';

export type TemplateId = z.infer<typeof TemplateIdSchema>;

/**
 * Templates are data, not code paths (ARCHITECTURE §10.3): what to emphasise, in words the model
 * reads. Every summary records `id` and `version`, so a quality change can be traced to a template
 * edit. First wording by Anirudh for S3-01; S3-07 (Gaurav) refines it against the evaluation set.
 * TODO(S3-07): versioned rows in the database once templates are edited outside code.
 */
export interface SummaryTemplate {
  id: TemplateId;
  version: number;
  label: string;
  /** One paragraph on what this kind of meeting is for. */
  purpose: string;
  /** Extra rules on top of the general ones, one per line. */
  emphasis: readonly string[];
}

export const TEMPLATES: Readonly<Record<TemplateId, SummaryTemplate>> = {
  general: {
    id: 'general',
    version: 1,
    label: 'General',
    purpose: 'A general meeting: capture what was discussed, decided and assigned.',
    emphasis: ['Keep the overview to the outcome of the meeting, not a play-by-play.'],
  },
  standup: {
    id: 'standup',
    version: 1,
    label: 'Standup',
    purpose: 'A daily standup: each person says what they did, what they will do, and blockers.',
    emphasis: [
      'The overview gives one short clause per person: done, next, blocked.',
      'A blocker someone offered to unblock is an action item for that person.',
      'A blocker nobody took is an open question.',
    ],
  },
  client_call: {
    id: 'client_call',
    version: 1,
    label: 'Client call',
    purpose: 'A call with a client or customer: their needs, our commitments, next steps.',
    emphasis: [
      'Requirements and constraints the client stated are decisions only if both sides agreed.',
      'Commitments made by either side are action items with the owner who made them.',
      'Quote numbers, prices and dates exactly as said; never round or convert them.',
    ],
  },
  interview: {
    id: 'interview',
    version: 1,
    label: 'Interview',
    purpose: 'An interview: the questions asked and what the candidate said in answer.',
    emphasis: [
      'Report what was said, not opinions about the candidate; no hiring verdict.',
      'Never comment on tone, emotion, confidence or personality.',
      'Topics are the subjects covered (skills, projects, questions from the candidate).',
    ],
  },
  one_on_one: {
    id: 'one_on_one',
    version: 1,
    label: '1:1',
    purpose: 'A one-to-one: updates, feedback, concerns, and agreed follow-ups.',
    emphasis: [
      'Keep feedback factual and close to the words used.',
      'Personal matters mentioned in passing stay out unless a note anchors them.',
    ],
  },
};
