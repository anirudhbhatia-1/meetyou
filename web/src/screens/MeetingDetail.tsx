import {
  notesFileName,
  notesText,
  type Meeting,
  type Segment,
  type SummaryItem,
} from '@meetyou/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { MeetingSummary, Participant } from '../api/types.ts';
import {
  Icon,
  useToast,
  Banner,
  Button,
  Card,
  Checkbox,
  CitationChip,
  SkeletonRows,
} from '@meetyou/ui';
import { useApi } from '../lib/api-context.ts';
import { numberCitations } from '../lib/citations.ts';
import { saveTextFile, toNotesDoc } from '../lib/notes-doc.ts';
import {
  formatClock,
  formatDue,
  formatLength,
  formatWhen,
  meetingTitle,
  recordingLabel,
  TEMPLATE_LABEL,
} from '../lib/format.ts';
import { href, navigate, type DetailTab } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';
import { AskTab, type AskCitation } from './AskTab.tsx';
import { MoreMenu, useDeleteMeeting } from './MeetingMenu.tsx';
import {
  CandidateBanner,
  ImprovedBanner,
  NotesFeedback,
  TemplateMenu,
} from './SummaryControls.tsx';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer.tsx';

const TAB_LABEL: Record<DetailTab, string> = {
  notes: 'Notes',
  transcript: 'Transcript',
  ask: 'Ask',
};

