import { resolve } from 'node:path';
import process from 'node:process';

import { z } from 'zod';

import { LocalChunkStore } from './chunk-store.ts';
import { log } from './log.ts';
import { createGateway } from './server.ts';
import { deepgramProvider } from './stt/deepgram.ts';

/**
 * Local gateway for Stage 1 (S1-05). Run from the repo root:
 *   node --env-file=.env.bench backend/apps/gateway/src/main.ts
 * STT_PROVIDER=deepgram turns on live transcription (paid API, dev/test use decided 2026-11-03);
 * the default `none` stores and acknowledges audio without calling any vendor.
 */
const Env = z.object({
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATA_DIR: z.string().default(resolve(import.meta.dirname, '..', '.data')),
  STT_PROVIDER: z.enum(['none', 'deepgram']).default('none'),
  DEEPGRAM_API_KEY: z.string().optional(),
});

const env = Env.parse(process.env);

// Dev sessions skip sign-in and real stream tokens, so they must never run outside local and CI.
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'ci') {
  console.error('gateway: dev endpoints are local/ci only; staging needs the API (S2, ADR-0004)');
  process.exit(1);
}

if (env.STT_PROVIDER === 'deepgram' && !env.DEEPGRAM_API_KEY) {
  console.error(
    'gateway: STT_PROVIDER=deepgram needs DEEPGRAM_API_KEY (e.g. --env-file=.env.bench)',
  );
  process.exit(1);
}

const stt =
  env.STT_PROVIDER === 'deepgram' && env.DEEPGRAM_API_KEY
    ? deepgramProvider(env.DEEPGRAM_API_KEY)
    : null;

const gateway = createGateway({
  store: new LocalChunkStore(env.DATA_DIR),
  stt,
  devEndpoints: true,
});

gateway.server.listen(env.PORT, '127.0.0.1', () => {
  log('gateway.listening', { port: env.PORT, stt: stt?.name ?? 'none', appEnv: env.APP_ENV });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void gateway.close().then(() => process.exit(0));
  });
}
