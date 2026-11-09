import type { NotesDoc, NotesDocItem } from '@meetyou/contracts';

import type { Meeting, MeetingSummary, Participant, Segment, SummaryItem } from '../api/types.ts';
import { formatLength } from './format.ts';

/**
 * The meeting's notes as the shared `NotesDoc` (DESIGN §13.1), for "Download as .md" now and the
 * share sheet later (S4-10). Times come from each item's first cited line.
 */
export function toNotesDoc(
  meeting: Meeting,
  summary: MeetingSummary,
  segments: readonly Segment[],
  people: readonly Participant[],
): NotesDoc {
  const startOf = new Map(segments.map((s) => [s.id, s.startMs]));
  const names = new Map(people.map((p) => [p.id, p.isSelf ? 'You' : p.displayName]));
  const item = (i: SummaryItem): NotesDocItem => ({
    text: i.text,
    atMs: i.segmentIds.map((id) => startOf.get(id)).find((t) => t !== undefined) ?? null,
    flagged: i.flagged,
    userEdited: i.userEdited,
  });
  return {
    title: meeting.title,
    when: new Date(meeting.startedAt).toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    length: formatLength(meeting.startedAt, meeting.endedAt),
    overview: summary.overview,
    sections: summary.sections.map((s) => ({
      heading: s.note?.text ?? null,
      items: s.items.map(item),
    })),
    decisions: summary.decisions.map(item),
    actionItems: summary.actionItems.map((i) => ({
      ...item(i),
      done: i.status === 'done',
      owner: i.ownerParticipantId === null ? null : (names.get(i.ownerParticipantId) ?? null),
      due:
        i.dueDate !== null
          ? new Date(`${i.dueDate}T00:00:00`).toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })
          : i.duePhrase,
    })),
    questions: summary.questions.map(item),
  };
}

/** Saves text as a file through a temporary link (no server round trip). */
export function saveTextFile(name: string, text: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
