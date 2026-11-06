/**
 * Local recording settings shared by the service worker and the side panel.
 * `recordVideo` is chosen in the panel's recording options (DESIGN §8.5) and read at start; ADR-0011
 * default is on. TODO(S4-12): Settings (§15.1) stores the account default on the server and the
 * panel choice applies to one meeting only.
 */
export const RECORD_VIDEO_KEY = 'settings.recordVideo';

export function recordVideoFrom(items: Record<string, unknown>): boolean {
  return items[RECORD_VIDEO_KEY] !== false;
}
