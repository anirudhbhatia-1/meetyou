export const MEET_URL_PREFIX = 'https://meet.google.com/';

export function isMeetUrl(url: string | undefined): boolean {
  return url?.startsWith(MEET_URL_PREFIX) ?? false;
}

const MEETING_CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/i;

/** Meeting code of a Meet call URL (e.g. "abc-defg-hij"), or null for Meet home and other pages. */
export function meetingCodeOf(url: string | undefined): string | null {
  if (!isMeetUrl(url) || url === undefined) return null;
  const match = MEETING_CODE.exec(new URL(url).pathname);
  return match?.[1]?.toLowerCase() ?? null;
}
