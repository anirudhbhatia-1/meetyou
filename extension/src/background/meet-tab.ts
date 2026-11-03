export const MEET_URL_PREFIX = 'https://meet.google.com/';

export function isMeetUrl(url: string | undefined): boolean {
  return url?.startsWith(MEET_URL_PREFIX) ?? false;
}
