import process from 'node:process';

import { newUlid } from '@meetyou/contracts';
import { STANDUP_HINGLISH } from '@meetyou/fixtures';
import { createLlmProvider } from '@meetyou/providers';

import { summarySegments } from './input.ts';
import { summarize, SummaryFailedError } from './summarize.ts';

/**
 * Summarizes the synthetic Hinglish standup (shared/fixtures) with the configured LLM, to read real
 * model output during S3 development. Synthetic data only, so the free Gemini key is allowed here
 * and nowhere else (ADR-0001 §7):
 *   APP_ENV=local LLM_PROVIDER=gemini GEMINI_FREE_TIER_ACCEPTED=true GEMINI_API_KEY=… \
 *     pnpm --filter @meetyou/summarizer summarize:fixture
 * Never point it at a real meeting.
 */
const env: Record<string, string | undefined> = { APP_ENV: 'local', ...process.env };
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'ci') {
  console.error('summarize:fixture runs only with APP_ENV=local or ci');
  process.exit(1);
}
const llm = createLlmProvider(env);
if (llm === null) {
  console.error('set LLM_PROVIDER=gemini and GEMINI_API_KEY');
  process.exit(1);
}

const segments = STANDUP_HINGLISH.map((u) => ({
  id: `seg_${newUlid()}`,
  workspaceId: 'ws_fixture',
  meetingId: 'mtg_fixture',
  lane: u.lane,
  ...(u.speaker !== undefined ? { speakerClusterId: `spk_${u.speaker}` } : {}),
  startMs: u.startMs,
  endMs: u.endMs,
  text: u.text,
  rawText: u.text,
  language: u.language,
  source: 'live' as const,
  flags: [] as ('echo' | 'low_confidence')[],
}));
const lastEnd = segments.at(-1)?.endMs ?? 0;
const LANGUAGES = ['english', 'hindi', 'hinglish'] as const;

const started = Date.now();
try {
  const run = await summarize(
    {
      meeting: { title: 'Daily standup', date: '2026-11-07', durationMs: lastEnd },
      participants: [{ id: 'prt_self', name: 'Aman', isSelf: true }],
      notes: [],
      segments: summarySegments(segments, 'Aman'),
      template: 'standup',
      language: LANGUAGES.find((l) => l === env.SUMMARY_LANGUAGE) ?? 'hinglish',
    },
    llm,
  );
  console.log(JSON.stringify(run.output, null, 2));
  console.log(
    JSON.stringify({
      model: run.model,
      promptVersion: run.promptVersion,
      template: run.template,
      llmCalls: run.llmCalls,
      retryReasons: run.retryReasons,
      usage: run.usage,
      ms: Date.now() - started,
    }),
  );
} catch (error) {
  console.error(error instanceof SummaryFailedError ? error.message : error);
  process.exitCode = 1;
}
