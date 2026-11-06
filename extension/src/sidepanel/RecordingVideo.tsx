import { Icon } from '@meetyou/ui';
import { useEffect, useState } from 'react';

import { GATEWAY_URL } from '../build-config.ts';
import { devVideoState } from '../offscreen/dev-gateway.ts';
import { listLastVideo, revokeVideoLinks, type VideoLink } from './dev-video.ts';
import { videoFilesFromState, type VideoFile } from './recording-video.ts';

/** While fragments may still arrive, the list is re-read this often. */
const REFRESH_MS = 5000;

type Loaded =
  | { kind: 'loading' }
  | { kind: 'gateway'; files: VideoFile[] }
  | { kind: 'local'; links: VideoLink[] }
  | { kind: 'error' };

/**
 * The recording's video after the call: play in a tab, or download (the user's ask, 2026-11-06).
 * Reads the dev gateway (uploaded parts, joined) or, in a local-only build, this computer.
 * TODO(S4-17, S2-14): the library's meeting page plays the finalized MP4 (DESIGN §6.19, §12.5).
 */
export function RecordingVideo({ sessionId, live }: { sessionId: string; live: boolean }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });

  useEffect(() => {
    let current = true;
    let links: VideoLink[] = [];
    const load = async (): Promise<void> => {
      if (GATEWAY_URL !== '' && sessionId.startsWith('ses_')) {
        const files = videoFilesFromState(await devVideoState(GATEWAY_URL, sessionId), GATEWAY_URL);
        if (current) setLoaded({ kind: 'gateway', files });
        return;
      }
      const next = (await listLastVideo(null)).filter((link) => link.download !== undefined);
      revokeVideoLinks(links);
      links = next;
      if (current) setLoaded({ kind: 'local', links: next });
    };
    const run = (): void => {
      load().catch((error: unknown) => {
        console.error('sidepanel: video list failed', error);
        if (current) setLoaded({ kind: 'error' });
      });
    };
    run();
    // Local blobs do not change after the call; uploads keep arriving at the gateway.
    const timer = live && GATEWAY_URL !== '' ? setInterval(run, REFRESH_MS) : null;
    return () => {
      current = false;
      if (timer !== null) clearInterval(timer);
      revokeVideoLinks(links);
    };
  }, [sessionId, live]);

  if (loaded.kind === 'loading') return null;
  if (loaded.kind === 'error') {
    return (
      <p className="option-help">The video list could not be read. Is the local gateway running?</p>
    );
  }
  const rows =
    loaded.kind === 'gateway'
      ? loaded.files.map((f) => ({
          key: f.key,
          label: f.label,
          play: f.playUrl,
          download: f.downloadUrl,
          name: undefined,
          note: f.waitingFragments > 0 ? 'More is still uploading' : null,
        }))
      : loaded.links.map((l) => ({
          key: l.href,
          label: l.label,
          play: l.href,
          download: l.href,
          name: l.download,
          note: null,
        }));
  if (rows.length === 0) {
    return <p className="option-help">No video for this recording yet.</p>;
  }
  return (
    <ul className="video-files" aria-label="Recording video">
      {rows.map((row) => (
        <li key={row.key} className="video-file">
          <Icon name="video" size={14} />
          <span className="video-file-label">
            {row.label}
            {row.note !== null && <span className="option-help"> · {row.note}</span>}
          </span>
          <a className="btn btn-secondary btn-sm" href={row.play} target="_blank" rel="noreferrer">
            Play
          </a>
          {/* Gateway files: the attachment response downloads without leaving the panel. */}
          <a className="btn btn-primary btn-sm" href={row.download} download={row.name ?? true}>
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}
