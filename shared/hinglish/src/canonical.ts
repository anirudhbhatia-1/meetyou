import { z } from 'zod';

import data from '../data/hinglish-canonical.json' with { type: 'json' };

/** Canonical Hinglish spelling list (S0-03, STT_BENCHMARK_PLAN §4.2). */
export const CanonicalList = z.object({
  version: z.string(),
  entries: z.array(
    z.object({
      canonical: z.string(),
      variants: z.array(z.string()),
      /** Forms that are also other words ("he", "na"): never rewritten in display text. */
      ambiguous: z.array(z.string()).optional(),
    }),
  ),
  splits: z.record(z.string(), z.string()),
  fillers: z.array(z.string()),
});
export type CanonicalList = z.infer<typeof CanonicalList>;

/** The bundled list, validated once. */
export const CANONICAL_LIST: CanonicalList = CanonicalList.parse(data);
