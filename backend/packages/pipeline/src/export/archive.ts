import {
  clockTime,
  notesFileName,
  notesText,
  type NotesDoc,
  type NotesDocItem,
} from '@meetyou/contracts';
import type { Db, WorkspaceTx } from '@meetyou/db';

import { DEFAULT_TIME_ZONE } from '../meeting-data.ts';
import type { ZipEntry } from './zip.ts';

/**
 * What "Download all my data" contains (S3-11, FR-SET-04, FEATURES L2): per meeting, the full
 * record as JSON plus notes and transcript as Markdown; account settings and vocabulary. Audio and
 * video are not included (they follow the retention setting and play from the meeting page).
 * Everything is read inside the caller's workspace (forced RLS).
 */
const encoder = new TextEncoder();
const text = (name: string, value: string): ZipEntry => ({ name, data: encoder.encode(value) });
const json = (name: string, value: unknown): ZipEntry =>
  text(name, `${JSON.stringify(value, null, 2)}\n`);

const README = `Your Minutes data
=================

account.json            Your settings and vocabulary.
meetings/<meeting>/     One folder per meeting:
  meeting.json          Everything we store for it: participants, transcript (display text and
                        the speech-to-text original), your notes, the current AI notes with the
                        transcript lines they cite, questions you asked, and the consent log.
  notes.md              The AI notes as Markdown, with times.
  transcript.md         The transcript as Markdown.

Audio and video recordings are not included.
`;

function when(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(at);
}

function length(startedAt: Date, endedAt: Date | null): string {
  if (endedAt === null) return '—';
  const minutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const dateOnly = (value: string | Date | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);

async function meetingFiles(tx: WorkspaceTx, meetingId: string): Promise<ZipEntry[]> {
  const meeting = await tx
    .selectFrom('meetings')
    .select(['id', 'platform', 'title', 'template', 'status', 'startedAt', 'endedAt'])
    .where('id', '=', meetingId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (meeting === undefined) return [];
  const [participants, segments, notes, summary, questions, consent] = await Promise.all([
    tx
      .selectFrom('participants')
      .select(['id', 'displayName', 'isSelf'])
      .where('meetingId', '=', meetingId)
      .orderBy('createdAt')
      .execute(),
    tx
      .selectFrom('transcriptSegments as s')
      .leftJoin('speakerClusters as c', 'c.id', 's.speakerClusterId')
      .leftJoin('participants as p', 'p.id', 'c.participantId')
      .select([
        's.id',
        's.lane',
        'p.displayName as speakerName',
        's.startMs',
        's.endMs',
        's.text',
        's.rawText',
        's.language',
        's.source',
        's.flags',
      ])
      .where('s.meetingId', '=', meetingId)
      .orderBy('s.startMs')
      .orderBy('s.id')
      .execute(),
    tx
      .selectFrom('notes')
      .select(['id', 'sessionMs', 'marker', 'text'])
      .where('meetingId', '=', meetingId)
      .orderBy('sessionMs')
      .execute(),
    tx
      .selectFrom('summaries')
      .select(['id', 'version', 'template', 'language', 'model', 'overview', 'createdAt'])
      .where('meetingId', '=', meetingId)
      .where('accepted', '=', true)
      .where('status', '=', 'ready')
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst(),
    tx
      .selectFrom('meetingQuestions')
      .select(['question', 'status', 'answer', 'segmentIds', 'createdAt'])
      .where('meetingId', '=', meetingId)
      .orderBy('createdAt')
      .execute(),
    tx
      .selectFrom('consentLogs')
      .select(['mode', 'outcome', 'noticeText', 'sentAt', 'createdAt'])
      .where('meetingId', '=', meetingId)
      .orderBy('createdAt')
      .execute(),
  ]);
  const items =
    summary === undefined
      ? []
      : await tx
          .selectFrom('summaryItems')
          .select([
            'id',
            'kind',
            'text',
            'anchorNoteId',
            'ownerParticipantId',
            'dueDate',
            'duePhrase',
            'status',
            'userEdited',
            'flagged',
          ])
          .where('summaryId', '=', summary.id)
          .orderBy('order')
          .execute();
  const cites =
    items.length === 0
      ? []
      : await tx
          .selectFrom('citations as c')
          .innerJoin('transcriptSegments as s', 's.id', 'c.segmentId')
          .select(['c.summaryItemId', 'c.segmentId', 's.startMs'])
          .where(
            'c.summaryItemId',
            'in',
            items.map((i) => i.id),
          )
          .orderBy('s.startMs')
          .execute();
  const citesOf = new Map<string, { segmentId: string; startMs: number }[]>();
  for (const c of cites) {
    const list = citesOf.get(c.summaryItemId) ?? [];
    list.push({ segmentId: c.segmentId, startMs: Number(c.startMs) });
    citesOf.set(c.summaryItemId, list);
  }
  const names = new Map(participants.map((p) => [p.id, p.isSelf ? 'You' : p.displayName]));
  const speaker = (s: (typeof segments)[number]) =>
    s.lane === 'me' ? 'You' : (s.speakerName ?? 'Someone');

  const folder = `meetings/${notesFileName(meeting.title, meeting.startedAt.toISOString(), 'md').replace(/\.md$/, '')}-${meeting.id}`;
  const record = {
    meeting: {
      id: meeting.id,
      platform: meeting.platform,
      title: meeting.title,
      template: meeting.template,
      status: meeting.status,
      startedAt: meeting.startedAt.toISOString(),
      endedAt: meeting.endedAt?.toISOString() ?? null,
    },
    participants: participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      isSelf: p.isSelf,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      sessionMs: Number(n.sessionMs),
      marker: n.marker,
      text: n.text,
    })),
    transcript: segments.map((s) => ({
      id: s.id,
      lane: s.lane,
      speaker: speaker(s),
      startMs: Number(s.startMs),
      endMs: Number(s.endMs),
      text: s.text,
      rawText: s.rawText,
      language: s.language,
      source: s.source,
      flags: s.flags,
    })),
    summary:
      summary === undefined
        ? null
        : {
            version: summary.version,
            template: summary.template,
            language: summary.language,
            model: summary.model,
            overview: summary.overview ?? '',
            createdAt: summary.createdAt.toISOString(),
            items: items.map((i) => ({
              id: i.id,
              kind: i.kind,
              text: i.text,
              anchorNoteId: i.anchorNoteId,
              owner:
                i.ownerParticipantId === null ? null : (names.get(i.ownerParticipantId) ?? null),
              dueDate: dateOnly(i.dueDate),
              duePhrase: i.duePhrase,
              status: i.status,
              userEdited: i.userEdited,
              unverified: i.flagged,
              citedSegmentIds: (citesOf.get(i.id) ?? []).map((c) => c.segmentId),
            })),
          },
    questions: questions.map((q) => ({
      question: q.question,
      status: q.status,
      answer: q.answer,
      citedSegmentIds: q.segmentIds,
      askedAt: q.createdAt.toISOString(),
    })),
    consentLog: consent.map((c) => ({
      mode: c.mode,
      outcome: c.outcome,
      noticeText: c.noticeText,
      at: (c.sentAt ?? c.createdAt).toISOString(),
    })),
  };

  const docItem = (i: (typeof items)[number]): NotesDocItem => ({
    text: i.text,
    atMs: citesOf.get(i.id)?.[0]?.startMs ?? null,
    flagged: i.flagged,
    userEdited: i.userEdited,
  });
  const anchors = new Map<string, NotesDocItem[]>();
  const topics: NotesDocItem[] = [];
  for (const i of items) {
    if (i.kind === 'anchor_detail' && i.anchorNoteId !== null) {
      anchors.set(i.anchorNoteId, [...(anchors.get(i.anchorNoteId) ?? []), docItem(i)]);
    } else if (i.kind === 'topic') {
      topics.push(docItem(i));
    }
  }
  const doc: NotesDoc = {
    title: meeting.title,
    when: when(meeting.startedAt),
    length: length(meeting.startedAt, meeting.endedAt),
    overview: summary?.overview ?? '',
    sections: [
      ...notes.map((n) => ({ heading: n.text, items: anchors.get(n.id) ?? [] })),
      ...(topics.length > 0 ? [{ heading: null, items: topics }] : []),
    ],
    decisions: items.filter((i) => i.kind === 'decision').map(docItem),
    actionItems: items
      .filter((i) => i.kind === 'action_item')
      .map((i) => ({
        ...docItem(i),
        done: i.status === 'done',
        owner: i.ownerParticipantId === null ? null : (names.get(i.ownerParticipantId) ?? null),
        due: dateOnly(i.dueDate) ?? i.duePhrase,
      })),
    questions: items.filter((i) => i.kind === 'question').map(docItem),
  };
  const title = meeting.title.trim() === '' ? 'Untitled meeting' : meeting.title.trim();
  const transcript = [
    `# ${title} — transcript`,
    `${doc.when} · ${doc.length}`,
    '',
    ...segments
      .filter((s) => !(s.flags ?? []).includes('echo'))
      .map((s) => `**[${clockTime(Number(s.startMs))}] ${speaker(s)}:** ${s.text}`),
  ].join('\n\n');

  return [
    json(`${folder}/meeting.json`, record),
    text(`${folder}/notes.md`, notesText(doc, { format: 'markdown', includeTimes: true })),
    text(`${folder}/transcript.md`, `${transcript}\n`),
  ];
}

