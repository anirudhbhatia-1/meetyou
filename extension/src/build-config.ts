// Replaced at build time by esbuild `define` (scripts/build.mjs); absent under Vitest.
declare const __GATEWAY_URL__: string | undefined;

/** Base URL of the gateway to stream to, or '' to capture and buffer locally only. */
export const GATEWAY_URL: string = typeof __GATEWAY_URL__ === 'string' ? __GATEWAY_URL__ : '';

declare const __AUDIO_CODEC__: string | undefined;

/** Transport codec to prefer; `pcm16` at build time turns Opus off (e.g. to compare CPU, S1-11). */
export const AUDIO_CODEC: 'opus' | 'pcm16' =
  typeof __AUDIO_CODEC__ === 'string' && __AUDIO_CODEC__ === 'pcm16' ? 'pcm16' : 'opus';
