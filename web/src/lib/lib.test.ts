import { describe, expect, it } from 'vitest';

import { createMockApi } from '../api/mock.ts';
import { numberCitations } from './citations.ts';
import {
  segmentLang,
  formatClock,
  formatDue,
  formatLength,
  formatWhen,
  greeting,
  recordingLabel,
} from './format.ts';
import { href, parseRoute } from './router.ts';

describe('format (DESIGN §10–§14)', () => {
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 10, 6, 9), 'Asha')).toBe('Good morning, Asha');
    expect(greeting(new Date(2026, 10, 6, 13), 'Asha')).toBe('Good afternoon, Asha');
    expect(greeting(new Date(2026, 10, 6, 19), 'Asha')).toBe('Good evening, Asha');
  });

  it('formats when, length, clock and recording label', () => {
    const now = new Date(2026, 10, 6, 15, 0);
    expect(formatWhen(new Date(2026, 10, 6, 9, 5).toISOString(), now)).toBe('Today 09:05');
    expect(formatWhen(new Date(2026, 10, 5, 16, 30).toISOString(), now)).toBe('Yesterday 16:30');
    expect(formatLength('2026-11-06T09:00:00Z', '2026-11-06T10:05:00Z')).toBe('1 h 05 min');
    expect(formatLength('2026-11-06T09:00:00Z', null)).toBe('—');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(recordingLabel(new Date(2026, 10, 11, 15).toISOString(), now)).toBe(
      'Recording 5 days left',
    );
    expect(recordingLabel(new Date(2026, 10, 1).toISOString(), now)).toBe('Recording deleted');
  });

  it('shows a resolved due date, else the phrase as said', () => {
    expect(formatDue({ dueDate: '2026-11-08', duePhrase: 'Thursday tak' })).toBe('Sun 8 Nov');
    expect(formatDue({ dueDate: null, duePhrase: 'this week' })).toBe('this week');
    expect(formatDue({ dueDate: null, duePhrase: null })).toBe('No due date');
  });
});

describe('segmentLang (DESIGN §20)', () => {
  it('marks Roman Hindi as hi-Latn and leaves unknown text to the page', () => {
    expect(segmentLang('hi', 'Haan, Friday tak ho jayega')).toBe('hi-Latn');
    expect(segmentLang('hi', 'हाँ, शुक्रवार तक')).toBe('hi');
    expect(segmentLang('en', 'Sounds good')).toBe('en');
    expect(segmentLang('und', 'hmm')).toBeUndefined();
  });
});

describe('router', () => {
  it('round-trips every screen', () => {
    for (const hash of [
      '#/',
      '#/meetings',
      '#/meetings/mtg_1',
      '#/meetings/mtg_1/transcript',
      '#/meetings/mtg_1/ask',
      '#/action-items',
      '#/settings',
    ]) {
      expect(href(parseRoute(hash))).toBe(hash);
    }
    expect(parseRoute('#/nonsense')).toEqual({ screen: 'home' });
  });
});

describe('mock API and citations', () => {
  it('searches across titles, people and transcript text, and filters by template', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const hit = await api.listMeetings({ query: 'payments', template: 'all' });
    expect(hit.meetings.map((m) => m.id)).toEqual(['mtg_q4_launch']);
    const standups = await api.listMeetings({ query: '', template: 'standup' });
    expect(standups.meetings.map((m) => m.id)).toEqual(['mtg_standup']);
  });

  it('numbers citations in reading order and marks action items done', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const summary = await api.getSummary('mtg_q4_launch');
    if (summary === null) throw new Error('fixture missing');
    const numbers = numberCitations(summary);
    expect(numbers.get('itm_1')).toBe(1);
    expect(numbers.get('itm_2')).toBe(2);
    expect(Math.max(...numbers.values())).toBe(numbers.size);

    const before = (await api.listActionItems('open')).length;
    await api.setActionItemStatus('itm_9', 'done');
    expect((await api.listActionItems('open')).length).toBe(before - 1);
  });
});

describe('Ask this meeting (mock API, DESIGN §12.7)', () => {
  it('answers from a transcript line with its citation, refuses off-topic, and lists history', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const answered = await api.askQuestion('mtg_q4_launch', 'When is the payments flow fixed?');
    expect(answered).toMatchObject({ ok: true, question: { status: 'answered' } });
    if (!answered.ok) throw new Error('expected an answer');
    expect(answered.question.citations).toHaveLength(1);
    const refused = await api.askQuestion('mtg_q4_launch', 'Write me a poem');
    expect(refused).toMatchObject({ ok: true, question: { status: 'off_topic', answer: null } });
    const missing = await api.askQuestion('mtg_q4_launch', 'Who won the cricket match?');
    expect(missing).toMatchObject({ ok: true, question: { status: 'not_in_meeting' } });
    const history = await api.listQuestions('mtg_q4_launch');
    expect(history?.items.map((q) => q.status)).toEqual([
      'answered',
      'off_topic',
      'not_in_meeting',
    ]);
    expect(history?.usage).toMatchObject({ usedLastHour: 3, perHour: 30 });
    expect((await api.listQuestions('mtg_standup'))?.items).toEqual([]);
  });
});