/** DESIGN §12 */
export function MeetingDetail({
  meetingId,
  tab,
  onActionsChanged,
}: {
  meetingId: string;
  tab: DetailTab;
  onActionsChanged: () => void;
}) {
  const api = useApi();
  const now = new Date();
  const meeting = useAsync(() => api.getMeeting(meetingId), [meetingId]);
  const summary = useAsync(() => api.getSummary(meetingId), [meetingId]);
  const segments = useAsync(() => api.getSegments(meetingId), [meetingId]);
  const people = useAsync(() => api.getParticipants(meetingId), [meetingId]);
  const [selected, setSelected] = useState<SummaryItem | null>(null);
  // An answer's citation (Ask tab); the newest pick, note or answer, fills the citation card.
  const [askCite, setAskCite] = useState<AskCitation | null>(null);
  const [playFrom, setPlayFrom] = useState<number | null>(null);
  const remove = useDeleteMeeting({
    deleted: () => navigate({ screen: 'meetings' }),
    restored: (id) => navigate({ screen: 'detail', meetingId: id, tab: 'notes' }),
  });
  const toast = useToast();
  // Template being rewritten (DESIGN §12.2); the notes fade until the new version arrives.
  const [rewriting, setRewriting] = useState<Meeting['template'] | null>(null);

  // S3-03: while the notes are being written, follow progress and refresh once they are ready.
  const status = meeting.data?.status;
  useEffect(() => {
    if (status !== 'processing') return undefined;
    return api.watchProgress(meetingId, (p) => {
      if (p.status !== 'processing') {
        meeting.reload();
        summary.reload();
        people.reload();
      }
    });
    // Reload functions change identity each render; status and meeting decide when to follow.
  }, [status, meetingId]);

  // Regenerate: look for the candidate every 3 s, give up after 2 minutes.
  const candidate = summary.data?.candidate ?? null;
  useEffect(() => {
    if (rewriting === null) return undefined;
    if (candidate !== null) {
      setRewriting(null);
      return undefined;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) {
        setRewriting(null);
        toast({ message: 'Couldn’t rewrite the notes. Try again.' });
        return;
      }
      summary.reload();
    }, 3_000);
    return () => clearInterval(timer);
  }, [rewriting, candidate]);

  const m = meeting.data;
  if (meeting.loading && m === undefined) {
    return (
      <div className="page">
        <SkeletonRows rows={4} />
      </div>
    );
  }
  if (m === null || m === undefined) {
    return (
      <div className="page">
        <Banner tone="error">This meeting was not found. It may have been deleted.</Banner>
        <Button variant="ghost" onClick={() => navigate({ screen: 'meetings' })}>
          Back to Meetings
        </Button>
      </div>
    );
  }

  const rec = recordingLabel(m.recordingExpiresAt, now);
  return (
    <div className="detail">
      {remove.alert}
      <div className="toolbar glass-bar">
        <Button variant="ghost" onClick={() => navigate({ screen: 'meetings' })}>
          <Icon name="chevron-left" /> Meetings
        </Button>
        <span className="toolbar-title">{meetingTitle(m)}</span>
        <div className="toolbar-actions">
          <TemplateMenu
            current={summary.data?.template ?? m.template}
            disabled={summary.data == null || rewriting !== null || candidate !== null}
            onPick={(template) => {
              void api
                .regenerateSummary(meetingId, template)
                .then(() => setRewriting(template))
                .catch(() => toast({ message: 'Couldn’t rewrite the notes. Try again.' }));
            }}
          />
          {/* TODO(S4-10): share sheet (§13.1). */}
          <Button variant="primary" disabled title="Share sheet comes with S4-10">
            Share
          </Button>
          <MoreMenu
            onDelete={() => remove.request(meetingId)}
            {...(summary.data != null
              ? {
                  onDownload: () => {
                    const notes = summary.data;
                    if (notes == null) return;
                    const doc = toNotesDoc(m, notes, segments.data ?? [], people.data ?? []);
                    saveTextFile(
                      notesFileName(meetingTitle(m), m.startedAt, 'md'),
                      notesText(doc, { format: 'markdown', includeTimes: true }),
                    );
                  },
                }
              : {})}
          />
        </div>
      </div>
      <div className="page detail-page">
        <header>
          <p className="meta">
            {formatWhen(m.startedAt, now)} · {formatLength(m.startedAt, m.endedAt)} ·{' '}
            {m.participantNames.length === 0 ? 'You' : `${m.participantNames.join(', ')} and you`}
            {rec !== null && ` · ${rec}`}
          </p>
          <h1 className="meeting-title">{meetingTitle(m)}</h1>
        </header>
        <>
          <div className="tabs" role="tablist" aria-label="Meeting">
            {(m.status === 'recording'
              ? (['notes', 'transcript'] as const)
              : (['notes', 'transcript', 'ask'] as const)
            ).map((t) => (
              <a
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`tab ${tab === t ? 'tab-on' : ''}`}
                href={href({ screen: 'detail', meetingId, tab: t })}
              >
                {TAB_LABEL[t]}
              </a>
            ))}
          </div>
          {m.status === 'updated' && (
            <ImprovedBanner
              meetingId={meetingId}
              onSeeChanges={() => navigate({ screen: 'detail', meetingId, tab: 'transcript' })}
            />
          )}
          {candidate !== null && tab === 'notes' && (
            <CandidateBanner
              onKeep={() => {
                void api.keepSummary(meetingId, candidate.version).then(() => {
                  summary.reload();
                  toast({ message: `Rewritten as ${TEMPLATE_LABEL[candidate.template]} notes` });
                });
              }}
              onGoBack={() => {
                void api.discardSummary(meetingId, candidate.version).then(() => summary.reload());
              }}
            />
          )}
          <div className="detail-grid">
            {tab === 'notes' && (
              <NotesTab
                fading={rewriting !== null}
                onFeedback={
                  summary.data?.summaryId === undefined
                    ? null
                    : (useful, comment) =>
                        api.sendFeedback(summary.data?.summaryId ?? '', useful, comment)
                }
                summary={summary.data ?? null}
                loading={summary.loading}
                selected={selected}
                onSelect={(item) => {
                  setSelected(item);
                  setAskCite(null);
                }}
                status={m.status}
              />
            )}
            {tab === 'transcript' && (
              <TranscriptTab
                meetingId={meetingId}
                segments={segments.data ?? []}
                loading={segments.loading}
                video={m.video}
                highlight={askCite?.segmentIds ?? selected?.segmentIds ?? []}
                startAt={playFrom}
              />
            )}
            {tab === 'ask' && m.status !== 'recording' && (
              <AskTab
                meetingId={meetingId}
                selected={askCite}
                onSelect={(cite) => {
                  setAskCite(cite);
                  setSelected(null);
                }}
              />
            )}
            <aside className="rail">
              <CitationCard
                item={askCite ?? selected}
                number={
                  askCite !== null
                    ? askCite.number
                    : selected === null || summary.data == null
                      ? null
                      : (numberCitations(summary.data).get(selected.id) ?? null)
                }
                segments={segments.data ?? []}
                canPlay={m.video?.status === 'ready'}
                onPlay={(ms) => {
                  setPlayFrom(ms);
                  navigate({ screen: 'detail', meetingId, tab: 'transcript' });
                }}
                onShowInTranscript={() =>
                  navigate({ screen: 'detail', meetingId, tab: 'transcript' })
                }
              />
              <ActionItemsCard
                summary={summary.data ?? null}
                people={people.data ?? []}
                onChanged={onActionsChanged}
              />
            </aside>
          </div>
        </>
      </div>
    </div>
  );
}

