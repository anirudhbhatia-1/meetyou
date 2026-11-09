import { describe, expect, it } from 'vitest';

import {
  meetingFromNotificationId,
  notesNotice,
  notesNotificationId,
  parseNotesWatch,
} from './notes-watch.ts';

describe('notes-ready notification (DESIGN §8.7)', () => {
  it('says nothing while the notes are still being written', () => {
    for (const status of ['recording', 'processing', 'deleted']) {
      expect(notesNotice(status, 'Weekly sync')).toBeNull();
    }
  });

  it('names the meeting once its notes settle, shortening long titles', () => {
    expect(notesNotice('ready', 'Weekly sync')?.title).toBe('Notes ready: Weekly sync');
    expect(notesNotice('updated', 'Weekly sync')?.title).toBe('Notes ready: Weekly sync');
    expect(notesNotice('too_short', 'x')?.message).toContain('transcript is saved');
    const long = notesNotice('ready', 'a'.repeat(200))?.title ?? '';
    expect(long.length).toBeLessThanOrEqual('Notes ready: '.length + 80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('round-trips the meeting through the notification ID', () => {
    expect(meetingFromNotificationId(notesNotificationId('m1'))).toBe('m1');
    expect(meetingFromNotificationId('other')).toBeNull();
    expect(meetingFromNotificationId('notes:')).toBeNull();
  });

  it('reads back only a well-formed watch', () => {
    expect(parseNotesWatch({ meetingId: 'm1', since: 5 })).toEqual({ meetingId: 'm1', since: 5 });
    expect(parseNotesWatch({ meetingId: '', since: 5 })).toBeNull();
    expect(parseNotesWatch(null)).toBeNull();
  });
});
