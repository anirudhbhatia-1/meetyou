// Replaced at build time by esbuild `define` (scripts/build.mjs); absent under Vitest.
declare const __GATEWAY_URL__: string | undefined;

/** Base URL of the gateway to stream to, or '' to capture and buffer locally only. */
export const GATEWAY_URL: string = typeof __GATEWAY_URL__ === 'string' ? __GATEWAY_URL__ : '';

declare const __AUDIO_CODEC__: string | undefined;

/** Transport codec to prefer; `pcm16` at build time turns Opus off (e.g. to compare CPU, S1-11). */
export const AUDIO_CODEC: 'opus' | 'pcm16' =
  typeof __AUDIO_CODEC__ === 'string' && __AUDIO_CODEC__ === 'pcm16' ? 'pcm16' : 'opus';

declare const __API_URL__: string | undefined;
declare const __GOOGLE_CLIENT_ID__: string | undefined;
declare const __WEB_URL__: string | undefined;

/**
 * Cloud mode (S2-09, ADR-0004): sign in with Google, start sessions on the API, upload video with
 * API-signed URLs. Empty: the local dev gateway (`GATEWAY_URL`) or a local-only build.
 */
export const API_URL: string = typeof __API_URL__ === 'string' ? __API_URL__ : '';
/** OAuth client of the API (not a secret; the API holds the client secret). */
export const GOOGLE_CLIENT_ID: string =
  typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : '';
/** Library web app, where a finished recording is watched (D-07). */
export const WEB_URL: string = typeof __WEB_URL__ === 'string' ? __WEB_URL__ : '';
