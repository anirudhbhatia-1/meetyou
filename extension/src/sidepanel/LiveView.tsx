import { Banner, Button, Icon, useToast } from '@meetyou/ui';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Note } from '@meetyou/contracts';

import type { CaptureState } from '../background/capture-state.ts';
import { CONSENT_RESULT_KEY, parseConsentResult } from '../messages.ts';
import { useStoredValue, type LiveFeed } from './hooks.ts';
import { composeNote, MARKER_LABEL, NOTE_CHIPS, type NoteMarker } from './notes.ts';
import {
  connectionFor,
  formatClock,
  micProblem,
  nextSilentSince,
  SILENT_AFTER_MS,
  videoLineFor,
} from './panel-model.ts';
import { speakerLabel, type ParticipantName } from './speaker-label.ts';
import { visibleLines } from './transcript-model.ts';
import { LocalOnlyBanner } from './StateViews.tsx';
import type { NotesStore } from './useNotes.ts';

export type LiveTab = 'transcript' | 'notes';

const METER_MIN_DBFS = -60;
/** Within this many px of the bottom the list follows new lines (FR-LIV-04). */
const FOLLOW_SLACK_PX = 48;

/** Recording view (DESIGN §8.6) with the §9 banners that apply while recording. */
export function LiveView({
  state,
  feed,
  participants,
  tab,
  notes,
  onAddedNote,
}: {
  state: CaptureState;
  feed: LiveFeed;
  participants: readonly ParticipantName[];
  tab: LiveTab;
  notes: NotesStore;
  onAddedNote: () => void;
}) {
  const recording = state.status === 'recording' || state.status === 'reconnecting';
  return (
    <>
      <div className="live-status">
        <ConsentNotice sessionId={state.sessionId} />
        <LiveBanners state={state} feed={feed} />
        <LaneHealth state={state} feed={feed} recording={recording} />
        <VideoLine state={state} />
      </div>
      {tab === 'transcript' ? (
        <TranscriptList
          feed={feed}
          participants={participants}
          paused={state.status === 'paused'}
        />
      ) : (
        <NotesList notes={notes} />
      )}
      <Composer
        startedAt={state.startedAt}
        disabled={state.sessionId === null}
        onAdd={(note) => {
          notes.add(note);
          onAddedNote();
        }}
      />
    </>
  );
}

function LiveBanners({ state, feed }: { state: CaptureState; feed: LiveFeed }) {
  const silent = useTabSilent(feed, state.status === 'recording');
  const mic = micProblem(state);
  return (
    <>
      <LocalOnlyBanner />
      {state.status === 'reconnecting' && (
        <Banner tone="warning">
          Your connection dropped. Audio is being saved on this computer and will upload when you're
          back online.
        </Banner>
      )}
      {mic === 'lost' && (
        // TODO(S4-08): "Choose microphone" once the panel can switch the mic device.
        <Banner tone="warning">
          We can't hear your microphone. The rest of the call is still being recorded.
        </Banner>
      )}
      {mic === 'denied' && (
        <Banner tone="info">
          Recording the Meet tab only. Turn on your mic to include your voice.
        </Banner>
      )}
      {state.video === 'failed' && (
        <Banner tone="warning">Screen recording stopped. Audio is still being recorded.</Banner>
      )}
      {state.stt !== 'ok' && state.status === 'recording' && (
        <Banner tone="warning">
          We're still recording. The transcript will appear after the call.
        </Banner>
      )}
      {silent && <Banner tone="info">No sound from the Meet tab. Is the call muted?</Banner>}
    </>
  );
}

/** §9: the Meet tab has been silent for 15 s while the mic has signal. */
function useTabSilent(feed: LiveFeed, active: boolean): boolean {
  const silentSince = useRef<number | null>(null);
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (!active || feed.levels === null) {
      silentSince.current = null;
      setSilent(false);
      return;
    }
    const now = Date.now();
    silentSince.current = nextSilentSince(
      silentSince.current,
      feed.levels.me,
      feed.levels.them,
      now,
    );
    setSilent(silentSince.current !== null && now - silentSince.current >= SILENT_AFTER_MS);
  }, [feed.levels, active]);
  return silent;
}

function LaneHealth({
  state,
  feed,
  recording,
}: {
  state: CaptureState;
  feed: LiveFeed;
  recording: boolean;
}) {
  const connection = connectionFor(state.link);
  const me = recording && state.lanes?.me === true ? (feed.levels?.me ?? null) : null;
  const them = recording ? (feed.levels?.them ?? null) : null;
  return (
    <div className="lane-health">
      <LevelMeter label="You" dbfs={me} />
      <LevelMeter label="Meet tab" dbfs={them} />
      <span className={`connection connection-${connection.tone}`}>{connection.text}</span>
    </div>
  );
}

/** DESIGN §6.16; the bar is decorative, the connection text carries the state. */
function LevelMeter({ label, dbfs }: { label: string; dbfs: number | null }) {
  const level = dbfs === null ? 0 : Math.min(1, Math.max(0, 1 - dbfs / METER_MIN_DBFS));
  return (
    <span className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-track" aria-hidden>
        <span className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </span>
    </span>
  );
}

