import type { Meeting } from '@meetyou/contracts';

import { ME, meetings, participants, segments, summaries } from './fixtures.ts';
import type { ActionItemRow, LibraryApi, MeetingFilter } from './types.ts';

/**
 * In-memory API for building the UI before the real endpoints exist (S4-01; "mocks over waiting",
 * IMPLEMENTATION_PLAN §2). Same shapes as `shared/contracts`. TODO(S4-14): HTTP client for S2-09.
 */
export function createMockApi(options: { latencyMs?: number } = {}): LibraryApi {
  const latency = options.latencyMs ?? 250;
  const wait = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), latency));

  const matches = (meeting: Meeting, filter: MeetingFilter): boolean => {
    if (filter.template !== 'all' && meeting.template !== filter.template) return false;
    const q = filter.query.trim().toLowerCase();
    if (q === '') return true;
    const haystack = [
      meeting.title,
      ...meeting.participantNames,
      summaries[meeting.id]?.overview ?? '',
      ...(segments[meeting.id] ?? []).map((s) => s.text),
    ]
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  };

  const ownerName = (meetingId: string, ownerId: string | null) => {
    if (ownerId === null) return { name: 'Unassigned', self: false };
    const p = participants[meetingId]?.find((x) => x.id === ownerId);
    return {
      name: p === undefined ? 'Unassigned' : p.isSelf ? 'You' : p.displayName,
      self: p?.isSelf ?? false,
    };
  };

  return {
    me: () => wait(ME),
    listMeetings: (filter) =>
      wait(
        meetings
          .filter((m) => matches(m, filter))
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
      ),
    getMeeting: (id) => wait(meetings.find((m) => m.id === id) ?? null),
    getSummary: (id) => wait(summaries[id] ?? null),
    getSegments: (id) => wait(segments[id] ?? []),
    getParticipants: (id) => wait(participants[id] ?? []),
    listActionItems: (status) => {
      const rows: ActionItemRow[] = [];
      for (const meeting of meetings) {
        for (const item of summaries[meeting.id]?.actionItems ?? []) {
          if (status !== 'all' && item.status !== status) continue;
          const owner = ownerName(meeting.id, item.ownerParticipantId);
          rows.push({
            item,
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            ownerName: owner.name,
            ownedBySelf: owner.self,
          });
        }
      }
      return wait(rows);
    },
    setActionItemStatus: (id, status) => {
      for (const summary of Object.values(summaries)) {
        const item = summary.actionItems.find((i) => i.id === id);
        if (item !== undefined) item.status = status;
      }
      return wait(undefined);
    },
  };
}
