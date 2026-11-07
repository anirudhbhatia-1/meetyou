import { ASK_LIMITS, type Meeting } from '@meetyou/contracts';

import { ME, meetings, participants, segments, summaries } from './fixtures.ts';
import type { ActionItemRow, LibraryApi, MeetingFilter, MeetingQuestion } from './types.ts';

/**
 * In-memory API for building the UI before the real endpoints exist (S4-01; "mocks over waiting",
 * IMPLEMENTATION_PLAN §2). Same shapes as `shared/contracts`. `http.ts` is the real client.
 */
export function createMockApi(options: { latencyMs?: number } = {}): LibraryApi {
  const latency = options.latencyMs ?? 250;
  const wait = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), latency));

  /** Soft-deleted in this session (undo brings them back). */
  const deleted = new Set<string>();
  /** Asked in this session, per meeting (DESIGN §12.7). */
  const asked = new Map<string, MeetingQuestion[]>();
  const usage = () => {
    const all = [...asked.values()].flat();
    const hourAgo = Date.now() - 60 * 60 * 1000;
    return {
      usedLastHour: all.filter((q) => Date.parse(q.createdAt) >= hourAgo).length,
      usedLastDay: all.length,
      perHour: ASK_LIMITS.perHour,
      perDay: ASK_LIMITS.perDay,
    };
  };

  const matches = (meeting: Meeting, filter: MeetingFilter): boolean => {
    if (deleted.has(meeting.id)) return false;
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
    getMeeting: (id) => wait(deleted.has(id) ? null : (meetings.find((m) => m.id === id) ?? null)),
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
    listQuestions: (id) => wait({ items: asked.get(id) ?? [], usage: usage() }),
    askQuestion: (id, question) => {
      // Mock rule: a question mentioning a word from the transcript is answered from that line;
      // "poem", "code" or "weather" is off-topic; anything else is not in the meeting.
      if (usage().usedLastHour >= ASK_LIMITS.perHour) {
        return wait({ ok: false as const, error: 'rate_limited' as const });
      }
      const words = question.toLowerCase().match(/[a-z]{5,}/g) ?? [];
      const hit = (segments[id] ?? []).find((s) =>
        words.some((w) => s.text.toLowerCase().includes(w)),
      );
      const offTopic = /poem|code|weather/i.test(question);
      const q: MeetingQuestion = {
        id: `qst_mock_${Date.now()}`,
        question,
        status: offTopic ? 'off_topic' : hit === undefined ? 'not_in_meeting' : 'answered',
        answer: offTopic || hit === undefined ? null : hit.text,
        citations:
          offTopic || hit === undefined ? [] : [{ segmentId: hit.id, startMs: hit.startMs }],
        createdAt: new Date().toISOString(),
      };
      asked.set(id, [...(asked.get(id) ?? []), q]);
      return wait({ ok: true as const, question: q, usage: usage() });
    },
    // Fixtures have no video file to play; the player shows only against the real API.
    getVideo: () => wait(null),
    signOut: () => wait(undefined),
    deleteAccount: () => wait(undefined),
    deleteMeeting: (id) => {
      deleted.add(id);
      return wait(undefined);
    },
    restoreMeeting: (id) => {
      deleted.delete(id);
      return wait(undefined);
    },
  };
}
