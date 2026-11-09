import { UNASSIGNED_OWNER, type Note, type SummaryOutput } from '@meetyou/contracts';

import { resolveDuePhrase, validIsoDate } from './due-date.ts';
import type { SummaryParticipant, SummarySegment } from './input.ts';

/**
 * The validation chain (S3-02, ARCHITECTURE §10.2 steps 3–6, PRD §14.4): model output is checked
 * against the meeting's own data before anything is stored. Nothing the model claims is trusted
 * blindly: citations must be this meeting's non-echo segments, owners must be participants, notes
 * must exist, dates are resolved in code, and numbers must appear in the cited lines.
 */

export type ItemKind = 'anchor_detail' | 'decision' | 'action_item' | 'question' | 'topic';

/** One stored row of `summary_items` (with its citations), in display order. */
export interface ValidatedItem {
  kind: ItemKind;
  text: string;
  anchorNoteId: string | null;
  /** Null = unassigned (AGENTS §3 rule 7). */
  ownerParticipantId: string | null;
  dueDate: string | null;
  duePhrase: string | null;
  segmentIds: string[];
  /** Unverified (FR-SUM-02, DESIGN §6.14): no valid citation, or a number not in the cited lines. */
  flagged: boolean;
  order: number;
}

export interface ValidatedSummary {
  title: string;
  overview: string;
  items: ValidatedItem[];
  /** Counts only, for logs and the evaluation (no content). */
  report: {
    citationsDropped: number;
    unverified: number;
    ownersUnassigned: number;
    datesResolved: number;
    unknownNotes: number;
  };
}

export interface ValidationContext {
  /** All of the meeting's segments; echo-flagged ones are not valid citations. */
  segments: readonly SummarySegment[];
  participants: readonly SummaryParticipant[];
  notes: readonly Note[];
  /** The meeting's local date, YYYY-MM-DD. */
  meetingDate: string;
}

/** Digits in a text, normalised ("40,000" → "40000"; "1.5" stays). */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) =>
    m[0].replace(/,/g, '').replace(/\.$/, ''),
  );
}

/**
 * P2 check (§10.2 step 6): every number the item states must appear in a cited segment. Spelled-
 * out numbers ("chalis hazaar") are not compared, so this flags rather than proves.
 */
function numbersSupported(text: string, cited: readonly SummarySegment[]): boolean {
  const said = new Set(cited.flatMap((s) => numbersIn(s.text)));
  return numbersIn(text).every((n) => said.has(n));
}

export function validateSummary(output: SummaryOutput, ctx: ValidationContext): ValidatedSummary {
  const valid = new Map(ctx.segments.filter((s) => !s.echo).map((s) => [s.id, s]));
  const participants = new Set(ctx.participants.map((p) => p.id));
  const notes = new Set(ctx.notes.map((n) => n.id));
  const report = {
    citationsDropped: 0,
    unverified: 0,
    ownersUnassigned: 0,
    datesResolved: 0,
    unknownNotes: 0,
  };
  const items: ValidatedItem[] = [];

  const cite = (ids: readonly string[]): { ids: string[]; segments: SummarySegment[] } => {
    const unique = [...new Set(ids)];
    const kept = unique.filter((id) => valid.has(id));
    report.citationsDropped += unique.length - kept.length;
    // Transcript order, so chips read top to bottom like the conversation.
    const segments = kept
      .map((id) => valid.get(id))
      .filter((s): s is SummarySegment => s !== undefined)
      .sort((a, b) => a.startMs - b.startMs);
    return { ids: segments.map((s) => s.id), segments };
  };

  const push = (
    kind: ItemKind,
    text: string,
    citedIds: readonly string[],
    extra: Partial<ValidatedItem> = {},
  ) => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const { ids, segments } = cite(citedIds);
    const flagged = kind !== 'topic' && (ids.length === 0 || !numbersSupported(trimmed, segments));
    if (flagged) report.unverified += 1;
    items.push({
      kind,
      text: trimmed,
      anchorNoteId: null,
      ownerParticipantId: null,
      dueDate: null,
      duePhrase: null,
      segmentIds: ids,
      flagged,
      order: items.length,
      ...extra,
    });
  };

  for (const section of output.anchored_sections) {
    if (!notes.has(section.note_id)) {
      report.unknownNotes += 1;
      continue;
    }
    for (const detail of section.details) {
      push('anchor_detail', detail.text, detail.segment_ids, { anchorNoteId: section.note_id });
    }
  }
  for (const d of output.decisions) push('decision', d.text, d.segment_ids);
  for (const a of output.action_items) {
    let owner: string | null = a.owner_participant_id;
    if (owner === UNASSIGNED_OWNER || !participants.has(owner)) {
      if (owner !== UNASSIGNED_OWNER) report.ownersUnassigned += 1;
      owner = null;
    }
    const duePhrase = a.due_phrase?.trim() || null;
    let dueDate = validIsoDate(a.due_date);
    if (dueDate === null) {
      dueDate = resolveDuePhrase(duePhrase, ctx.meetingDate);
      if (dueDate !== null) report.datesResolved += 1;
    }
    push('action_item', a.task, a.segment_ids, { ownerParticipantId: owner, dueDate, duePhrase });
  }
  for (const q of output.open_questions) push('question', q.text, q.segment_ids);
  for (const t of output.topics) push('topic', t, []);

  return { title: output.title.trim(), overview: output.overview.trim(), items, report };
}
