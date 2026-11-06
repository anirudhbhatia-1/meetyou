import process from 'node:process';

import { createPgPool } from '@meetyou/db';
import { createLogger } from '@meetyou/log';
import { GcsBucket } from '@meetyou/storage';
import { startTracing } from '@meetyou/tracing';

import { loadWorkerEnv } from './config.ts';
import { runWorker } from './worker.ts';

/**
 * Background worker (S2-06): `node backend/apps/worker/src/main.ts`, with DATABASE_URL and
 * GCS_AUDIO_BUCKET (STAGING_SETUP §9). graphile-worker stops gracefully on SIGTERM (ADR-0005 §3.2).
 */
let env;
try {
  env = loadWorkerEnv(process.env);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'worker: bad configuration');
  process.exit(1);
}

const tracing = startTracing('worker');
const pool = createPgPool(env.DATABASE_URL);
const worker = await runWorker({
  pool,
  bucket: new GcsBucket(env.GCS_AUDIO_BUCKET),
  port: env.PORT,
  concurrency: env.WORKER_CONCURRENCY,
});
createLogger('worker').log('worker.started', { appEnv: env.APP_ENV, port: env.PORT });
await worker.runner.promise;
await worker.stop();
await tracing.shutdown();
