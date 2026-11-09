import { describe, expect, it } from 'vitest';

import { clockTime, notesFileName, notesText, type NotesDoc } from './notes-text.ts';

const item = (text: string, atMs: number | null = null, flagged = false) => ({
  text,
  atMs,
  flagged,
  userEdited: false,
});

const doc: NotesDoc = {
  title: 'Weekly sync',
  when: 'Mon 9 Nov 2026, 10:30',
  length: '42 min',
  overview: 'Release moves to Friday.',
  sections: [
    { heading: 'Payments bugs', items: [item('Two bugs still open', 65_000)] },
    { heading: null, items: [item('Hiring update', 3_725_000)] },
    { heading: 'Empty note', items: [] },
  ],
  decisions: [item('Release on Friday', 125_000), item('Unchecked number', 1_000, true)],
  actionItems: [
    { ...item('Fix the refund bug', 200_000), done: false, owner: 'Sameer', due: 'Thu 12 Nov' },
    { ...item('Send the deck'), done: true, owner: null, due: null },
  ],
  questions: [],
};

describe('notesText', () => {
  it('prints the DESIGN §13.1 Markdown with times', () => {
    expect(notesText(doc, { format: 'markdown', includeTimes: true })).toBe(
      [
        '# Weekly sync',
        'Mon 9 Nov 2026, 10:30 · 42 min',
        '',
        '## Summary',
        'Release moves to Friday.',
        '',
        '## Payments bugs',
        '- Two bugs still open [1:05]',
        '',
        '## From the conversation',
        '- Hiring update [1:02:05]',
        '',
        '## Decisions',
        '- Release on Friday [2:05]',
        '',
        '## Action items',
        '- [ ] Fix the refund bug — Sameer, Thu 12 Nov [3:20]',
        '- [x] Send the deck — Unassigned',
        '',
      ].join('\n'),
    );
  });

  it('prints plain text without times, and leaves out unverified items', () => {
    const text = notesText(doc, { format: 'text', includeTimes: false });
    expect(text.startsWith('WEEKLY SYNC\n')).toBe(true);
    expect(text).toContain('\nDecisions\n- Release on Friday\n');
    expect(text).toContain('- Fix the refund bug — Sameer, Thu 12 Nov\n');
    expect(text).not.toContain('Unchecked number');
    expect(text).not.toContain('[');
  });

  it('keeps an unverified item the user edited', () => {
    const edited = { ...doc, decisions: [{ ...item('Edited', null, true), userEdited: true }] };
    expect(notesText(edited, { format: 'markdown', includeTimes: false })).toContain('- Edited');
  });

  it('names files from the title', () => {
    expect(notesFileName('Weekly sync: Q4 / plan', '2026-11-09T05:00:00Z', 'md')).toBe(
      'weekly-sync-q4-plan-2026-11-09.md',
    );
    expect(notesFileName('रिव्यू', '2026-11-09T05:00:00Z', 'txt')).toBe('meeting-2026-11-09.txt');
    expect(clockTime(59_999)).toBe('0:59');
  });
});

describe('notesText with hostile content', () => {
  it('keeps each item on one line and escapes links and HTML in Markdown', () => {
    const text = notesText(
      {
        ...doc,
        title: '# Pwned',
        decisions: [
          {
            text: 'Click [here](javascript:alert(1))\n## Fake heading <img src=x>',
            atMs: null,
            flagged: false,
            userEdited: false,
          },
        ],
      },
      { format: 'markdown', includeTimes: false },
    );
    expect(text.startsWith('# # Pwned\n')).toBe(true);
    expect(text).toContain(
      '- Click \\[here\\](javascript:alert(1)) ## Fake heading \\<img src=x\\>\n',
    );
    const plain = notesText(
      { ...doc, decisions: [{ text: 'a\nb', atMs: null, flagged: false, userEdited: false }] },
      { format: 'text', includeTimes: false },
    );
    expect(plain).toContain('- a b\n');
  });
});