/**
 * TODO(S4-17): " · Data saver" (and the one-time toast when it switches on by itself) needs the
 * offscreen recorder to report its current quality.
 */
function VideoLine({ state }: { state: CaptureState }) {
  const line = videoLineFor(state.video);
  return (
    <p className="video-line">
      <Icon name={line.recording ? 'video' : 'video-off'} size={14} />
      {line.text}
    </p>
  );
}

function TranscriptList({
  feed,
  participants,
  paused,
}: {
  feed: LiveFeed;
  participants: readonly ParticipantName[];
  paused: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const lines = visibleLines(feed.transcript);

  useLayoutEffect(() => {
    const el = list.current;
    if (el !== null && following) el.scrollTop = el.scrollHeight;
  }, [feed.transcript, following, paused]);

  const onScroll = (): void => {
    const el = list.current;
    if (el === null) return;
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX);
  };

  return (
    <div className="live-scroll" ref={list} onScroll={onScroll}>
      <div className="transcript" aria-live="off">
        {lines.length === 0 && !paused && (
          <p className="empty-live">Listening… the transcript appears as people speak.</p>
        )}
        {lines.map((line) => (
          <div key={line.key} className={`line ${line.final ? '' : 'line-interim'}`}>
            <span className={`line-who ${line.lane === 'me' ? 'line-you' : ''}`}>
              {/* TODO(S4-06): Roman interim for Devanagari STT output (§8.6 script consistency). */}
              {line.lane === 'me' ? 'You' : speakerLabel('them', line.speaker, participants)}{' '}
              <span className="line-time num">{formatClock(line.startMs)}</span>
            </span>
            <span className="line-text">{line.text}</span>
          </div>
        ))}
        {paused && <div className="paused-pill">Paused — nothing is being recorded</div>}
      </div>
      {!following && (
        <button
          type="button"
          className="jump-live glass"
          onClick={() => {
            setFollowing(true);
          }}
        >
          <Icon name="arrow-down" size={14} />
          Jump to live
        </button>
      )}
    </div>
  );
}

function NotesList({ notes }: { notes: NotesStore }) {
  return (
    <div className="live-scroll">
      <ul className="notes">
        {notes.notes.length === 0 && (
          <li className="empty-live">
            No notes yet. Type a few words below when something matters — each note becomes a
            heading in your summary.
          </li>
        )}
        {notes.notes.map((note: Note) => (
          <li key={note.id} className="note">
            <span className="note-time num">{formatClock(note.sessionMs)}</span>
            <span className="note-text">
              {note.marker !== null && (
                <span className="note-tag">{MARKER_LABEL[note.marker]}</span>
              )}
              {note.text}
            </span>
            <button
              type="button"
              className="note-delete"
              aria-label="Delete note"
              onClick={() => notes.remove(note.id)}
            >
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Composer({
  startedAt,
  disabled,
  onAdd,
}: {
  startedAt: number | null;
  disabled: boolean;
  onAdd: (note: Note) => void;
}) {
  const [chip, setChip] = useState<NoteMarker | 'note'>('note');
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    // TODO(S4-06): stamp with the offscreen session clock (ARCHITECTURE §5.5); wall clock since
    // start drifts by the paused time.
    const note = composeNote(draft, chip, startedAt === null ? 0 : Date.now() - startedAt);
    if (note === null) return;
    onAdd(note);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className="composer">
      <div className="chips" role="group" aria-label="Note type">
        {NOTE_CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`chip chip-tag ${c.value === chip ? 'chip-on' : ''}`}
            aria-pressed={c.value === chip}
            onClick={() => setChip(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="composer-row">
        <input
          className="input"
          value={draft}
          disabled={disabled}
          placeholder="Type a note and press Enter"
          aria-label="New note"
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={`send ${draft.trim() === '' ? '' : 'send-ready'}`}
          aria-label="Add note"
          disabled={disabled || draft.trim() === ''}
          onClick={submit}
        >
          <Icon name="arrow-up" size={16} />
        </button>
      </div>
    </div>
  );
}

function consentFrom(value: unknown) {
  return parseConsentResult(value);
}

/**
 * DESIGN §8.5 after Post and start: a toast once the note is in Meet chat, or — when Meet did not
 * take it — a banner with the message to copy. Recording continues either way.
 */
function ConsentNotice({ sessionId }: { sessionId: string | null }) {
  const toast = useToast();
  const result = useStoredValue(CONSENT_RESULT_KEY, consentFrom);
  const shown = useRef<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const mine = result !== null && result.sessionId === sessionId ? result : null;
  useEffect(() => {
    if (mine?.outcome === 'posted' && shown.current !== mine.sessionId) {
      shown.current = mine.sessionId;
      toast({ message: 'Posted in Meet chat' });
    }
  }, [mine, toast]);
  if (mine?.outcome !== 'failed' || dismissed) return null;
  return (
    <Banner
      tone="warning"
      onDismiss={() => setDismissed(true)}
      action={
        <Button
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(mine.text).then(
              () => toast({ message: 'Copied — paste it in Meet chat' }),
              () => toast({ message: 'Couldn’t copy. Select the text in Settings instead.' }),
            );
          }}
        >
          Copy
        </Button>
      }
    >
      Couldn&rsquo;t post — copy this message.
    </Banner>
  );
}
