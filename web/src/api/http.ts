import {
  MeResponse,
  Meeting,
  MeetingList,
  Segment,
  VideoPlaybackResponse,
} from '@meetyou/contracts';

import type { WebAuth } from './auth.ts';
import type { LibraryApi, MeetingFilter } from './types.ts';

/**
 * The library API over HTTP (S4-14, ARCHITECTURE §12.1). Paths are same-origin: the web server
 * proxies `/v1` to the API. Responses are validated with the shared contracts (§12.2).
 */
export function createHttpApi(auth: WebAuth): LibraryApi {
  const get = async (path: string): Promise<unknown> => {
    const res = await auth.authorized(path, { headers: { accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
    return res.json();
  };

  return {
    async me() {
      const me = MeResponse.parse(await get('/v1/me'));
      const firstName = me.displayName.split(/\s+/)[0] ?? me.displayName;
      return { firstName, email: me.email };
    },

    async listMeetings(filter: MeetingFilter) {
      // TODO(S4-09): follow `nextCursor` (infinite scroll); the first 100 cover alpha.
      const query = new URLSearchParams({ limit: '100' });
      if (filter.template !== 'all') query.set('template', filter.template);
      const items = MeetingList.parse(await get(`/v1/meetings?${query.toString()}`)).items;
      // TODO(S3-09): server search (`q`, then /v1/search); until then title and people only.
      const words = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return items.filter((m) => {
        const haystack = [m.title, ...m.participantNames].join(' ').toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    },

    async getMeeting(id) {
      const body = await get(`/v1/meetings/${encodeURIComponent(id)}`);
      return body === null ? null : Meeting.parse(body);
    },

    // TODO(S3-08): GET /v1/meetings/{id}/summary once summaries are generated on the server.
    getSummary: () => Promise.resolve(null),

    async getSegments(id) {
      const body = await get(`/v1/meetings/${encodeURIComponent(id)}/segments`);
      if (body === null) return [];
      const items = (body as { items?: unknown[] }).items ?? [];
      // The API sends unset optional fields as null; the contract models them as absent.
      return items.map((raw) => Segment.parse(withoutNulls(raw)));
    },

    // TODO(S3-08): participants come with the summary DTO (owners of action items).
    getParticipants: () => Promise.resolve([]),
    // TODO(S3-08): GET /v1/action-items.
    listActionItems: () => Promise.resolve([]),
    setActionItemStatus: () =>
      Promise.reject(new Error('Action items arrive with server summaries (S3-08)')),

    async getVideo(meetingId, options) {
      const query = options?.download === true ? '?download=1' : '';
      const body = await get(`/v1/meetings/${encodeURIComponent(meetingId)}/video${query}`);
      return body === null ? null : VideoPlaybackResponse.parse(body);
    },

    signOut: () => auth.signOut(),

    async deleteMeeting(id) {
      const res = await auth.authorized(`/v1/meetings/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`meeting delete failed (${res.status})`);
    },

    async restoreMeeting(id) {
      const res = await auth.authorized(`/v1/meetings/${encodeURIComponent(id)}:restore`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`meeting restore failed (${res.status})`);
    },

    async deleteAccount() {
      // The web header lets the API clear the refresh cookie with the account.
      const res = await auth.authorized('/v1/account:delete', {
        method: 'POST',
        headers: { 'x-minutes-client': 'web' },
      });
      if (res.status !== 202) throw new Error(`account delete failed (${res.status})`);
    },
  };
}

function withoutNulls(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
}
