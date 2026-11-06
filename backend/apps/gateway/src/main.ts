import { resolve } from 'node:path';
import process from 'node:process';

import { z } from 'zod';

import { StreamTokenVerifier } from '@meetyou/auth';
import { createPgPool, Db, WORKSPACE_ID } from '@meetyou/db';
import { asProvidedPolicy, romanRulesPolicy } from '@meetyou/hinglish';
import { createProviders } from '@meetyou/providers';

import { LocalChunkStore } from './chunk-store.ts';
import { log } from './log.ts';
import { MemorySessionRegistry, RedisSessionRegistry, type SessionRegistry } from './registry.ts';
import { createGateway } from './server.ts';

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

// Dev sessions skip sign-in and real stream tokens, so they must never run outside local and CI.
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'ci') {
  console.error('gateway: dev endpoints are local/ci only; staging needs the API (S2, ADR-0004)');
  process.exit(1);
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
  if (env.DEV_WORKSPACE_ID === undefined) {
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

const gateway = createGateway({
  store: new LocalChunkStore(env.DATA_DIR),
  stt,
  devEndpoints: true,
  registry,
  ...(env.DEV_WORKSPACE_ID !== undefined ? { workspaceId: env.DEV_WORKSPACE_ID } : {}),
  ...(db !== undefined ? { db } : {}),
  ...(env.STREAM_TOKEN_JWKS !== undefined
    ? { streamTokens: new StreamTokenVerifier(JSON.parse(env.STREAM_TOKEN_JWKS)) }
    : {}),
  display: env.DISPLAY_TEXT === 'roman_rules' ? romanRulesPolicy() : asProvidedPolicy(),
});

gateway.server.listen(env.PORT, '127.0.0.1', () => {
  log('gateway.listening', {
    port: env.PORT,
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
      .then(() => process.exit(0));
  });
}
