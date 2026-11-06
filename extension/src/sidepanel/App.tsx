import { Button, Icon, Segmented, useTheme, useToast } from '@meetyou/ui';
import { useEffect, useRef, useState } from 'react';

import type { CaptureState } from '../background/capture-state.ts';
import { DevView } from './DevView.tsx';
import { send, useCaptureState, useLiveFeed, useMeetInfo, useNow, usePanelTabId } from './hooks.ts';
import { LiveView, type LiveTab } from './LiveView.tsx';
import { formatClock, headerFor, viewFor } from './panel-model.ts';
import { ErrorView, NotesReadyView, ProcessingView, ReadyView } from './StateViews.tsx';
import { useNotes } from './useNotes.ts';

const LIVE_STATUSES = new Set(['recording', 'paused', 'reconnecting']);

/** Side panel (DESIGN §8.5–§8.7, §9): one view per recording state, header always on top. */
export function App() {
  const state = useCaptureState();
  const tabId = usePanelTabId();
  const meet = useMeetInfo(tabId);
  const feed = useLiveFeed(state.startedAt);
  const notes = useNotes(state.sessionId);
  const [tab, setTab] = useState<LiveTab>('transcript');
  const [showDev, setShowDev] = useState(false);
  const view = viewFor(state);
  useBackOnlineToast(state);

  return (
    <div className="panel">
      <PanelHeader
        state={state}
        tab={view === 'live' && !showDev ? tab : null}
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
          {view === 'live' && (
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
            <ProcessingView upload={feed.upload} sessionId={state.sessionId} />
          )}
          {view === 'ready_notes' && (
            <NotesReadyView
              noteCount={notes.notes.length}
              upload={feed.upload}
              sessionId={state.sessionId}
            />
          )}
          {view === 'error' && <ErrorView state={state} />}
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
          <span className="status-label">{header.label}</span>
          {timing && state.startedAt !== null && (
            // TODO(S4-05): wall-clock since start; paused time is not subtracted yet.
            <span className="status-timer num">{formatClock(now - state.startedAt)}</span>
          )}
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
          <OverflowMenu devOpen={devOpen} onDeveloper={onDeveloper} />
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
 * Header overflow (§8.5). TODO(S4-08): "Stop and delete this recording…" and, after the call,
 * "Consent log" (§13.4) join this menu once delete and the consent log exist.
 */
function OverflowMenu({ devOpen, onDeveloper }: { devOpen: boolean; onDeveloper: () => void }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && root.current?.contains(event.target as Node) === true) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="menu-root" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
      >
        <Icon name="more-horizontal" />
      </button>
      {open && (
        <div className="menu glass" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            autoFocus
            onClick={() => {
              setOpen(false);
              setTheme(theme === 'dark' ? 'light' : 'dark');
            }}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onDeveloper();
            }}
          >
            {devOpen ? 'Hide developer details' : 'Developer details'}
          </button>
        </div>
      )}
    </div>
  );
}
