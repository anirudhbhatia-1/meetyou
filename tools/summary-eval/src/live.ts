import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import { createLlmProvider } from '@meetyou/providers';
import { PROMPT_VERSION, summarize, TEMPLATES } from '@meetyou/summarizer';

import { loadGolden, loadRecorded, ROOT, summaryInput, type Recorded } from './golden.ts';
import { aggregate, gate, scoreMeeting, type SetMetrics } from './metrics.ts';
import { readBaseline } from './baseline.ts';

/**
 * Live evaluation run (S3-05): summarizes every golden meeting with the configured LLM, records
 * the outputs in `recorded/` (the CI gate scores those) and compares the metrics with the
 * baseline. Golden meetings are synthetic, so the free Gemini key is allowed here (ADR-0001 §7):
 *   APP_ENV=local LLM_PROVIDER=gemini GEMINI_FREE_TIER_ACCEPTED=true GEMINI_API_KEY=… \
 *     pnpm --filter @meetyou/summary-eval eval:live [-- --baseline] [-- --only g01]
 * `--baseline` accepts the run as the new baseline (after reviewing it). Never real meetings.
 */
const env: Record<string, string | undefined> = { APP_ENV: 'local', ...process.env };
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'ci') {
  console.error('eval:live runs only with APP_ENV=local or ci');
  process.exit(1);
}
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
/** `--recorded`: score the recorded outputs again (metric or validator change), no model calls. */
const offline = args.includes('--recorded');
const llm = offline ? null : createLlmProvider(env);
if (!offline && llm === null) {
  console.error('set LLM_PROVIDER and its key');
  process.exit(1);
}
/** Free-tier request limits: a short pause between meetings. */
const PAUSE_MS = Number(env.EVAL_PAUSE_MS ?? 4000);
const recordedRuns = offline ? loadRecorded() : new Map<string, Recorded>();

const scores: ReturnType<typeof scoreMeeting>[] = [];
for (const g of loadGolden()) {
  if (only !== undefined && !g.id.startsWith(only)) continue;
  const started = Date.now();
  if (offline) {
    const r = recordedRuns.get(g.id);
    if (r === undefined) throw new Error(`no recording for ${g.id}`);
    scores.push(scoreMeeting(g, r.output));
    continue;
  }
  if (llm === null) break;
  let run;
  for (let attempt = 1; ; attempt++) {
    try {
      run = await summarize(summaryInput(g), llm);
      break;
    } catch (error) {
      // Vendor overload (503/429) is transient: wait and try again, as the queue would.
      const retryable = (error as { retryable?: unknown }).retryable === true;
      if (!retryable || attempt >= 4) throw error;
      await sleep(PAUSE_MS * attempt * 3);
    }
  }
  const recorded: Recorded = {
    goldenId: g.id,
    model: run.model,
    promptVersion: PROMPT_VERSION,
    templateVersion: TEMPLATES[g.template].version,
    recordedAt: new Date().toISOString(),
    output: run.output,
  };
  writeFileSync(join(ROOT, 'recorded', `${g.id}.json`), `${JSON.stringify(recorded, null, 2)}\n`);
  const score = scoreMeeting(g, run.output);
  scores.push(score);
  console.log(
    JSON.stringify({
      id: g.id,
      ms: Date.now() - started,
      llmCalls: run.llmCalls,
      actions: score.actions,
      owners: `${score.ownerCorrect}/${score.ownerChecked}`,
      decisions: score.decisions,
      unverified: score.unverified,
      injection: score.injection,
    }),
  );
  await sleep(PAUSE_MS);
}

const metrics: SetMetrics = aggregate(scores);
console.log(JSON.stringify({ metrics }, null, 2));
if (only === undefined && args.includes('--baseline')) {
  writeFileSync(
    join(ROOT, 'baseline.json'),
    `${JSON.stringify(
      { model: llm?.model ?? readBaseline().model, promptVersion: PROMPT_VERSION, metrics },
      null,
      2,
    )}\n`,
  );
  console.log('baseline.json updated');
} else if (only === undefined) {
  const failures = gate(metrics, readBaseline().metrics);
  console.log(failures.length === 0 ? 'gate: pass' : `gate: FAIL\n${failures.join('\n')}`);
  if (failures.length > 0) process.exitCode = 1;
}
