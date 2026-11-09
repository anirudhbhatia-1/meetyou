import { newUlid, type Note, type Segment } from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import { summarySegments, type MeetingData, type TemplateId } from '@meetyou/summarizer';

/**
 * A meeting as the summarizer and "Ask this meeting" see it, read inside the caller's workspace
 * (forced RLS). Shared by the summarize job and the API so both feed the model the same data.
 */
export interface LoadedMeeting {
  data: MeetingData;
  template: TemplateId;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  summaryLanguage: 'english' | 'hindi' | 'hinglish';
}

/**
 * India-first default for the meeting's local date (relative deadlines resolve against it).
 * TODO(S4-12): the user's own time zone once Settings stores it.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** YYYY-MM-DD of `at` in `timeZone`. */
export function localDate(at: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

/** Name used for the recording user when the meeting has no self participant yet. */
const SELF_NAME = 'You';

/**
 * The recording user as a participant, so the model can make them an owner (AGENTS §3 rule 7:
 * owners come from the participant list). Created once per meeting.
 */
export async function ensureSelfParticipant(
  tx: WorkspaceTx,
  workspaceId: string,
  meetingId: string,
): Promise<void> {
  const existing = await tx
    .selectFrom('participants')
    .select('id')
    .where('meetingId', '=', meetingId)
    .where('isSelf', '=', true)
    .executeTakeFirst();
  if (existing !== undefined) return;
  await tx
    .insertInto('participants')
    .values({
      id: `prt_${newUlid()}`,
      workspaceId,
      meetingId,
      displayName: SELF_NAME,
      isSelf: true,
      // The constraint knows only Meet-observed and user-edited rows; the user is always present.
      source: 'dom',
    })
    .execute();
}

export async function loadMeeting(
  tx: WorkspaceTx,
  workspaceId: string,
  meetingId: string,
): Promise<LoadedMeeting | null> {
  const meeting = await tx
    .selectFrom('meetings')
    .select(['id', 'title', 'template', 'startedAt', 'endedAt', 'status'])
    .where('id', '=', meetingId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (meeting === undefined) return null;
  const [rows, notes, participants, settings] = await Promise.all([
    tx
      .selectFrom('transcriptSegments as s')
      .leftJoin('speakerClusters as sc', 'sc.id', 's.speakerClusterId')
      .leftJoin('participants as p', 'p.id', 'sc.participantId')
      .select([
        's.id',
        's.lane',
        's.speakerClusterId',
        's.startMs',
        's.endMs',
        's.text',
        's.flags',
        'p.displayName as speakerName',
      ])
      .where('s.meetingId', '=', meetingId)
      .orderBy('s.startMs', 'asc')
      .orderBy('s.id', 'asc')
      .execute(),
    tx
      .selectFrom('notes')
      .select(['id', 'sessionMs', 'marker', 'text'])
      .where('meetingId', '=', meetingId)
      .orderBy('order', 'asc')
      .execute(),
    tx
      .selectFrom('participants')
      .select(['id', 'displayName', 'isSelf'])
      .where('meetingId', '=', meetingId)
      .orderBy('isSelf', 'desc')
      .execute(),
    tx.selectFrom('userSettings').select('summaryLanguage').limit(1).executeTakeFirst(),
  ]);
  const selfName = participants.find((p) => p.isSelf)?.displayName ?? SELF_NAME;
  const segments: Segment[] = rows.map((s) => ({
    id: s.id,
    workspaceId,
    meetingId,
    lane: s.lane,
    ...(s.speakerClusterId !== null ? { speakerClusterId: s.speakerClusterId } : {}),
    ...(s.speakerName !== null ? { speakerName: s.speakerName } : {}),
    startMs: Number(s.startMs),
    endMs: Number(s.endMs),
    text: s.text,
    rawText: s.text,
    language: 'und',
    source: 'live',
    flags: (s.flags ?? []) as Segment['flags'],
  }));
  const endedAt = meeting.endedAt ?? meeting.startedAt;
  const noteList: Note[] = notes.map((n) => ({
    id: n.id,
    sessionMs: Number(n.sessionMs),
    marker: n.marker,
    text: n.text,
  }));
  return {
    data: {
      meeting: {
        title: meeting.title === '' ? null : meeting.title,
        date: localDate(meeting.startedAt),
        durationMs: Math.max(0, endedAt.getTime() - meeting.startedAt.getTime()),
      },
      participants: participants.map((p) => ({ id: p.id, name: p.displayName, isSelf: p.isSelf })),
      notes: noteList,
      segments: summarySegments(segments, selfName),
    },
    template: meeting.template,
    title: meeting.title,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    status: meeting.status,
    summaryLanguage: settings?.summaryLanguage ?? 'english',
  };
}
