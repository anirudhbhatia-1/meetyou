// Replaced at build time by esbuild `define` (scripts/build.mjs); absent under Vitest.
declare const __GATEWAY_URL__: string | undefined;

/** Base URL of the gateway to stream to, or '' to capture and buffer locally only. */
export const GATEWAY_URL: string = typeof __GATEWAY_URL__ === 'string' ? __GATEWAY_URL__ : '';
