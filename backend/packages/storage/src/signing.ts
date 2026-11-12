import type { SignableBucket } from './bucket.ts';
import { videoFragmentKey } from './layout.ts';

/** ADR-0011 §3.3: upload URLs expire after 15 minutes and take at most 8 MB. */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
export const MAX_FRAGMENT_BYTES = 8 * 1024 * 1024;
/** Playback links are short-lived (ARCHITECTURE §14); the player asks again after expiry. */
export const PLAYBACK_URL_TTL_MS = 15 * 60 * 1000;

/**
 * Cloud Storage's signed size-range header (GcsBucket). Azure links carry `x-ms-blob-type`
 * instead and cannot bound the size (AzureBlobBucket).
 */
export const LENGTH_RANGE_HEADER = 'x-goog-content-length-range';

export interface SignedUpload {
  index: number;
  url: string;
  expiresAt: string;
}

/**
 * Signed PUT URLs for video fragments (S2-14, `POST /v1/sessions/{id}/video/fragments:sign`).
 * Each URL is bound to its object; the response's `headers` must be sent with every PUT (the
 * extension's uploader does). The API checks before calling this that the session is the caller's
 * own and still accepts video. Which signature that is depends on the bucket (ADR-0012).
 */
export async function signFragmentUploads(
  bucket: SignableBucket,
  request: {
    workspaceId: string;
    meetingId: string;
    partId: string;
    indices: readonly number[];
    contentType: 'video/mp4' | 'video/webm';
  },
  now: number = Date.now(),
): Promise<{ fragments: SignedUpload[]; headers: Record<string, string> }> {
  const expiresAt = new Date(now + UPLOAD_URL_TTL_MS);
  let headers: Record<string, string> = {};
  const fragments = await Promise.all(
    request.indices.map(async (index) => {
      const key = videoFragmentKey(request.workspaceId, request.meetingId, request.partId, index);
      const signed = await bucket.signUpload(key, {
        contentType: request.contentType,
        maxBytes: MAX_FRAGMENT_BYTES,
        expiresAt,
      });
      // The same for every fragment of one bucket.
      headers = signed.headers;
      return { index, url: signed.url, expiresAt: expiresAt.toISOString() };
    }),
  );
  return { fragments, headers };
}

/** A signed GET URL; `downloadName` makes the browser save instead of play. */
export async function signReadUrl(
  bucket: SignableBucket,
  key: string,
  options: { now?: number; downloadName?: string } = {},
): Promise<{ url: string; expiresAt: string }> {
  const expiresAt = new Date((options.now ?? Date.now()) + PLAYBACK_URL_TTL_MS);
  const url = await bucket.signRead(key, {
    expiresAt,
    ...(options.downloadName !== undefined ? { downloadName: options.downloadName } : {}),
  });
  return { url, expiresAt: expiresAt.toISOString() };
}
