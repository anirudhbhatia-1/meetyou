import { z } from 'zod';

import { FragmentRejected, UploadRejected, type SignedFragment } from './video-uploader.ts';

/**
 * Local-dev session API of the S1-05 gateway (`backend/apps/gateway`, APP_ENV=local only).
 * TODO(S2): replace with `POST /v1/sessions` (StartSessionResponse) and the stream-token endpoint
 * once the API and Google sign-in exist (ADR-0004).
 */
const DevSession = z.object({
  sessionId: z.string().min(1),
  streamUrl: z.string().regex(/^wss?:\/\//),
});
export type DevSession = z.infer<typeof DevSession>;

const DevToken = z.object({ streamToken: z.string().min(1) });

/** A hung gateway must not hold recording start, stop or uploads forever. */
export const REQUEST_TIMEOUT_MS = 5_000;

async function postJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function createDevSession(baseUrl: string): Promise<DevSession> {
  return DevSession.parse(await postJson(new URL('/v1/dev/sessions', baseUrl).href));
}

/**
 * Up to three attempts, each bounded by REQUEST_TIMEOUT_MS, so a slow or briefly unreachable
 * gateway does not turn the whole recording local-only. Null when every attempt failed.
 * TODO(S2-04): start offline and create the session later (audio is captured meanwhile).
 */
export async function createDevSessionWithRetry(
  baseUrl: string,
  onError: (context: string, error: unknown) => void,
  attempts = 3,
): Promise<DevSession | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await createDevSession(baseUrl);
    } catch (error: unknown) {
      onError(`gateway session attempt ${attempt} failed`, error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  return null;
}

export async function devStreamToken(baseUrl: string, sessionId: string): Promise<string> {
  const url = new URL(`/v1/dev/sessions/${encodeURIComponent(sessionId)}/stream-token`, baseUrl);
  return DevToken.parse(await postJson(url.href)).streamToken;
}

const DevSignedFragments = z.object({
  fragments: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      url: z.string().regex(/^https?:\/\//),
      expiresAt: z.string().min(1),
    }),
  ),
  /** Headers every PUT must send (Cloud Storage size range); absent from the dev gateway. */
  headers: z.record(z.string().regex(/^x-goog-[a-z0-9-]+$/), z.string().max(200)).optional(),
});

/**
 * Dev stand-in for `POST /v1/sessions/{id}/video/fragments:sign` (ADR-0011 §3.3); the request body
 * is the contract's `SignVideoFragmentsRequest`. A 404 means the gateway no longer knows the session
 * (it restarted), so those fragments can never upload there.
 */
export async function signDevVideoFragments(
  baseUrl: string,
  sessionId: string,
  partId: string,
  indices: number[],
  contentType: string,
): Promise<SignedFragment[]> {
  const url = new URL(
    `/v1/dev/sessions/${encodeURIComponent(sessionId)}/video/fragments:sign`,
    baseUrl,
  );
  const response = await fetch(url.href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partId, indices, contentType }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) throw new UploadRejected(sessionId);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { fragments, headers } = DevSignedFragments.parse(await response.json());
  return fragments.map((f) => ({
    index: f.index,
    url: f.url,
    expiresAt: Date.parse(f.expiresAt),
    ...(headers !== undefined ? { headers } : {}),
  }));
}

/** One fragment, one PUT: idempotent, so a retry simply overwrites (ADR-0011 §3.3). */
export async function putFragment(
  url: string,
  blob: Blob,
  contentType: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    // Signed extension headers first; Content-Type is ours and always wins.
    headers: { ...headers, 'content-type': contentType },
    body: blob,
    // A 10 s fragment is ~1.3 MB; a minute covers a slow (~200 kbps) link.
    signal: AbortSignal.timeout(60_000),
  });
  // 400/413/415/422 will never succeed on a retry; 403 (expired URL) and 5xx may.
  if ([400, 413, 415, 422].includes(response.status)) throw new FragmentRejected(response.status);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const DevVideoParts = z.object({
  parts: z.array(
    z.object({
      partId: z.string().min(1),
      fragments: z.number().int().nonnegative(),
      playableFragments: z.number().int().nonnegative(),
      url: z.string().regex(/^https?:\/\//),
    }),
  ),
  /** The finalized file (S2-14), once `video.finalize` ran; parts are then gone. */
  playback: z
    .object({
      url: z.string().regex(/^https?:\/\//),
      posterUrl: z.string().regex(/^https?:\/\//),
      bytes: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});
export type DevVideoPart = z.infer<typeof DevVideoParts>['parts'][number];
export type DevVideoState = z.infer<typeof DevVideoParts>;

/**
 * Video parts the dev gateway holds for a session, each with a URL that plays the uploaded part
 * (fragments joined). Uploaded fragments are deleted locally, so this is where they are seen.
 * TODO(S2-14): replace with `GET /v1/meetings/{id}/video` (signed URL of the finalized MP4).
 */
export async function listDevVideo(baseUrl: string, sessionId: string): Promise<DevVideoPart[]> {
  return (await devVideoState(baseUrl, sessionId)).parts;
}

/** Parts still in fragments, and the finalized playback file once it exists. */
export async function devVideoState(baseUrl: string, sessionId: string): Promise<DevVideoState> {
  const url = new URL(`/v1/dev/sessions/${encodeURIComponent(sessionId)}/video`, baseUrl);
  const response = await fetch(url.href, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return DevVideoParts.parse(await response.json());
}
