import { newUlid, Note } from '@meetyou/contracts';

export type NoteMarker = NonNullable<Note['marker']>;

/** Composer chips (DESIGN §8.6); "Note" is no marker. */
export const NOTE_CHIPS: readonly { value: NoteMarker | 'note'; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'decision', label: 'Decision' },
  { value: 'action', label: 'Action' },
  { value: 'question', label: 'Question' },
];

export const MARKER_LABEL: Record<NoteMarker, string> = {
  decision: 'DECISION',
  action: 'ACTION',
  question: 'QUESTION',
  important: 'IMPORTANT',
};

const PREFIX = /^\s*(decision|action|question|important)\s*:\s*/i;
const MAX_NOTE = 2000;

/**
 * Builds a note from the composer (FR-NOTE-03): a typed `DECISION:` / `ACTION:` / `QUESTION:` /
 * `IMPORTANT:` prefix wins over the selected chip and is removed from the text. Hinglish aliases
 * are an open decision (DESIGN §19 item 15). Returns null for an empty note.
 */
export function composeNote(
  draft: string,
  chip: NoteMarker | 'note',
  sessionMs: number,
  now = Date.now(),
): Note | null {
  const match = PREFIX.exec(draft);
  const marker = match?.[1] === undefined ? null : (match[1].toLowerCase() as NoteMarker);
  const text = (match === null ? draft : draft.slice(match[0].length)).trim().slice(0, MAX_NOTE);
  if (text === '') return null;
  return {
    id: `note_${newUlid(now)}`,
    sessionMs: Math.max(0, Math.round(sessionMs)),
    marker: marker ?? (chip === 'note' ? null : chip),
    text,
  };
}

/**
 * Notes are kept in `chrome.storage.local` per session so a closed or reloaded panel keeps them.
 * TODO(S4-06): the notes sync client moves them to IndexedDB and syncs them (debounced PUT,
 * FR-NOTE-01/05); until then they stay on this computer and are not part of the summary.
 */
export function notesKey(sessionId: string): string {
  return `notes:${sessionId}`;
}

/** Stored data is re-validated: anything that no longer matches the contract is dropped. */
export function parseStoredNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = Note.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
