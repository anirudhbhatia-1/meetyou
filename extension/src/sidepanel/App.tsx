import {
  AlertDialog,
  Button,
  Icon,
  Menu,
  Segmented,
  useTheme,
  useToast,
  type MenuEntry,
} from '@meetyou/ui';
import { useEffect, useRef, useState } from 'react';

import { elapsedMs, type CaptureState } from '../background/capture-state.ts';
import { DevView } from './DevView.tsx';
import {
  send,
  useCaptureState,
  useLimitWarningToast,
  useLiveFeed,
  useMeetingProgress,
  useMeetInfo,
  useNow,
  usePanelTabId,
} from './hooks.ts';
import { LiveView, type LiveTab } from './LiveView.tsx';
import { formatClock, headerFor, viewFor } from './panel-model.ts';
import {
  ErrorView,
  NotesReadyView,
  ProcessingView,
  ReadyView,
  SecondTabView,
} from './StateViews.tsx';
import { useNotes } from './useNotes.ts';

const LIVE_STATUSES = new Set(['recording', 'paused', 'reconnecting']);

/** Side panel (DESIGN §8.5–§8.7, §9): one view per recording state, header always on top. */
export function App() {
  const state = useCaptureState();
  const tabId = usePanelTabId();
  const meet = useMeetInfo(tabId);
  // Recordings from before 2026-11-13 could stop with "join the call first"; any Meet page may
  // record now, so that old error turns back into Start.
  const staleNoCallError = state.error === 'no_meeting';
  const feed = useLiveFeed(state.startedAt);
  const notes = useNotes(state.sessionId);
  const progress = useMeetingProgress(
    state.sessionId,
    state.status === 'processing' || state.status === 'ready',
  );
  const [tab, setTab] = useState<LiveTab>('transcript');
  const [showDev, setShowDev] = useState(false);
  const view = viewFor(state);
  // Side panels are per tab: this one may belong to a Meet tab other than the recorded one.
  const elsewhere =
    view === 'live' && tabId !== null && state.tabId !== null && state.tabId !== tabId;
  useBackOnlineToast(state);
  useLimitWarningToast();

  return (
    <div className="panel">
      <PanelHeader
        state={state}
        tab={view === 'live' && !showDev && !elsewhere ? tab : null}
        noteCount={notes.notes.length}
        onTab={setTab}
        onDeveloper={() => setShowDev((on) => !on)}
        devOpen={showDev}
      />
      {showDev ? (
        <DevView state={state} meet={meet} onClose={() => setShowDev(false)} />
      ) : (
        <>
          {view === 'ready' && <ReadyView />}
          {elsewhere && <SecondTabView />}
          {view === 'live' && !elsewhere && (
            <LiveView
              state={state}
              feed={feed}
              participants={meet.participants}
              tab={tab}
              notes={notes}
              onAddedNote={() => setTab('notes')}
            />
          )}
          {view === 'processing' && (
            <ProcessingView upload={feed.upload} sessionId={state.sessionId} progress={progress} />
          )}
          {view === 'ready_notes' && (
            <NotesReadyView
              noteCount={notes.notes.length}
              upload={feed.upload}
              sessionId={state.sessionId}
              progress={progress}
            />
          )}
          {view === 'error' && (staleNoCallError ? <ReadyView /> : <ErrorView state={state} />)}
        </>
      )}
    </div>
  );
}

/** §9 "Back online": one toast when the stream link recovers. */
function useBackOnlineToast(state: CaptureState): void {
  const toast = useToast();
  const previous = useRef(state.link);
  useEffect(() => {
    if (previous.current === 'reconnecting' && state.link === 'online') {
      toast({ message: 'Back online — catching up' });
    }
    previous.current = state.link;
  }, [state.link, toast]);
}

function PanelHeader({
  state,
  tab,
  noteCount,
  onTab,
  onDeveloper,
  devOpen,
}: {
  state: CaptureState;
  tab: LiveTab | null;
  noteCount: number;
  onTab: (tab: LiveTab) => void;
  onDeveloper: () => void;
  devOpen: boolean;
}) {
  const header = headerFor(state);
  const timing = LIVE_STATUSES.has(state.status) && state.startedAt !== null;
  const now = useNow(timing);
  const canPause = LIVE_STATUSES.has(state.status);
  return (
    <header className="panel-head">
      <div className="panel-status">
        <span className="status-text">
          <span className={`status-dot dot-${header.tone}`} aria-hidden />
          {/* §20: recording state changes are announced once. */}
          <span className="status-label" aria-live="polite">
            {header.label}
          </span>
          {timing && <span className="status-timer num">{formatClock(elapsedMs(state, now))}</span>}
        </span>
        <span className="status-actions">
          {canPause && (
            <>
              <Button
                size="sm"
                onClick={() =>
                  send(state.status === 'paused' ? 'recording.resume' : 'recording.pause')
                }
              >
                {state.status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="primary" size="sm" onClick={() => send('recording.stop')}>
                Stop
              </Button>
            </>
          )}
          <OverflowMenu devOpen={devOpen} onDeveloper={onDeveloper} live={canPause} />
        </span>
      </div>
      {tab !== null && (
        <Segmented
          label="Live view"
          value={tab}
          onChange={onTab}
          options={[
            { value: 'transcript', label: 'Transcript' },
            { value: 'notes', label: `My notes · ${noteCount}` },
          ]}
        />
      )}
    </header>
  );
}

/**
 * Header overflow (§8.5): theme, "Stop and delete this recording…" while recording (§9, FR-CON-04,
 * behind a confirmation), developer details.
 */
function OverflowMenu({
  devOpen,
  onDeveloper,
  live,
}: {
  devOpen: boolean;
  onDeveloper: () => void;
  live: boolean;
}) {
  const [theme, setTheme] = useTheme();
  const [confirm, setConfirm] = useState(false);
  const items: MenuEntry[] = [
    {
      label: theme === 'dark' ? 'Light theme' : 'Dark theme',
      onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      label: devOpen ? 'Hide developer details' : 'Developer details',
      onSelect: onDeveloper,
    },
    ...(live
      ? [
          {
            label: 'Stop and delete this recording…',
            danger: true,
            separated: true,
            onSelect: () => setConfirm(true),
          },
        ]
      : []),
  ];
  return (
    <>
      <Menu round label="More options" trigger={<Icon name="more-horizontal" />} items={items} />
      {confirm && (
        <AlertDialog
          title="Stop and delete?"
          body="Recording stops and everything from this call is deleted, including video. Use this if someone doesn't want to be recorded."
          confirmLabel="Stop and delete"
          failedText="That didn't work. Try again."
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            send('recording.stop_delete');
            setConfirm(false);
          }}
        />
      )}
    </>
  );
}
