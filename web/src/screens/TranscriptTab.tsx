import type { Segment } from '@meetyou/contracts';
import { Button, Card, Icon, SkeletonRows, TextInput, useToast } from '@meetyou/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Participant } from '../api/types.ts';
import { useAnalytics } from '../lib/analytics.ts';
import { useApi } from '../lib/api-context.ts';
import { useMeetingAudio } from '../lib/audio.ts';
import { formatClock, segmentLang } from '../lib/format.ts';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer.tsx';

/** A transcript search counts for analytics once the typing has paused this long. */
const SEARCH_SETTLE_MS = 1_500;

/** Case-insensitive matches of `query` in `text`, highlighted (DESIGN §12.5 `match-hl`). */
function highlight(text: string, query: string, current: boolean): ReactNode {
  if (query === '') return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, i + query.length)) {
    parts.push(text.slice(at, i));
    parts.push(
      <mark key={i} className={`match ${current ? 'match-current' : ''}`}>
        {text.slice(i, i + query.length)}
      </mark>,
    );
    at = i + query.length;
  }
  parts.push(text.slice(at));
  return parts;
}

/**
 * DESIGN §12.5 speaker rename: "Who is Speaker 3?" with the meeting's participants and a free name;
 * applies to the whole meeting (FR-SPK-05). Labels only, no voiceprints (FR-SPK-06).
 */
function SpeakerButton({
  meetingId,
  segment,
  people,
  onRenamed,
}: {
  meetingId: string;
  segment: Segment;
  people: Participant[];
  onRenamed: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const wrap = useRef<HTMLSpanElement>(null);
  const label = segment.speakerName ?? 'Speaker';
  const clusterId = segment.speakerClusterId;
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  if (segment.lane === 'me' || clusterId === undefined) {
    return (
      <span className={`speaker ${segment.lane === 'me' ? 'speaker-me' : ''}`}>
        {segment.lane === 'me' ? 'You' : label}
      </span>
    );
  }
  const apply = (to: { participantId: string } | { name: string }) => {
    setOpen(false);
    api.renameSpeaker(meetingId, clusterId, to).then(
      (r) => {
        toast({ message: `Renamed ${label} to ${r.displayName} everywhere.` });
        onRenamed();
      },
      () => toast({ message: 'Couldn’t rename the speaker. Try again.' }),
    );
  };
  return (
    <span className="speaker-wrap" ref={wrap}>
      <button
        type="button"
        className="speaker speaker-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {label}
      </button>
      {open && (
        <div
          className="speaker-pop"
          role="dialog"
          aria-label={`Who is ${label}?`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <p className="speaker-pop-title">Who is {label}?</p>
          {people
            .filter((p) => !p.isSelf)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className="menu-item"
                onClick={() => apply({ participantId: p.id })}
              >
                {p.displayName}
              </button>
            ))}
          <form
            className="speaker-pop-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() !== '') apply({ name: name.trim() });
            }}
          >
            <TextInput
              compact
              autoFocus
              aria-label="Name"
              placeholder="Type a name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="primary" size="sm" disabled={name.trim() === ''}>
              Apply to whole meeting
            </Button>
          </form>
        </div>
      )}
    </span>
  );
}