function NotesTab({
  summary,
  loading,
  selected,
  onSelect,
  status,
  fading,
  onFeedback,
}: {
  fading: boolean;
  onFeedback: ((useful: boolean, comment?: string) => Promise<void>) | null;
  summary: MeetingSummary | null;
  loading: boolean;
  selected: SummaryItem | null;
  onSelect: (item: SummaryItem) => void;
  status: string;
}) {
  const numbers = useMemo(
    () => (summary === null ? new Map<string, number>() : numberCitations(summary)),
    [summary],
  );
  if (loading && summary === null)
    return (
      <Card className="notes">
        <SkeletonRows rows={5} />
      </Card>
    );
  if (summary === null && status === 'processing') {
    // Notes are still being written; the Transcript tab (and video) can be used meanwhile.
    return (
      <Card className="processing">
        <span className="proc-dot" aria-hidden />
        <h2>Writing your notes…</h2>
        <p className="meta">
          This usually takes under a minute. You can leave this page — we&rsquo;ll let you know when
          they&rsquo;re ready. The transcript is ready now.
        </p>
      </Card>
    );
  }
  if (summary === null) {
    return (
      <Card className="notes">
        <p className="empty">
          {status === 'too_short'
            ? 'This meeting was too short for notes.'
            : status === 'failed'
              ? 'We couldn’t write notes for this meeting. Pick a template above to try again.'
              : 'No notes for this meeting yet.'}
        </p>
      </Card>
    );
  }
  const bullet = (item: SummaryItem) => {
    const n = numbers.get(item.id);
    return (
      <li key={item.id} className={`ai-line ${item.flagged ? 'unverified' : ''}`}>
        <span>{item.text}</span>
        {item.flagged ? (
          // DESIGN §6.14: never a citation chip on an unverified item.
          <span className="unverified-chip">⚠ Not found in the transcript</span>
        ) : (
          n !== undefined && (
            <CitationChip
              n={n}
              selected={selected?.id === item.id}
              onSelect={() => onSelect(item)}
            />
          )
        )}
      </li>
    );
  };
  return (
    <Card className={`notes ${fading ? 'fading' : ''}`}>
      <p className="legend">
        <span className="swatch swatch-ink" aria-hidden /> You wrote this
        <span className="swatch swatch-muted" aria-hidden /> Added from the conversation
        <span className="cite cite-static" aria-hidden>
          1
        </span>{' '}
        Click to see who said it
      </p>
      <p className="overview">{summary.overview}</p>
      {summary.sections.map((section, i) => (
        <section key={section.note?.id ?? `topic-${i}`} className="note-section">
          <h3 className={section.note === null ? 'topic-heading' : 'note-heading'}>
            {section.note?.text ?? 'From the conversation'}
          </h3>
          <p className="meta small num">
            {section.note === null
              ? 'added from the conversation'
              : `your note · ${formatClock(section.note.sessionMs)}`}
          </p>
          {section.items.length === 0 ? (
            <p className="ai-line italic">Nothing in the conversation matched this note yet.</p>
          ) : (
            <ul className="bullets">{section.items.map(bullet)}</ul>
          )}
        </section>
      ))}
      {summary.decisions.length > 0 && (
        <section className="note-section">
          <h3 className="note-heading">Decisions</h3>
          <ul className="bullets decisions">{summary.decisions.map(bullet)}</ul>
        </section>
      )}
      {summary.questions.length > 0 && (
        <section className="note-section">
          <h3 className="note-heading">Open questions</h3>
          <ul className="bullets questions">{summary.questions.map(bullet)}</ul>
        </section>
      )}
      {onFeedback !== null && <NotesFeedback onSend={onFeedback} />}
    </Card>
  );
}

