import { newUlid, type SummaryOutput } from '@meetyou/contracts';
import { describe, expect, it } from 'vitest';

import { resolveDuePhrase, validIsoDate } from './due-date.ts';
import type { SummarySegment } from './input.ts';
import { numbersIn, validateSummary } from './validate.ts';

// 2026-11-07 is a Saturday.
const DATE = '2026-11-07';

describe('resolveDuePhrase (S3-02, §10.2 step 5)', () => {
  it.each([
    ['aaj', '2026-11-07'],
    ['by EOD', '2026-11-07'],
    ['kal tak', '2026-11-08'],
    ['tomorrow', '2026-11-08'],
    ['parso', '2026-11-09'],
    ['Friday tak', '2026-11-13'],
    ['by Monday', '2026-11-09'],
    ['shukravar ko', '2026-11-13'],
    ['3 din mein', '2026-11-10'],
    ['within 10 days', '2026-11-17'],
    ['end of month', '2026-11-30'],
    ['is hafte', '2026-11-13'],
    ['15 Nov', '2026-11-15'],
    ['Nov 15th', '2026-11-15'],
    ['5 Jan', '2027-01-05'],
    ['20/11', '2026-11-20'],
  ])('%s → %s', (phrase, expected) => {
    expect(resolveDuePhrase(phrase, DATE)).toBe(expected);
  });

  it.each(['next Friday', 'agle hafte kabhi', 'soon', 'jaldi', '31 Feb', ''])(
    'leaves "%s" unresolved',
    (phrase) => {
      expect(resolveDuePhrase(phrase, DATE)).toBeNull();
    },
  );

  it('a weekday said on that weekday means next week', () => {
    expect(resolveDuePhrase('Saturday', DATE)).toBe('2026-11-14');
  });

  it('checks real calendar dates', () => {
    expect(validIsoDate('2026-02-29')).toBeNull();
    expect(validIsoDate('2028-02-29')).toBe('2028-02-29');
    expect(validIsoDate('tomorrow')).toBeNull();
  });
});

const seg = (text: string, startMs: number, echo = false): SummarySegment => ({
  id: `seg_${newUlid()}`,
  startMs,
  endMs: startMs + 2_000,
  speaker: 'Rishi',
  text,
  echo,
});

describe('validateSummary (S3-02)', () => {
  const s1 = seg('Price is 40,000 rupees per month.', 5_000);
  const s2 = seg('Okay, decision: release Friday tak move karte hain.', 1_000);
  const echo = seg('Release Friday tak move.', 1_500, true);
  const ctx = {
    segments: [s1, s2, echo],
    participants: [
      { id: 'prt_self', name: 'Aman', isSelf: true },
      { id: 'prt_rishi', name: 'Rishi', isSelf: false },
    ],
    notes: [{ id: 'note_1', sessionMs: 0, marker: null, text: 'pricing' }],
    meetingDate: DATE,
  };
  const output: SummaryOutput = {
    title: '  Pricing call ',
    overview: 'Pricing and release.',
    anchored_sections: [
      { note_id: 'note_1', details: [{ text: 'Price is 40,000 per month', segment_ids: [s1.id] }] },
      { note_id: 'note_unknown', details: [{ text: 'x', segment_ids: [s1.id] }] },
    ],
    decisions: [{ text: 'Release moves to Friday', segment_ids: [s1.id, s2.id, s2.id, echo.id] }],
    action_items: [
      {
        task: 'Send the quote',
        owner_participant_id: 'prt_rishi',
        due_date: null,
        due_phrase: 'kal tak',
        segment_ids: [s1.id],
      },
      {
        task: 'Book 3 rooms',
        owner_participant_id: 'Rishi Kumar',
        due_date: '2026-11-20',
        due_phrase: 'next Friday',
        segment_ids: [s2.id],
      },
      {
        task: 'Follow up',
        owner_participant_id: 'unassigned',
        due_date: null,
        due_phrase: null,
        segment_ids: [`seg_${newUlid()}`],
      },
    ],
    open_questions: [{ text: 'Discount?', segment_ids: [echo.id] }],
    topics: ['pricing', ' '],
  };
  const v = validateSummary(output, ctx);
  const byText = (t: string) => v.items.find((i) => i.text === t);

  it('keeps only real, non-echo citations, deduplicated in transcript order', () => {
    expect(byText('Release moves to Friday')?.segmentIds).toEqual([s2.id, s1.id]);
    expect(v.report.citationsDropped).toBe(3); // the echo twice, the invented one once
  });

  it('flags items left without a valid citation, and numbers absent from cited lines', () => {
    expect(byText('Follow up')?.flagged).toBe(true);
    expect(byText('Discount?')?.flagged).toBe(true);
    expect(byText('Book 3 rooms')?.flagged).toBe(true);
    expect(byText('Price is 40,000 per month')?.flagged).toBe(false);
    expect(byText('Send the quote')?.flagged).toBe(false);
  });

  it('allows owners from the participant list only', () => {
    expect(byText('Send the quote')?.ownerParticipantId).toBe('prt_rishi');
    expect(byText('Book 3 rooms')?.ownerParticipantId).toBeNull();
    expect(byText('Follow up')?.ownerParticipantId).toBeNull();
    expect(v.report.ownersUnassigned).toBe(1);
  });

  it('resolves spoken deadlines in code and keeps valid model dates', () => {
    expect(byText('Send the quote')).toMatchObject({ dueDate: '2026-11-08', duePhrase: 'kal tak' });
    expect(byText('Book 3 rooms')).toMatchObject({ dueDate: '2026-11-20' });
    expect(v.report.datesResolved).toBe(1);
  });

  it('drops sections for notes that do not exist, and empty topics', () => {
    expect(v.report.unknownNotes).toBe(1);
    expect(v.items.filter((i) => i.kind === 'anchor_detail')).toHaveLength(1);
    expect(v.items.filter((i) => i.kind === 'topic').map((i) => i.text)).toEqual(['pricing']);
  });

  it('orders items as they will be shown and trims text', () => {
    expect(v.title).toBe('Pricing call');
    expect(v.items.map((i) => i.order)).toEqual(v.items.map((_, i) => i));
    expect(v.items[0]?.kind).toBe('anchor_detail');
  });

  it('normalises numbers', () => {
    expect(numbersIn('40,000 rupees, 1.5 hours, item 3.')).toEqual(['40000', '1.5', '3']);
  });
});
