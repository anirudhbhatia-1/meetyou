import {
  ActionItemList,
  AskQuestionResponse,
  MeResponse,
  Meeting,
  MeetingList,
  MeetingProgress,
  MeetingQuestionsResponse,
  MeetingSummaryResponse,
  Segment,
  VideoPlaybackResponse,
  type SummaryItem,
  type SummaryVersion,
} from '@meetyou/contracts';

import type { WebAuth } from './auth.ts';
import type { LibraryApi, MeetingFilter, MeetingSummary } from './types.ts';

const SETTLED = new Set(['ready', 'updated', 'failed', 'too_short']);

/** A stored summary version as the Notes tab reads it (DESIGN §12.4). */
function toMeetingSummary(body: MeetingSummaryResponse): MeetingSummary | null {
  const v: SummaryVersion | null = body.current;
  if (v === null) return null;
  const of = (kind: SummaryItem['kind']) => v.items.filter((i) => i.kind === kind);
  return {
    summaryId: v.id,
    version: v.version,
    template: v.template,
    candidate:
      body.candidate === null
        ? null
        : { version: body.candidate.version, template: body.candidate.template },
    overview: v.overview,
    sections: body.notes.map((note) => ({
      note,
      items: v.items.filter((i) => i.kind === 'anchor_detail' && i.anchorNoteId === note.id),
    })),
    decisions: of('decision'),
    questions: of('question'),
    actionItems: of('action_item'),
  };
}

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

    async getSummary(id) {
      const body = await get(`/v1/meetings/${encodeURIComponent(id)}/summary`);
      return body === null ? null : toMeetingSummary(MeetingSummaryResponse.parse(body));
    },

    async getSegments(id) {
      const body = await get(`/v1/meetings/${encodeURIComponent(id)}/segments`);
      if (body === null) return [];
      const items = (body as { items?: unknown[] }).items ?? [];
      // The API sends unset optional fields as null; the contract models them as absent.
      return items.map((raw) => Segment.parse(withoutNulls(raw)));
    },

    async getParticipants(id) {
      const body = await get(`/v1/meetings/${encodeURIComponent(id)}/summary`);
      return body === null ? [] : MeetingSummaryResponse.parse(body).participants;
    },

    async listActionItems(status) {
      // TODO(S4-09): follow `nextCursor`; the first 100 cover alpha.
      const list = ActionItemList.parse(await get(`/v1/action-items?status=${status}&limit=100`));
      return list.items.map(({ meetingId, meetingTitle, ownerName, ownerIsSelf, ...item }) => ({
        item: {
          id: item.id,
          kind: item.kind,
          text: item.text,
          anchorNoteId: item.anchorNoteId,
          ownerParticipantId: item.ownerParticipantId,
          dueDate: item.dueDate,
          duePhrase: item.duePhrase,
          status: item.status,
          segmentIds: item.segmentIds,
          userEdited: item.userEdited,
          flagged: item.flagged,
        },
        meetingId,
        meetingTitle,
        ownerName: ownerIsSelf ? 'You' : (ownerName ?? 'Unassigned'),
        ownedBySelf: ownerIsSelf,
      }));
    },

    async setActionItemStatus(id, status) {
      const res = await auth.authorized(`/v1/summary-items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`action item update failed (${res.status})`);
    },

    async regenerateSummary(meetingId, template) {
      const res = await auth.authorized(
        `/v1/meetings/${encodeURIComponent(meetingId)}/summary:regenerate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ template }),
        },
      );
      if (res.status !== 202) throw new Error(`regenerate failed (${res.status})`);
    },

    async keepSummary(meetingId, version) {
      const res = await auth.authorized(
        `/v1/meetings/${encodeURIComponent(meetingId)}/summary:keep`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version }),
        },
      );
      if (res.status !== 204) throw new Error(`keep failed (${res.status})`);
    },

    async discardSummary(meetingId, version) {
      const res = await auth.authorized(
        `/v1/meetings/${encodeURIComponent(meetingId)}/summary:discard`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version }),
        },
      );
      if (res.status !== 204) throw new Error(`go back failed (${res.status})`);
    },

    async sendFeedback(summaryId, useful, comment) {
      const res = await auth.authorized('/v1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'summary',
          targetId: summaryId,
          rating: useful ? 1 : -1,
          ...(comment !== undefined && comment.trim() !== '' ? { comment } : {}),
        }),
      });
      if (res.status !== 201) throw new Error(`feedback failed (${res.status})`);
    },

    watchProgress(meetingId, onProgress) {
      // Server-sent events over fetch (EventSource cannot send the access token). The API ends
      // each stream before Cloud Run's 60 s timeout; this reconnects until the meeting settles.
      const controller = new AbortController();
      let stopped = false;
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      void (async () => {
        while (!stopped) {
          try {
            const res = await auth.authorized(
              `/v1/meetings/${encodeURIComponent(meetingId)}/events`,
              { headers: { accept: 'text/event-stream' }, signal: controller.signal },
            );
            if (!res.ok || res.body === null) {
              await pause(5_000);
              continue;
            }
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = '';
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += value;
              let end;
              while ((end = buffer.indexOf('\n\n')) >= 0) {
                const data = buffer
                  .slice(0, end)
                  .split('\n')
                  .find((line) => line.startsWith('data: '));
                buffer = buffer.slice(end + 2);
                if (data === undefined) continue;
                const progress = MeetingProgress.safeParse(JSON.parse(data.slice(6)));
                if (!progress.success) continue;
                onProgress(progress.data);
                if (SETTLED.has(progress.data.status)) stopped = true;
              }
            }
          } catch {
            if (stopped) return;
            await pause(3_000);
          }
        }
      })();
      return () => {
        stopped = true;
        controller.abort();
      };
    },

    async getVideo(meetingId, options) {
      const query = options?.download === true ? '?download=1' : '';
      const body = await get(`/v1/meetings/${encodeURIComponent(meetingId)}/video${query}`);
      return body === null ? null : VideoPlaybackResponse.parse(body);
    },

    async listQuestions(meetingId) {
      const body = await get(`/v1/meetings/${encodeURIComponent(meetingId)}/questions`);
      return body === null ? null : MeetingQuestionsResponse.parse(body);
    },

    async askQuestion(meetingId, question) {
      const res = await auth.authorized(`/v1/meetings/${encodeURIComponent(meetingId)}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        // The browser's time zone, so start and end times are answered in local time.
        body: JSON.stringify({
          question,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (res.ok) return { ok: true, ...AskQuestionResponse.parse(await res.json()) };
      if (res.status === 429) return { ok: false, error: 'rate_limited' };
      if (res.status === 409) return { ok: false, error: 'no_transcript' };
      if (res.status === 503) return { ok: false, error: 'unavailable' };
      return { ok: false, error: 'failed' };
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