function TranscriptTab({
  meetingId,
  segments,
  loading,
  video,
  highlight,
  startAt,
}: {
  meetingId: string;
  segments: Segment[];
  loading: boolean;
  video: { status: string; durationMs: number | null } | null;
  highlight: string[];
  startAt: number | null;
}) {
  const player = useRef<PlayerHandle>(null);
  const [now, setNow] = useState<number | null>(null);
  const ready = video?.status === 'ready';
  return (
    <Card className="transcript">
      {video !== null &&
        (ready ? (
          <VideoPlayer
            ref={player}
            meetingId={meetingId}
            startAt={startAt}
            onSessionTime={setNow}
          />
        ) : (
          <div className={`video-slot video-${video.status}`}>
            {video.status === 'uploading' ? (
              <p className="meta">
                <Icon name="video" /> Video is still uploading from the computer that recorded it.
                Your notes and transcript are ready.
              </p>
            ) : video.status === 'processing' ? (
              <p className="meta">Preparing video…</p>
            ) : video.status === 'failed' ? (
              <p className="meta">Video couldn&rsquo;t be saved. Audio and notes are fine.</p>
            ) : (
              <p className="meta">Recording was deleted after the retention period.</p>
            )}
          </div>
        ))}
      {loading && segments.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : segments.length === 0 ? (
        <p className="empty">No transcript for this meeting.</p>
      ) : (
        <ol className="segments">
          {segments.map((s) => {
            const playingNow = now !== null && now >= s.startMs && now < s.endMs;
            const cls = `segment ${highlight.includes(s.id) || playingNow ? 'segment-hl' : ''} ${ready ? 'segment-seek' : ''}`;
            const body = (
              <>
                <span className="meta small num">{formatClock(s.startMs)}</span>
                <span>
                  <span className={`speaker ${s.lane === 'me' ? 'speaker-me' : ''}`}>
                    {s.lane === 'me' ? 'You' : (s.speakerName ?? 'Speaker')}
                  </span>
                  <span className="segment-text">{s.text}</span>
                </span>
              </>
            );
            return (
              <li key={s.id} className={cls} aria-current={playingNow ? 'true' : undefined}>
                {ready ? (
                  // DESIGN §12.5 click-to-seek: the line plays the video from its start.
                  <button
                    type="button"
                    className="segment-btn"
                    onClick={() => player.current?.playFrom(s.startMs)}
                  >
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function CitationCard({
  item,
  number,
  segments,
  canPlay,
  onPlay,
  onShowInTranscript,
}: {
  /** A note's item or an answer's citation: only the cited segments matter here. */
  item: Pick<SummaryItem, 'segmentIds'> | null;
  number: number | null;
  segments: Segment[];
  canPlay: boolean;
  onPlay: (sessionMs: number) => void;
  onShowInTranscript: () => void;
}) {
  if (item === null || number === null) {
    return (
      <Card className="cite-card">
        <p className="meta">Click a number next to a note to see who said it.</p>
      </Card>
    );
  }
  const cited = segments.filter((s) => item.segmentIds.includes(s.id));
  const start = cited[0]?.startMs ?? 0;
  const end = cited.at(-1)?.endMs ?? start;
  return (
    <Card highlight className="cite-card">
      <p className="meta">
        <span className="cite cite-on cite-static">{number}</span> Where this came from ·{' '}
        <span className="num">
          {formatClock(start)}–{formatClock(end)}
        </span>
      </p>
      {cited.map((s) => (
        <blockquote key={s.id}>
          <span className="speaker">{s.lane === 'me' ? 'You' : (s.speakerName ?? 'Speaker')}</span>
          <q>{s.text}</q>
        </blockquote>
      ))}
      <div className="cite-actions">
        {/* TODO(S4-17): audio playback for meetings without video (DESIGN §12.6). */}
        <Button
          disabled={!canPlay}
          title={canPlay ? undefined : 'Plays when the meeting has video'}
          onClick={() => onPlay(start)}
        >
          <Icon name="play" /> Play from {formatClock(start)}
        </Button>
        <Button variant="ghost" onClick={onShowInTranscript}>
          Show in transcript
        </Button>
      </div>
    </Card>
  );
}

function ActionItemsCard({
  summary,
  people,
  onChanged,
}: {
  summary: MeetingSummary | null;
  people: Participant[];
  onChanged: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [, force] = useState(0);
  if (summary === null || summary.actionItems.length === 0) return null;
  const owner = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p === undefined ? 'Unassigned' : p.isSelf ? 'You' : p.displayName;
  };
  const set = async (item: SummaryItem, status: 'open' | 'done') => {
    await api.setActionItemStatus(item.id, status);
    item.status = status;
    force((n) => n + 1);
    onChanged();
  };
  return (
    <Card className="actions-card">
      <h2 className="card-title">Action items</h2>
      <ul className="todos">
        {summary.actionItems.map((item) => (
          <li key={item.id}>
            <Checkbox
              checked={item.status === 'done'}
              onChange={(checked) => {
                void set(item, checked ? 'done' : 'open');
                if (checked) toast({ message: 'Marked done', undo: () => void set(item, 'open') });
              }}
            />
            <span>
              <span className={`todo-text ${item.status === 'done' ? 'done' : ''}`}>
                {item.text}
              </span>
              <span className="meta small">
                {owner(item.ownerParticipantId)} · {formatDue(item)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
