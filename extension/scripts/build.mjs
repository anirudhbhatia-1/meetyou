import console from 'node:console';
import { cp, rm } from 'node:fs/promises';
import process from 'node:process';
import { build } from 'esbuild';

// Bundles every extension entry point so pages and workers can import workspace packages
// (`@meetyou/contracts`, zod). Content scripts and the audio worklet are classic scripts (IIFE).
// MINUTES_GATEWAY_URL turns on streaming to a gateway (e.g. http://localhost:8787 in local dev);
// unset, the extension captures and buffers locally only.
const gatewayUrl = process.env.MINUTES_GATEWAY_URL ?? '';
// MINUTES_AUDIO_CODEC=pcm16 turns off Opus transport (ADR-0003), e.g. to compare CPU in S1-11.
const audioCodec = process.env.MINUTES_AUDIO_CODEC === 'pcm16' ? 'pcm16' : 'opus';
// Cloud mode (staging/production): the API, its Google OAuth client ID and the library web app.
const apiUrl = process.env.MINUTES_API_URL ?? '';
const googleClientId = process.env.MINUTES_GOOGLE_CLIENT_ID ?? '';
const webUrl = process.env.MINUTES_WEB_URL ?? '';
if (apiUrl !== '' && googleClientId === '') {
  throw new Error('MINUTES_GOOGLE_CLIENT_ID is required with MINUTES_API_URL');
}

await rm('dist', { force: true, recursive: true });

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: true,
  outbase: 'src',
  outdir: 'dist',
  legalComments: 'none',
  logLevel: 'warning',
  jsx: 'automatic',
  // Bundled fonts imported by page CSS (design-tokens/fonts.css), emitted next to the bundle.
  loader: { '.woff': 'file', '.woff2': 'file' },
  assetNames: 'assets/[name]-[hash]',
  define: {
    // React's production build; the extension never ships its development warnings.
    'process.env.NODE_ENV': JSON.stringify('production'),
    __GATEWAY_URL__: JSON.stringify(gatewayUrl),
    __AUDIO_CODEC__: JSON.stringify(audioCodec),
    __API_URL__: JSON.stringify(apiUrl),
    __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId),
    __WEB_URL__: JSON.stringify(webUrl),
  },
};

await build({
  ...common,
  format: 'esm',
  entryPoints: [
    'src/background/service-worker.ts',
    'src/offscreen/index.ts',
    'src/sidepanel/main.tsx',
    'src/onboarding/index.ts',
  ],
});

await build({
  ...common,
  format: 'iife',
  entryPoints: ['src/content/meet-content-script.ts', 'src/offscreen/pcm-worklet.ts'],
});

await cp('public', 'dist', { recursive: true });
console.log(
  `extension built to dist/ (api: ${apiUrl === '' ? 'off' : apiUrl}, gateway: ${gatewayUrl === '' ? 'off' : gatewayUrl}, codec: ${audioCodec})`,
);
