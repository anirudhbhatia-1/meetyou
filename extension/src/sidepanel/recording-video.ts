import { FRAGMENT_MS } from '../offscreen/video-recorder.ts';
import type { DevVideoPart, DevVideoState } from '../offscreen/dev-gateway.ts';

/** One playable, downloadable video file of a recording (one per part; pause starts a new part). */
export interface VideoFile {
  key: string;
  label: string;
  /** Plays in a Chrome tab. */
  playUrl: string;
  /** Saves the file: the gateway answers `?download=1` with an attachment. */
  downloadUrl: string;
  /** Fragments after a gap that cannot join the file yet (still uploading, or lost). */
  waitingFragments: number;
}

/** "12 min" / "45 s": fragments are 10 s, the last one may be shorter, so this is an upper bound. */
export function approxLength(fragments: number): string {
  const ms = fragments * FRAGMENT_MS;
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/**
 * Files from the dev gateway's list. Only URLs on our own gateway are kept: the panel opens them,
 * so a response must not be able to point it anywhere else.
 */
export function gatewayVideoFiles(parts: readonly DevVideoPart[], gatewayUrl: string): VideoFile[] {
  let origin: string;
  try {
    origin = new URL(gatewayUrl).origin;
  } catch {
    return [];
  }
  const playable = parts.filter((p) => p.playableFragments > 0 && sameOrigin(p.url, origin));
  return playable.map((part, i) => ({
    key: part.partId,
    label:
      (playable.length === 1 ? 'Meeting video' : `Video part ${i + 1}`) +
      ` · ${approxLength(part.playableFragments)}`,
    playUrl: part.url,
    downloadUrl: `${part.url}?download=1`,
    waitingFragments: part.fragments - part.playableFragments,
  }));
}

/** "12.4 MB" for the finalized file's size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The finalized playback file when `video.finalize` has run (one row, the whole meeting on the
 * session clock); before that, one row per uploaded part.
 */
export function videoFilesFromState(state: DevVideoState, gatewayUrl: string): VideoFile[] {
  const playback = state.playback;
  if (playback !== null && playback !== undefined) {
    let origin: string;
    try {
      origin = new URL(gatewayUrl).origin;
    } catch {
      return [];
    }
    if (!sameOrigin(playback.url, origin)) return [];
    return [
      {
        key: 'playback',
        label: `Meeting video · ${formatBytes(playback.bytes)}`,
        playUrl: playback.url,
        downloadUrl: `${playback.url}?download=1`,
        waitingFragments: 0,
      },
    ];
  }
  return gatewayVideoFiles(state.parts, gatewayUrl);
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
