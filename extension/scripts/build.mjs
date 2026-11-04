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

await rm('dist', { force: true, recursive: true });

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: true,
  outbase: 'src',
  outdir: 'dist',
  legalComments: 'none',
  logLevel: 'warning',
  define: {
    __GATEWAY_URL__: JSON.stringify(gatewayUrl),
    __AUDIO_CODEC__: JSON.stringify(audioCodec),
  },
};

await build({
  ...common,
  format: 'esm',
  entryPoints: [
    'src/background/service-worker.ts',
    'src/offscreen/index.ts',
    'src/sidepanel/index.ts',
    'src/sidepanel/capture-controls.ts',
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
  `extension built to dist/ (gateway: ${gatewayUrl === '' ? 'off' : gatewayUrl}, codec: ${audioCodec})`,
);
