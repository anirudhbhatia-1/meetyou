import { z } from 'zod';

import { deepgramBatchProvider } from './stt/deepgram-batch.ts';
import { deepgramProvider } from './stt/deepgram-streaming.ts';
import type { SttBatchProvider, SttStreamingProvider } from './stt/types.ts';

/** Environments where synthetic or public data only is processed (ADR-0001 §7). */
const DEV_ENVS = new Set(['local', 'ci']);

export const ProviderEnv = z.object({
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  /** Phase 1: Deepgram only (ADR-0001 §0); `none` calls no vendor. */
  STT_PROVIDER: z.enum(['none', 'deepgram']).default('none'),
  DEEPGRAM_API_KEY: z.string().optional(),
  /** Set only for development with synthetic or public data (ADR-0001 §7). */
  GEMINI_FREE_TIER_ACCEPTED: z.enum(['true', 'false']).optional(),
});
export type ProviderEnv = z.infer<typeof ProviderEnv>;

export interface Providers {
  streaming: SttStreamingProvider | null;
  batch: SttBatchProvider | null;
}

/**
 * The free Gemini key is for development and testing only (AGENTS §9, ADR-0001 §7): Google may
 * train on it and humans may review it. Staging and production refuse to start with it.
 */
export function assertFreeKeyAllowed(env: ProviderEnv): void {
  if (env.GEMINI_FREE_TIER_ACCEPTED === 'true' && !DEV_ENVS.has(env.APP_ENV)) {
    throw new Error(`free-tier Gemini key refused in ${env.APP_ENV} (ADR-0001 §7)`);
  }
}

/**
 * Builds the configured providers (ARCHITECTURE §7.3). Data-use controls live inside each adapter
 * and cannot be turned off here (Deepgram always sends `mip_opt_out=true`).
 */
export function createProviders(raw: Record<string, string | undefined>): Providers {
  const env = ProviderEnv.parse(raw);
  assertFreeKeyAllowed(env);
  if (env.STT_PROVIDER === 'none') return { streaming: null, batch: null };
  const key = env.DEEPGRAM_API_KEY;
  if (key === undefined || key === '') {
    throw new Error('STT_PROVIDER=deepgram needs DEEPGRAM_API_KEY');
  }
  return { streaming: deepgramProvider(key), batch: deepgramBatchProvider(key) };
}
