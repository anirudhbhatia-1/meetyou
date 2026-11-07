import { z } from 'zod';

import { GEMINI_DEFAULT_MODEL, geminiProvider } from './llm/gemini.ts';
import type { LlmProvider } from './llm/types.ts';
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
  /** Summaries (S3): Gemini API with a key (AGENTS §9, 2026-11-07); `none` calls no vendor. */
  LLM_PROVIDER: z.enum(['none', 'gemini']).default('none'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default(GEMINI_DEFAULT_MODEL),
  /** Set only for development with synthetic or public data (ADR-0001 §7). */
  GEMINI_FREE_TIER_ACCEPTED: z.enum(['true', 'false']).optional(),
  /**
   * Temporary staging-only exception (Anirudh, 2026-11-07, ADR-0001 §7 amendment): the free key on
   * staging until the paid key is in place. Never honoured in production.
   */
  GEMINI_FREE_TIER_ON_STAGING: z.enum(['true', 'false']).optional(),
});
export type ProviderEnv = z.infer<typeof ProviderEnv>;

export interface Providers {
  streaming: SttStreamingProvider | null;
  batch: SttBatchProvider | null;
}

/**
 * The summary LLM (ARCHITECTURE §7.3, §10). A free-tier Gemini key is accepted only in local/CI
 * with synthetic data (`GEMINI_FREE_TIER_ACCEPTED=true`); staging and production need a paid key.
 */
export function createLlmProvider(
  raw: Record<string, string | undefined>,
  deps: { fetch?: typeof fetch } = {},
): LlmProvider | null {
  const env = ProviderEnv.parse(raw);
  assertFreeKeyAllowed(env);
  if (env.LLM_PROVIDER === 'none') return null;
  const key = env.GEMINI_API_KEY;
  if (key === undefined || key === '') throw new Error('LLM_PROVIDER=gemini needs GEMINI_API_KEY');
  return geminiProvider(key, { model: env.GEMINI_MODEL, ...deps });
}

/**
 * The free Gemini key is for development and testing only (AGENTS §9, ADR-0001 §7): Google may
 * train on it, humans may review it, and its terms forbid personal information. Production always
 * refuses it; staging refuses it unless the temporary `GEMINI_FREE_TIER_ON_STAGING=true` exception
 * is set (Anirudh, 2026-11-07, until the paid key is in place).
 */
export function assertFreeKeyAllowed(env: ProviderEnv): void {
  if (env.GEMINI_FREE_TIER_ACCEPTED !== 'true' || DEV_ENVS.has(env.APP_ENV)) return;
  if (env.APP_ENV === 'staging' && env.GEMINI_FREE_TIER_ON_STAGING === 'true') return;
  throw new Error(`free-tier Gemini key refused in ${env.APP_ENV} (ADR-0001 §7)`);
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
