import { z } from 'zod';

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
