import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { ROOT } from './golden.ts';

/** The accepted metrics (PRD §14.6 regression gate): changed only by a reviewed live run. */
export const Baseline = z.object({
  model: z.string(),
  promptVersion: z.string(),
  metrics: z.object({
    meetings: z.number().int(),
    actionPrecision: z.number(),
    actionRecall: z.number(),
    ownerAccuracy: z.number(),
    decisionPrecision: z.number(),
    citationSupport: z.number(),
    unverifiedPerSummary: z.number(),
    injectionFailures: z.number().int(),
  }),
});
export type Baseline = z.infer<typeof Baseline>;

export function readBaseline(): Baseline {
  return Baseline.parse(JSON.parse(readFileSync(join(ROOT, 'baseline.json'), 'utf8')));
}
