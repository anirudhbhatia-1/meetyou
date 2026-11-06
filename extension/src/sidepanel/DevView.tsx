import { Button } from '@meetyou/ui';
import { useEffect, useState } from 'react';

import type { CaptureState } from '../background/capture-state.ts';
import type { StreamLink } from '../messages.ts';
import {
  countWaitingUploads,
  deleteLocalVideo,
  listLastVideo,
  revokeVideoLinks,
  type VideoLink,
} from './dev-video.ts';
import type { MeetInfo } from './hooks.ts';

const LINK_TEXT: Record<StreamLink, string> = {
  off: 'off (local capture only)',
  connecting: 'connecting…',
  online: 'online',
  reconnecting: 'reconnecting — audio is buffered locally',
};

/**
 * Developer details (behind the header's overflow menu) for Stage 1 checks in Chrome: Meet
 * adapter state, selector health, gateway link and the last recording's video files. Not part of
 * the DESIGN.md surface; S5-01 drops it from the alpha build.
 */
export function DevView({
  state,
  meet,
  onClose,
}: {
  state: CaptureState;
  meet: MeetInfo;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<VideoLink[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => () => revokeVideoLinks(links), [links]);

  const busy = state.status !== 'idle' && state.status !== 'processing' && state.status !== 'ready';
  const health = meet.health;

  const showVideo = async (): Promise<void> => {
    const next = await listLastVideo(state.sessionId);
    setLinks(next);
    setMessage(next.length === 0 ? 'No video yet.' : '');
  };

  const removeVideo = async (): Promise<void> => {
    const waiting = await countWaitingUploads();
    if (waiting > 0) {
      setMessage(
        `${waiting} video fragments are still waiting to upload; delete them after they upload.`,
      );
      return;
    }
    // Developer control; the product's delete is the §9 "Stop and delete" alert (S4-08).
    if (!confirm('Delete all video stored on this computer?')) return;
    await deleteLocalVideo();
    setLinks([]);
    setMessage('Local video deleted.');
  };

  return (
    <section className="state-view dev">
      <h3 className="state-title">Developer details</h3>
      <dl className="dev-list">
        <dt>Meet call state</dt>
        <dd>{meet.callState ?? '—'}</dd>
        <dt>Meeting code</dt>
        <dd className="num">{meet.meetingCode ?? '—'}</dd>
        <dt>Participants</dt>
        <dd>{meet.participants.length}</dd>
        <dt>Selector health</dt>
        <dd>
          {health === null
            ? '—'
            : health.overallStatus === 'healthy'
              ? 'Healthy'
              : health.overallStatus === 'degraded'
                ? `Degraded (${health.fallbackMatchCount} fallback)`
                : `Broken (${health.unmatchedCount} missed)`}
        </dd>
        <dt>Gateway</dt>
        <dd>{LINK_TEXT[state.link]}</dd>
        <dt>Session</dt>
        <dd className="num">{state.sessionId ?? '—'}</dd>
      </dl>
      <div className="dev-actions">
        <Button
          size="sm"
          onClick={() => {
            showVideo().catch((error: unknown) => {
              console.error('sidepanel: list video failed', error);
              setMessage('Gateway is off: uploaded video cannot be listed.');
            });
          }}
        >
          Show last video
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => {
            removeVideo().catch((error: unknown) =>
              console.error('sidepanel: delete failed', error),
            );
          }}
        >
          Delete local video
        </Button>
      </div>
      {message !== '' && (
        <p className="state-text" role="status">
          {message}
        </p>
      )}
      {links.length > 0 && (
        <ul className="dev-links">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noreferrer" download={link.download}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onClose}>Back</Button>
    </section>
  );
}
