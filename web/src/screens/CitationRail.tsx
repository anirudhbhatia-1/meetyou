import type { Segment, SummaryItem } from '@meetyou/contracts';
import { Button, Card, Checkbox, Icon, Menu, useToast } from '@meetyou/ui';
import { useRef, useState } from 'react';

import type { Meeting, MeetingSummary, Participant } from '../api/types.ts';
import { useAnalytics } from '../lib/analytics.ts';
import { useApi } from '../lib/api-context.ts';
import { useMeetingAudio } from '../lib/audio.ts';
import { formatClock, formatDue, segmentLang } from '../lib/format.ts';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer.tsx';

const DAY_MS = 24 * 60 * 60 * 1000;

/** DESIGN §12.6 footer: how long replay stays possible, or that it is gone. */
function retentionFooter(meeting: Meeting, now: Date): { text: string | null; deleted: boolean } {
  const hasVideo = meeting.video !== null && meeting.video.status !== 'failed';
  if (meeting.recordingExpiresAt === null) return { text: null, deleted: false };
  const left = Date.parse(meeting.recordingExpiresAt) - now.getTime();
  if (left <= 0) return { text: 'Recording was deleted (your retention setting).', deleted: true };
  const days = Math.max(1, Math.ceil(left / DAY_MS));
  const what = hasVideo ? 'Audio and video' : 'Audio';
  return {
    text: `${what} available for ${days} more ${days === 1 ? 'day' : 'days'}`,
    deleted: false,
  };
}

