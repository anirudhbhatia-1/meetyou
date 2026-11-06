import type { GcsBucket } from './bucket.ts';
import { videoFragmentKey } from './layout.ts';

/** ADR-0011 §3.3: upload URLs expire after 15 minutes and take at most 8 MB. */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
export const MAX_FRAGMENT_BYTES = 8 * 1024 * 1024;
/** Playback links are short-lived (ARCHITECTURE §14); the player asks again after expiry. */
export const PLAYBACK_URL_TTL_MS = 15 * 60 * 1000;

/**
 * The size bound travels as a signed extension header: the uploader must send exactly this
 * header, and Cloud Storage refuses a body outside the range (x-goog-content-length-range).
 * [Verify] in staging: the bucket CORS must list this header so the browser may send it.
 */
export const LENGTH_RANGE_HEADER = 'x-goog-content-length-range';

export interface SignedUpload {
  index: number;
  url: string;
  expiresAt: string;
}

/**
 * V4 signed PUT URLs for video fragments (S2-14, `POST /v1/sessions/{id}/video/fragments:sign`).
 * Each URL is bound to its object, the content type and the size range. The API checks before
 * calling this that the session is the caller's own and still accepts video. On Cloud Run the
 * library signs through the IAM `signBlob` API (the service account needs
 * `iam.serviceAccounts.signBlob` on itself, STAGING_SETUP §5.2).
 */
export async function signFragmentUploads(
  bucket: GcsBucket,
  request: {
    workspaceId: string;
    meetingId: string;
    partId: string;
    indices: readonly number[];
    contentType: 'video/mp4' | 'video/webm';
  },
  now: number = Date.now(),
): Promise<{ fragments: SignedUpload[]; headers: Record<string, string> }> {
  const expires = now + UPLOAD_URL_TTL_MS;
  const range = `0,${MAX_FRAGMENT_BYTES}`;
  const fragments = await Promise.all(
    request.indices.map(async (index) => {
      const key = videoFragmentKey(request.workspaceId, request.meetingId, request.partId, index);
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        contentType: request.contentType,
        extensionHeaders: { [LENGTH_RANGE_HEADER]: range },
      });
      return { index, url, expiresAt: new Date(expires).toISOString() };
    }),
  );
  return { fragments, headers: { [LENGTH_RANGE_HEADER]: range } };
}

/** A V4 signed GET URL; `downloadName` makes the browser save instead of play. */
export async function signReadUrl(
  bucket: GcsBucket,
  key: string,
  options: { now?: number; downloadName?: string } = {},
): Promise<{ url: string; expiresAt: string }> {
  const expires = (options.now ?? Date.now()) + PLAYBACK_URL_TTL_MS;
  const [url] = await bucket.file(key).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
    ...(options.downloadName !== undefined ? { promptSaveAs: options.downloadName } : {}),
  });
  return { url, expiresAt: new Date(expires).toISOString() };
}
