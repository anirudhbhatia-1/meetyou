import {
  RecoverSessionResponse,
  UserSettings,
  SignVideoFragmentsResponse,
  StartSessionResponse,
} from '@meetyou/contracts';

import type { StartedSession } from './messages.ts';
import type { SessionSource } from './offscreen/recorder.ts';
import { UploadRejected, type SignedFragment } from './offscreen/video-uploader.ts';

/**
 * Cloud API calls of a recording (ARCHITECTURE §12.1), shared by the service worker (start) and
 * the offscreen document (reconnect tokens, video signing). The access token comes from the
 * service worker, the only place that refreshes it (rotation must never race, ADR-0004 §4.3).
 */

/** A hung API must not hold recording start, reconnects or uploads forever. */
export const API_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`${path} failed (HTTP ${status})`);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function postJson(
  apiUrl: string,
  path: string,
  accessToken: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(new URL(path, apiUrl).href, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) throw new ApiError(path, response.status);
  return response.json();
}

export interface StartSessionInput {
  meetingCode: string;
  /** Meet's title when the adapter could read it (FR-DET-04). */
  title?: string;
  recordVideo: boolean;
  extensionVersion: string;
}

export async function startApiSession(
  apiUrl: string,
  accessToken: string,
  input: StartSessionInput,
): Promise<StartSessionResponse> {
  return StartSessionResponse.parse(
    await postJson(apiUrl, '/v1/sessions', accessToken, {
      platform: 'google_meet',
      meetingCode: input.meetingCode,
      ...(input.title !== undefined ? { title: input.title } : {}),
      recordVideo: input.recordVideo,
      clientInfo: { extensionVersion: input.extensionVersion, browser: 'chrome' },
    }),
  );
}

/** Deletes the meeting of a session whose capture never started (no audio, nothing to keep). */
export async function discardApiMeeting(
  apiUrl: string,
  accessToken: string,
  meetingId: string,
): Promise<void> {
  const path = `/v1/meetings/${encodeURIComponent(meetingId)}`;
  const response = await fetch(new URL(path, apiUrl).href, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) throw new ApiError(path, response.status);
}

/** A new stream token for a reconnect (FR-CAP-08); throws when the session has ended. */
export async function recoverStreamToken(
  apiUrl: string,
  accessToken: string,
  sessionId: string,
): Promise<string> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/recover`;
  const reply = RecoverSessionResponse.parse(await postJson(apiUrl, path, accessToken, {}));
  if (reply.state !== 'resumable') throw new ApiError(path, 410);
  return reply.streamToken;
}

/** `POST /v1/sessions/{id}/video/fragments:sign` (ADR-0011 §3.3). */
export async function signApiVideoFragments(
  apiUrl: string,
  accessToken: string,
  sessionId: string,
  partId: string,
  indices: number[],
  contentType: string,
): Promise<SignedFragment[]> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/video/fragments:sign`;
  try {
    const { fragments, headers } = SignVideoFragmentsResponse.parse(
      await postJson(apiUrl, path, accessToken, { partId, indices, contentType }),
    );
    return fragments.map((f) => ({
      index: f.index,
      url: f.url,
      expiresAt: Date.parse(f.expiresAt),
      headers,
    }));
  } catch (error: unknown) {
    // 404: not this account's session; 410: the 24 h upload window closed. Neither recovers.
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
      throw new UploadRejected(sessionId);
    }
    throw error;
  }
}

/**
 * The recorder's session source in cloud mode: the start response's token for the first connect,
 * then `recover` for each reconnect (stream tokens are single-use, ADR-0004 §4.4).
 */
export function apiSessionSource(
  apiUrl: string,
  session: StartedSession,
  accessToken: () => Promise<string>,
): SessionSource {
  let first: string | null = session.streamToken;
  return {
    open: () => Promise.resolve({ sessionId: session.sessionId, streamUrl: session.streamUrl }),
    async token(sessionId) {
      if (first !== null) {
        const token = first;
        first = null;
        return token;
      }
      return recoverStreamToken(apiUrl, await accessToken(), sessionId);
    },
  };
}

/** The account settings (DESIGN §15, S4-12) the extension caches for its pages. */
export async function fetchApiSettings(apiUrl: string, accessToken: string): Promise<UserSettings> {
  const response = await fetch(new URL('/v1/settings', apiUrl).href, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) throw new ApiError('/v1/settings', response.status);
  return UserSettings.parse(await response.json());
}

/** Onboarding preferences and the consent acknowledgement (DESIGN §7.3–§7.4). */
export async function patchApiSettings(
  apiUrl: string,
  accessToken: string,
  patch: Record<string, unknown>,
): Promise<UserSettings> {
  const response = await fetch(new URL('/v1/settings', apiUrl).href, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) throw new ApiError('/v1/settings', response.status);
  return UserSettings.parse(await response.json());
}

/** One consent-log entry per recording (FR-CON-03): what was posted, skipped or failed. */
export async function postApiConsentLog(
  apiUrl: string,
  accessToken: string,
  entry: {
    meetingId: string;
    mode: 'one_click' | 'automatic' | 'off';
    outcome: 'posted' | 'skipped' | 'failed';
    noticeText?: string;
    sentAt: string;
  },
): Promise<void> {
  await postJson(apiUrl, '/v1/consent-log', accessToken, entry);
}
