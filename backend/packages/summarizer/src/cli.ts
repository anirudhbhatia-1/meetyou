import process from 'node:process';

import { newUlid } from '@meetyou/contracts';
import { STANDUP_HINGLISH } from '@meetyou/fixtures';
import { createLlmProvider } from '@meetyou/providers';

import { summarySegments } from './input.ts';
import { answerQuestion } from './ask.ts';
import { GenerationFailedError } from './generate.ts';
import { summarize } from './summarize.ts';

/**
 * Summarizes the synthetic Hinglish standup (shared/fixtures) with the configured LLM, to read real
 * model output during S3 development. Synthetic data only, so the free Gemini key is allowed here
 * and nowhere else (ADR-0001 §7):
 *   APP_ENV=local LLM_PROVIDER=gemini GEMINI_FREE_TIER_ACCEPTED=true GEMINI_API_KEY=… \
 *     pnpm --filter @meetyou/summarizer summarize:fixture
 * With ASK_QUESTION="…" it asks that question about the standup instead (Ask this meeting).
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
if (env.ASK_QUESTION !== undefined) {
  try {
    const run = await answerQuestion(
      {
        meeting: {
          title: 'Daily standup',
          date: '2026-11-07',
          durationMs: lastEnd,
          startedAt: '7 Nov 2026, 10:00 GMT+5:30',
          endedAt: '7 Nov 2026, 10:01 GMT+5:30',
        },
        participants: [{ id: 'prt_self', name: 'Aman', isSelf: true }],
        notes: [],
        segments: summarySegments(segments, 'Aman'),
      },
      env.ASK_QUESTION,
      llm,
    );
    console.log(
      JSON.stringify({
        ...run.output,
        llmCalls: run.llmCalls,
        retryReasons: run.retryReasons,
        ms: Date.now() - started,
      }),
    );
  } catch (error) {
    console.error(error instanceof GenerationFailedError ? error.message : error);
    process.exitCode = 1;
  }
  process.exit();
}
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
  console.error(error instanceof GenerationFailedError ? error.message : error);
  process.exitCode = 1;
}
