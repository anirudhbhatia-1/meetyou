import { GATEWAY_URL } from '../build-config.ts';
import { listDevVideo } from '../offscreen/dev-gateway.ts';
import { idbDone, idbRequest, openMinutesDb, VIDEO_STORE } from '../offscreen/idb.ts';
import type { VideoFragmentRow } from '../offscreen/video-recorder.ts';
import { formatClock } from './panel-model.ts';
import { latestSessionParts } from './video-parts.ts';

/**
 * Developer helpers for the panel's Developer section (Stage 1 checks of S1-13): list the last
 * recording's video parts and delete local video. The meeting view's player (S4-17, §12.5)
 * replaces this once video is finalized on the server (S2-14).
 */
export interface VideoLink {
  label: string;
  href: string;
  /** File name for a local blob; unset for a gateway URL opened in a tab. */
  download?: string;
}

async function videoRows(): Promise<VideoFragmentRow[]> {
  const db = await openMinutesDb();
  try {
    const tx = db.transaction(VIDEO_STORE, 'readonly');
    return (await idbRequest(tx.objectStore(VIDEO_STORE).getAll())) as VideoFragmentRow[];
  } finally {
    db.close();
  }
}

/**
 * With the gateway on, fragments are deleted locally once uploaded, so the last recording's video
 * is listed from the gateway (joined there).
 */
async function uploadedLinks(sessionId: string | null): Promise<VideoLink[]> {
  if (GATEWAY_URL === '' || sessionId === null || !sessionId.startsWith('ses_')) return [];
  const parts = await listDevVideo(GATEWAY_URL, sessionId);
  return parts
    .filter((p) => p.playableFragments > 0)
    .map((part, i) => {
      const pending = part.fragments - part.playableFragments;
      return {
        href: part.url,
        label:
          `Part ${i + 1} — uploaded (${part.playableFragments} × 10 s)` +
          (pending > 0 ? `, ${pending} more after a gap` : ''),
      };
    });
}

/**
 * Every part of the newest recording. Pause/resume starts a new part, so each part plays on its
 * own. Local links are object URLs: the caller revokes them with `revokeVideoLinks`.
 */
export async function listLastVideo(sessionId: string | null): Promise<VideoLink[]> {
  const links = await uploadedLinks(sessionId);
  latestSessionParts(await videoRows()).forEach((part, i) => {
    const type = part.mimeType.split(';')[0] ?? 'video/webm';
    const href = URL.createObjectURL(
      new Blob(
        part.fragments.map((r) => r.blob),
        { type },
      ),
    );
    // Uploaded fragments are pruned locally; without fragment 0 (the container header) the
    // remainder does not play. `check-session --join` rebuilds uploaded parts on the gateway.
    const partial = part.fragments[0]?.index !== 0 ? ' — partly uploaded, will not play' : '';
    links.push({
      href,
      download: `minutes-part${i + 1}-${part.partId}.${type === 'video/mp4' ? 'mp4' : 'webm'}`,
      label: `Part ${i + 1} — from ${formatClock(part.startMs)} (${part.fragments.length} × 10 s)${partial}`,
    });
  });
  return links;
}

export function revokeVideoLinks(links: readonly VideoLink[]): void {
  for (const link of links) if (link.download !== undefined) URL.revokeObjectURL(link.href);
}

/**
 * Fragments still waiting to upload. Counted in IndexedDB, not from progress messages: a panel
 * opened later, or an uploader in backoff, has none, and fragments must only leave this computer
 * after a successful PUT.
 */
export async function countWaitingUploads(): Promise<number> {
  if (GATEWAY_URL === '') return 0;
  return (await videoRows()).filter((row) => row.sessionId.startsWith('ses_')).length;
}

export async function deleteLocalVideo(): Promise<void> {
  const db = await openMinutesDb();
  try {
    const tx = db.transaction(VIDEO_STORE, 'readwrite');
    tx.objectStore(VIDEO_STORE).clear();
    await idbDone(tx);
  } finally {
    db.close();
  }
}