/** DESIGN §12.6 citation card: the cited lines, playback from the first, Show in transcript. */
export function CitationCard({
  meeting,
  item,
  number,
  segments,
  onShowInTranscript,
}: {
  meeting: Meeting;
  /** A note's item or an answer's citation: only the cited segments matter here. */
  item: Pick<SummaryItem, 'segmentIds'> | null;
  number: number | null;
  segments: Segment[];
  /** Switches to the transcript; `continueAt` keeps playing there from that meeting time. */
  onShowInTranscript: (continueAt: number | null) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const player = useRef<PlayerHandle>(null);
  const audio = useMeetingAudio(api, meeting.id);
  const [videoNow, setVideoNow] = useState<number | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  if (item === null || number === null) {
    return (
      <Card className="cite-card">
        <p className="meta">Click a number next to a note to see who said it.</p>
      </Card>
    );
  }
  const cited = segments.filter((s) => item.segmentIds.includes(s.id));
  const first = cited[0];
  const start = first?.startMs ?? 0;
  const end = cited.at(-1)?.endMs ?? start;
  const videoReady = meeting.video?.status === 'ready';
  const videoComing =
    meeting.video?.status === 'uploading' || meeting.video?.status === 'processing';
  const footer = retentionFooter(meeting, new Date());
  const gone = footer.deleted || (!videoReady && audio.unavailable);
  const playing = videoReady ? videoPlaying : audio.playing;
  const at = videoReady ? videoNow : audio.sessionMs;
  const progress =
    at === null || end <= start ? 0 : Math.min(1, Math.max(0, (at - start) / (end - start)));

  const toggle = () => {
    if (playing) {
      if (videoReady) player.current?.pause();
      else audio.pause();
      return;
    }
    if (videoReady) {
      player.current?.playFrom(start);
      return;
    }
    if (first === undefined) return;
    void audio.playFrom(first.lane, start).then((ok) => {
      if (!ok) toast({ message: 'The recording for this point isn’t available any more.' });
    });
  };

  return (
    <Card highlight className="cite-card">
      <p className="meta">
        <span className="cite cite-on cite-static">{number}</span> Where this came from ·{' '}
        <span className="num">
          {formatClock(start)}–{formatClock(end)}
        </span>
      </p>
      {videoReady && (
        <VideoPlayer
          ref={player}
          meetingId={meeting.id}
          compact
          onSessionTime={setVideoNow}
          onPlayingChange={setVideoPlaying}
        />
      )}
      {cited.map((s) => (
        <blockquote key={s.id}>
          <span className="speaker">{s.lane === 'me' ? 'You' : (s.speakerName ?? 'Speaker')}</span>
          <q lang={segmentLang(s.language, s.text)}>{s.text}</q>
        </blockquote>
      ))}
      <div className="cite-actions">
        <Button
          disabled={gone || first === undefined}
          aria-describedby={footer.text !== null ? 'cite-footer' : undefined}
          onClick={toggle}
        >
          <Icon name={playing ? 'pause' : 'play'} />{' '}
          {playing ? 'Pause' : `Play from ${formatClock(start)}`}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (videoReady) player.current?.pause();
            else audio.pause();
            onShowInTranscript(playing ? at : null);
          }}
        >
          Show in transcript
        </Button>
      </div>
      {playing && (
        <div className="cite-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {videoComing && <p className="meta small">Video is on its way.</p>}
      {(footer.text !== null || gone) && (
        <p className="meta small" id="cite-footer">
          {footer.text ?? 'The recording for this point isn’t available any more.'}
        </p>
      )}
    </Card>
  );
}

/** DESIGN §12.6 action items: done/open, owner and due pickers, per-item feedback. */
export function ActionItemsCard({
  summary,
  people,
  onChanged,
}: {
  summary: MeetingSummary | null;
  people: Participant[];
  onChanged: () => void;
}) {
  const api = useApi();
  const analytics = useAnalytics();
  const toast = useToast();
  const [, force] = useState(0);
  const [dueFor, setDueFor] = useState<string | null>(null);
  const [rated, setRated] = useState<ReadonlySet<string>>(new Set());
  if (summary === null || summary.actionItems.length === 0) return null;
  const owner = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p === undefined ? 'Unassigned' : p.isSelf ? 'You' : p.displayName;
  };
  const set = async (item: SummaryItem, status: 'open' | 'done'): Promise<boolean> => {
    try {
      await api.setActionItemStatus(item.id, status);
      analytics.track('action_item_status', { status });
    } catch {
      toast({ message: 'Couldn’t save that. Try again.' });
      return false;
    }
    item.status = status;
    force((n) => n + 1);
    onChanged();
    return true;
  };
  const edit = (
    item: SummaryItem,
    patch: { ownerParticipantId?: string | null; dueDate?: string | null },
  ) => {
    api.editSummaryItem(item.id, patch).then(
      (stored) => {
        Object.assign(item, stored);
        force((n) => n + 1);
        onChanged();
      },
      () => toast({ message: 'Couldn’t save that. Try again.' }),
    );
  };
  const rate = (item: SummaryItem, useful: boolean) => {
    setRated((r) => new Set(r).add(item.id));
    api.sendItemFeedback(item.id, useful).then(
      () => toast({ message: 'Thanks for the feedback' }),
      () => {
        setRated((r) => {
          const next = new Set(r);
          next.delete(item.id);
          return next;
        });
        toast({ message: 'Couldn’t send that. Try again.' });
      },
    );
  };
  return (
    <Card className="actions-card">
      <h2 className="card-title">Action items</h2>
      <ul className="todos">
        {summary.actionItems.map((item) => (
          <li key={item.id} className="todo-row">
            <Checkbox
              checked={item.status === 'done'}
              onChange={(checked) => {
                void set(item, checked ? 'done' : 'open').then((saved) => {
                  if (saved && checked) {
                    toast({ message: 'Marked done', undo: () => void set(item, 'open') });
                  }
                });
              }}
            />
            <span className="todo-body">
              <span className={`todo-text ${item.status === 'done' ? 'done' : ''}`}>
                {item.text}
              </span>
              <span className="meta small todo-meta">
                <Menu
                  inline
                  label={`Owner: ${owner(item.ownerParticipantId)}. Change owner`}
                  trigger={owner(item.ownerParticipantId)}
                  items={[
                    ...people.map((p) => ({
                      label: p.isSelf ? 'You' : p.displayName,
                      checked: item.ownerParticipantId === p.id,
                      onSelect: () => edit(item, { ownerParticipantId: p.id }),
                    })),
                    {
                      label: 'Unassigned',
                      checked: item.ownerParticipantId === null,
                      separated: true,
                      onSelect: () => edit(item, { ownerParticipantId: null }),
                    },
                  ]}
                />
                ·
                {dueFor === item.id ? (
                  <input
                    type="date"
                    className="input input-compact due-input"
                    aria-label="Due date"
                    autoFocus
                    defaultValue={item.dueDate ?? ''}
                    onBlur={(e) => {
                      setDueFor(null);
                      const value = e.currentTarget.value;
                      if (value !== (item.dueDate ?? '')) {
                        edit(item, { dueDate: value === '' ? null : value });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setDueFor(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn menu-inline"
                    aria-label={`Due: ${formatDue(item)}. Change due date`}
                    onClick={() => setDueFor(item.id)}
                  >
                    {formatDue(item)}
                  </button>
                )}
              </span>
              {!rated.has(item.id) && (
                <span className="item-feedback">
                  Useful?
                  <button
                    type="button"
                    className="btn menu-inline"
                    onClick={() => rate(item, true)}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className="btn menu-inline"
                    onClick={() => rate(item, false)}
                  >
                    No
                  </button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
