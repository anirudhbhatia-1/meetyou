import { CONSENT_MESSAGE_AUDIO_ONLY } from '@meetyou/contracts';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_SETTINGS_KEY,
  accountSettingsFrom,
  DEFAULT_ACCOUNT_SETTINGS,
  recordVideoFrom,
  RECORD_VIDEO_KEY,
  noticeTextFor,
  videoAllowed,
} from './settings.ts';

describe('account settings cache (S4-12)', () => {
  it('falls back to the defaults before the first sync, and merges a partial cache', () => {
    expect(accountSettingsFrom({})).toEqual(DEFAULT_ACCOUNT_SETTINGS);
    expect(accountSettingsFrom({ [ACCOUNT_SETTINGS_KEY]: { offerPrompt: false } })).toEqual({
      ...DEFAULT_ACCOUNT_SETTINGS,
      offerPrompt: false,
    });
    expect(accountSettingsFrom({ [ACCOUNT_SETTINGS_KEY]: 'junk' })).toEqual(
      DEFAULT_ACCOUNT_SETTINGS,
    );
  });

  it('turns video off with "Delete after notes", and video is on unless chosen off', () => {
    expect(videoAllowed({ ...DEFAULT_ACCOUNT_SETTINGS, retentionPolicy: 'immediate' })).toBe(false);
    expect(videoAllowed({ ...DEFAULT_ACCOUNT_SETTINGS, retentionPolicy: '30d' })).toBe(true);
    expect(recordVideoFrom({})).toBe(true);
    expect(recordVideoFrom({ [RECORD_VIDEO_KEY]: false })).toBe(false);
  });
});

describe('consent notice wording (DESIGN §8.5, §19 item 20)', () => {
  it('uses the audio-only default when video is off and the text is unedited', () => {
    expect(noticeTextFor(DEFAULT_ACCOUNT_SETTINGS, true)).toBe(
      DEFAULT_ACCOUNT_SETTINGS.consentMessage,
    );
    expect(noticeTextFor(DEFAULT_ACCOUNT_SETTINGS, false)).toBe(CONSENT_MESSAGE_AUDIO_ONLY);
    const edited = { ...DEFAULT_ACCOUNT_SETTINGS, consentMessage: 'Recording for notes, ok?' };
    expect(noticeTextFor(edited, false)).toBe('Recording for notes, ok?');
  });
});