/** DESIGN §12.5 Transcript tab. */
export function TranscriptTab({
  meetingId,
  segments,
  people,
  loading,
  video,
  highlightIds,
  startAt,
  onSpeakerRenamed,
}: {
  meetingId: string;
  segments: Segment[];
  people: Participant[];
  loading: boolean;
  video: { status: string; durationMs: number | null } | null;
  highlightIds: string[];
  startAt: number | null;
  onSpeakerRenamed: () => void;
}) {
  const api = useApi();
  const analytics = useAnalytics();
  const toast = useToast();
  const player = useRef<PlayerHandle>(null);
  const audio = useMeetingAudio(api, meetingId);
  const [videoNow, setVideoNow] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  const [showEcho, setShowEcho] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const ready = video?.status === 'ready';
  const now = ready ? videoNow : audio.sessionMs;

  const echoCount = segments.filter((s) => s.flags.includes('echo')).length;
  const visible = useMemo(
    () => segments.filter((s) => showEcho || !s.flags.includes('echo')),
    [segments, showEcho],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q === '' ? [] : visible.filter((s) => s.text.toLowerCase().includes(q)).map((s) => s.id),
    [visible, q],
  );
  const currentMatch = matches[Math.min(hit, matches.length - 1)];
  useEffect(() => setHit(0), [q]);
  useEffect(() => {
    if (q === '') return undefined;
    const timer = setTimeout(
      () => analytics.track('transcript_searched', { meetingId, matches: matches.length }),
      SEARCH_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [q, matches.length, meetingId, analytics]);
  useEffect(() => {
    if (currentMatch === undefined) return;
    list.current
      ?.querySelector(`[data-segment="${currentMatch}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentMatch]);

  const play = (s: Segment) => {
    if (ready) {
      player.current?.playFrom(s.startMs);
      return;
    }
    void audio.playFrom(s.lane, s.startMs).then((ok) => {
      if (!ok) toast({ message: 'The recording for this line isn’t available any more.' });
    });
  };
  const step = (by: number) =>
    setHit((h) => (matches.length === 0 ? 0 : (h + by + matches.length) % matches.length));

  return (
    <Card className="transcript">
      {video !== null &&
        (ready ? (
          <VideoPlayer
            ref={player}
            meetingId={meetingId}
            startAt={startAt}
            onSessionTime={setVideoNow}
          />
        ) : (
          <div className={`video-slot video-${video.status}`}>
            {video.status === 'uploading' ? (
              <p className="meta">
                <Icon name="video" /> Video is still uploading from the computer that recorded it.
                Your notes and transcript are ready.
              </p>
            ) : video.status === 'processing' ? (
              <p className="meta">
                <span className="proc-dot" aria-hidden /> Preparing video…
              </p>
            ) : video.status === 'failed' ? (
              <p className="meta">Video couldn&rsquo;t be saved. Audio and notes are fine.</p>
            ) : (
              <p className="meta">Recording was deleted after the retention period.</p>
            )}
          </div>
        ))}
      <div className="transcript-tools">
        <div className="transcript-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="transcript-search-input"
            aria-label="Search in transcript"
            placeholder="Search in transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
          />
          {q !== '' && (
            <span className="meta small num" aria-live="polite">
              {matches.length === 0
                ? 'No matches'
                : `${Math.min(hit, matches.length - 1) + 1} of ${matches.length}`}
            </span>
          )}
          {matches.length > 1 && (
            <>
              <button
                type="button"
                className="icon-mini"
                aria-label="Previous match"
                onClick={() => step(-1)}
              >
                <Icon name="chevron-up" size={16} />
              </button>
              <button
                type="button"
                className="icon-mini"
                aria-label="Next match"
                onClick={() => step(1)}
              >
                <Icon name="chevron-down" size={16} />
              </button>
            </>
          )}
        </div>
        {echoCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowEcho((v) => !v)}>
            {showEcho
              ? 'Hide possible echo lines'
              : `Show ${echoCount} possible echo ${echoCount === 1 ? 'line' : 'lines'}`}
          </Button>
        )}
      </div>
      {loading && segments.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : segments.length === 0 ? (
        <p className="empty">No transcript for this meeting.</p>
      ) : (
        <ol className="segments" ref={list}>
          {visible.map((s) => {
            const playingNow = now !== null && now >= s.startMs && now < s.endMs;
            const echo = s.flags.includes('echo');
            const cls = `segment ${highlightIds.includes(s.id) || playingNow ? 'segment-hl' : ''} ${echo ? 'segment-echo' : ''}`;
            return (
              <li
                key={s.id}
                data-segment={s.id}
                className={cls}
                aria-current={playingNow ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="segment-time"
                  aria-label={`Play from ${formatClock(s.startMs)}`}
                  onClick={() => play(s)}
                >
                  {formatClock(s.startMs)}
                </button>
                <span>
                  <SpeakerButton
                    meetingId={meetingId}
                    segment={s}
                    people={people}
                    onRenamed={onSpeakerRenamed}
                  />
                  {echo && <span className="echo-label">possible echo</span>}
                  <span className="segment-text" lang={segmentLang(s.language, s.text)}>
                    {highlight(s.text, q, s.id === currentMatch)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
