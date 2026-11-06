import { describe, expect, it } from 'vitest';

import { composeNote, notesKey, parseStoredNotes } from './notes.ts';

describe('notes composer (FR-NOTE-03)', () => {
  it('uses the selected chip, or no marker for Note', () => {
    expect(composeNote('Budget badhana hai', 'decision', 61_200)).toMatchObject({
      marker: 'decision',
      text: 'Budget badhana hai',
      sessionMs: 61_200,
    });
    expect(composeNote('just a note', 'note', 0)?.marker).toBeNull();
  });

  it('turns a typed prefix into the marker and strips it', () => {
    expect(composeNote('ACTION: Priya sends the deck', 'note', 0)).toMatchObject({
      marker: 'action',
      text: 'Priya sends the deck',
    });
    expect(composeNote('  important :  launch date fixed', 'question', 0)).toMatchObject({
      marker: 'important',
      text: 'launch date fixed',
    });
  });

  it('refuses empty notes and gives unique ids', () => {
    expect(composeNote('   ', 'note', 0)).toBeNull();
    expect(composeNote('DECISION:   ', 'note', 0)).toBeNull();
    const a = composeNote('a', 'note', 0);
    const b = composeNote('b', 'note', 0);
    expect(a?.id).toMatch(/^note_/);
    expect(a?.id).not.toBe(b?.id);
  });

  it('drops stored notes that no longer match the contract', () => {
    const good = composeNote('ok', 'note', 5);
    expect(parseStoredNotes([good, { id: 'x' }, null, 'text'])).toEqual([good]);
    expect(parseStoredNotes(undefined)).toEqual([]);
    expect(notesKey('ses_1')).toBe('notes:ses_1');
  });
});
