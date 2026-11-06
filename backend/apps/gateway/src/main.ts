import { resolve } from 'node:path';
import process from 'node:process';

import { z } from 'zod';

import { StreamTokenVerifier } from '@meetyou/auth';
import { createPgPool, Db, WORKSPACE_ID } from '@meetyou/db';
import { asProvidedPolicy, romanRulesPolicy } from '@meetyou/hinglish';
import { createProviders } from '@meetyou/providers';

import { GcsBucket } from '@meetyou/storage';
import { startTracing } from '@meetyou/tracing';

import { LocalChunkStore, type ChunkStore } from './chunk-store.ts';
import { GcsChunkStore } from './gcs-chunk-store.ts';
import { log } from './log.ts';
import { MemorySessionRegistry, RedisSessionRegistry, type SessionRegistry } from './registry.ts';
import { createGateway } from './server.ts';

/**
 * Realtime gateway. Locally (S1-05), from the repo root:
 *   node --env-file=.env.bench backend/apps/gateway/src/main.ts
 * STT_PROVIDER=deepgram turns on live transcription (paid API, dev/test use decided 2026-11-03);
 * the default `none` stores and acknowledges audio without calling any vendor.
 * Deployed (`APP_ENV=staging|production`, S2-04, docs/STAGING_SETUP.md §9): no dev endpoints,
 * sessions come from the API's stream tokens, audio goes to Cloud Storage, state to Redis,
 * results to Postgres; every one of those is required.
 */
const Env = z.object({
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Loopback locally; Cloud Run needs 0.0.0.0. */
  HOST: z.string().min(1).optional(),
  /** Cloud Storage bucket for audio and video (deployed); local disk when unset locally. */
  GCS_AUDIO_BUCKET: z.string().min(3).optional(),
  /** Comma list of allowed WebSocket origins, e.g. chrome-extension://<pinned id> (deployed). */
  ALLOWED_ORIGINS: z.string().min(1).optional(),
  DATA_DIR: z.string().default(resolve(import.meta.dirname, '..', '.data')),
  /** `as_provided` (default, Anirudh 2026-11-06) or `roman_rules` (D-01 Roman by rules). */
  DISPLAY_TEXT: z.enum(['as_provided', 'roman_rules']).default('as_provided'),
  /** Shared session state for several instances (S2-04); in-memory when unset. */
  REDIS_URL: z.string().url().optional(),
  /** Segments, usage and meetings in Postgres (application role); files when unset. */
  DATABASE_URL: z.string().min(1).optional(),
  /** Workspace the dev endpoints record into when DATABASE_URL is set (a signed-in user's). */
  DEV_WORKSPACE_ID: z.string().regex(WORKSPACE_ID).optional(),
  /** Public JWKS (JSON) of the API's signing keys, to accept real stream tokens (ADR-0004). */
  STREAM_TOKEN_JWKS: z.string().min(1).optional(),
});

const env = Env.parse(process.env);

// Dev sessions skip sign-in, so they exist only locally and in CI. A deployed gateway admits API
// stream tokens only and must have every shared dependency, or it would lose data on a restart.
const deployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
if (deployed) {
  const missing = (
    [
      'DATABASE_URL',
      'REDIS_URL',
      'STREAM_TOKEN_JWKS',
      'GCS_AUDIO_BUCKET',
      'ALLOWED_ORIGINS',
    ] as const
  ).filter((name) => env[name] === undefined);
  if (missing.length > 0) {
    console.error(`gateway: ${env.APP_ENV} needs ${missing.join(', ')}`);
    process.exit(1);
  }
}

// STT_PROVIDER and the vendor key come from the provider registry (S2-03, ARCHITECTURE §7.3).
let stt;
try {
  stt = createProviders(process.env).streaming;
} catch (error: unknown) {
  console.error(`gateway: ${error instanceof Error ? error.message : 'provider setup failed'}`);
  process.exit(1);
}

let db: Db | undefined;
if (env.DATABASE_URL !== undefined) {
  if (!deployed && env.DEV_WORKSPACE_ID === undefined) {
    console.error('gateway: DATABASE_URL needs DEV_WORKSPACE_ID for dev sessions');
    process.exit(1);
  }
  db = new Db(createPgPool(env.DATABASE_URL));
  // Refuse to run as a role that bypasses row-level security (ARCHITECTURE §11.3).
  await db.assertRowSecurityEnforced();
}

let registry: SessionRegistry = new MemorySessionRegistry();
if (env.REDIS_URL !== undefined) {
  const redis = new RedisSessionRegistry(env.REDIS_URL);
  await redis.ready();
  registry = redis;
}

const store: ChunkStore =
  env.GCS_AUDIO_BUCKET === undefined
    ? new LocalChunkStore(env.DATA_DIR)
    : new GcsChunkStore(new GcsBucket(env.GCS_AUDIO_BUCKET));

const tracing = startTracing('gateway');
const gateway = createGateway({
  store,
  stt,
  devEndpoints: !deployed,
  registry,
  ...(env.ALLOWED_ORIGINS !== undefined
    ? {
        allowedOrigins: env.ALLOWED_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      }
    : {}),
  ...(env.DEV_WORKSPACE_ID !== undefined ? { workspaceId: env.DEV_WORKSPACE_ID } : {}),
  ...(db !== undefined ? { db } : {}),
  ...(env.STREAM_TOKEN_JWKS !== undefined
    ? { streamTokens: new StreamTokenVerifier(JSON.parse(env.STREAM_TOKEN_JWKS)) }
    : {}),
  display: env.DISPLAY_TEXT === 'roman_rules' ? romanRulesPolicy() : asProvidedPolicy(),
});

const host = env.HOST ?? (deployed ? '0.0.0.0' : '127.0.0.1');
gateway.server.listen(env.PORT, host, () => {
  log('gateway.listening', {
    port: env.PORT,
    host,
    storage: env.GCS_AUDIO_BUCKET === undefined ? 'local' : 'gcs',
    stt: stt?.name ?? 'none',
    appEnv: env.APP_ENV,
    db: db !== undefined,
    redis: env.REDIS_URL !== undefined,
    display: env.DISPLAY_TEXT,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void gateway
      .close()
      .then(() => registry.close())
      .then(() => db?.destroy())
      .then(() => tracing.shutdown())
      .then(() => process.exit(0));
  });
}
