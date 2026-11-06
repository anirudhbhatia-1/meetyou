import type { Note } from '@meetyou/contracts';
import { useCallback, useEffect, useState } from 'react';

import { notesKey, parseStoredNotes } from './notes.ts';

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

  const save = useCallback(
    (next: Note[]) => {
      setNotes(next);
      if (sessionId === null) return;
      chrome.storage.local
        .set({ [notesKey(sessionId)]: next })
        .catch((error: unknown) => console.error('sidepanel: save notes failed', error));
    },
    [sessionId],
  );

  return {
    notes,
    add: (note) => save([...notes, note]),
    remove: (id) => save(notes.filter((n) => n.id !== id)),
  };
}
