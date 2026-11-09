import type { Note } from '@meetyou/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { notesKey, parseStoredNotes } from './notes.ts';

const SYNC_DELAY_MS = 2_000;

export interface NotesStore {
  notes: Note[];
  add: (note: Note) => void;
  remove: (id: string) => void;
}

/** This recording's notes, saved on every change (see `notesKey` for where and why). */
export function useNotes(sessionId: string | null): NotesStore {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    setNotes([]);
    if (sessionId === null) return;
    let current = true;
    chrome.storage.local
      .get(notesKey(sessionId))
      .then((items) => {
        if (current) setNotes(parseStoredNotes(items[notesKey(sessionId)]));
      })
      .catch((error: unknown) => console.error('sidepanel: read notes failed', error));
    return () => {
      current = false;
    };
  }, [sessionId]);

  // Saved here at once (survives a closed panel or a lost connection), sent to the meeting 2 s after
  // the last change (S4-06); the service worker sends them again when the recording stops.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const save = useCallback(
    (next: Note[]) => {
      setNotes(next);
      if (sessionId === null) return;
      chrome.storage.local
        .set({ [notesKey(sessionId)]: next })
        .catch((error: unknown) => console.error('sidepanel: save notes failed', error));
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        chrome.runtime
          .sendMessage({ target: 'background', type: 'notes.sync', sessionId })
          .catch((error: unknown) => console.error('sidepanel: notes sync failed', error));
      }, SYNC_DELAY_MS);
    },
    [sessionId],
  );

  return {
    notes,
    add: (note) => save([...notes, note]),
    remove: (id) => save(notes.filter((n) => n.id !== id)),
  };
}
