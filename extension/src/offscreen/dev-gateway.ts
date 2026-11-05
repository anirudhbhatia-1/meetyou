import { z } from 'zod';

import { UploadRejected, type SignedFragment } from './video-uploader.ts';

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

async function postJson(url: string): Promise<unknown> {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function createDevSession(baseUrl: string): Promise<DevSession> {
  return DevSession.parse(await postJson(new URL('/v1/dev/sessions', baseUrl).href));
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
  });
  if (response.status === 404) throw new UploadRejected(sessionId);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { fragments } = DevSignedFragments.parse(await response.json());
  return fragments.map((f) => ({ index: f.index, url: f.url, expiresAt: Date.parse(f.expiresAt) }));
}

/** One fragment, one PUT: idempotent, so a retry simply overwrites (ADR-0011 §3.3). */
export async function putFragment(url: string, blob: Blob, contentType: string): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: blob,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