/** All files of one export, meeting by meeting (one short transaction each). */
export async function buildArchive(
  db: Db,
  workspaceId: string,
  userId: string,
  exportedAt: Date,
): Promise<{ entries: ZipEntry[]; meetingCount: number }> {
  const { meetingIds, account } = await db.inWorkspace(workspaceId, async (tx) => {
    const [meetings, settings, glossary] = await Promise.all([
      tx
        .selectFrom('meetings')
        .select('id')
        .where('deletedAt', 'is', null)
        .orderBy('startedAt')
        .execute(),
      tx.selectFrom('userSettings').selectAll().where('userId', '=', userId).executeTakeFirst(),
      tx.selectFrom('glossaryTerms').select('term').orderBy('createdAt').orderBy('id').execute(),
    ]);
    const {
      id: _id,
      workspaceId: _ws,
      userId: _user,
      createdAt: _c,
      updatedAt: _u,
      ...rest
    } = settings ?? ({} as Record<string, unknown>);
    return {
      meetingIds: meetings.map((m) => m.id),
      account: {
        exportedAt: exportedAt.toISOString(),
        meetingCount: meetings.length,
        settings: settings === undefined ? null : rest,
        vocabulary: glossary.map((g) => g.term),
      },
    };
  });
  const entries: ZipEntry[] = [text('README.txt', README), json('account.json', account)];
  for (const meetingId of meetingIds) {
    entries.push(...(await db.inWorkspace(workspaceId, (tx) => meetingFiles(tx, meetingId))));
  }
  return { entries, meetingCount: meetingIds.length };
}
