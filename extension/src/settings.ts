import {
  CONSENT_MESSAGE_AUDIO_ONLY,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from '@meetyou/contracts';

/**
 * Recording settings shared by the service worker, the side panel and the Meet content script.
 *
 * - `settings.recordVideo`: the panel's choice for the next recording (DESIGN §8.5). It starts from
 *   the account default and is reset to it whenever the account settings are refreshed.
 * - `settings.account`: the account's settings (DESIGN §15, S4-12), cached from `GET /v1/settings`
 *   by the service worker; pages read it from storage and react to changes.
 */
export const RECORD_VIDEO_KEY = 'settings.recordVideo';
export const ACCOUNT_SETTINGS_KEY = 'settings.account';

export function recordVideoFrom(items: Record<string, unknown>): boolean {
  return items[RECORD_VIDEO_KEY] !== false;
}

/** The account settings the extension acts on (no content, safe to keep locally). */
export type AccountSettings = Pick<
  UserSettings,
  | 'offerPrompt'
  | 'followMeetMute'
  | 'recordVideo'
  | 'videoQuality'
  | 'retentionPolicy'
  | 'consentMode'
  | 'consentMessage'
>;

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  offerPrompt: DEFAULT_USER_SETTINGS.offerPrompt,
  followMeetMute: DEFAULT_USER_SETTINGS.followMeetMute,
  recordVideo: DEFAULT_USER_SETTINGS.recordVideo,
  videoQuality: DEFAULT_USER_SETTINGS.videoQuality,
  retentionPolicy: DEFAULT_USER_SETTINGS.retentionPolicy,
  consentMode: DEFAULT_USER_SETTINGS.consentMode,
  consentMessage: DEFAULT_USER_SETTINGS.consentMessage,
};

export function toAccountSettings(s: UserSettings): AccountSettings {
  return {
    offerPrompt: s.offerPrompt,
    followMeetMute: s.followMeetMute,
    recordVideo: s.recordVideo,
    videoQuality: s.videoQuality,
    retentionPolicy: s.retentionPolicy,
    consentMode: s.consentMode,
    consentMessage: s.consentMessage,
  };
}

/** Cached settings, or the defaults before the first sync (dev builds never sync). */
export function accountSettingsFrom(items: Record<string, unknown>): AccountSettings {
  const value = items[ACCOUNT_SETTINGS_KEY];
  if (typeof value !== 'object' || value === null) return DEFAULT_ACCOUNT_SETTINGS;
  return { ...DEFAULT_ACCOUNT_SETTINGS, ...(value as Partial<AccountSettings>) };
}

/** "Delete after notes" keeps no recordings to replay, so video is off (DESIGN §15.1, ADR-0011). */
export function videoAllowed(account: AccountSettings): boolean {
  return account.retentionPolicy !== 'immediate';
}

/**
 * The consent notice for a meeting (DESIGN §8.5, §19 item 20): the user's message, or — when it is
 * still the default and video is off — the audio-only wording.
 */
export function noticeTextFor(account: AccountSettings, recordVideo: boolean): string {
  if (!recordVideo && account.consentMessage === DEFAULT_USER_SETTINGS.consentMessage) {
    return CONSENT_MESSAGE_AUDIO_ONLY;
  }
  return account.consentMessage;
}
