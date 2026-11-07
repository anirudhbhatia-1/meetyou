import { SummaryOutput, summaryOutputJsonSchema } from '@meetyou/contracts';
import {
  LlmOutputError,
  LlmRefusedError,
  type LlmProvider,
  type LlmUsage,
} from '@meetyou/providers';
import type { z } from 'zod';

import { chunkSegments, estimateTokens } from './chunk.ts';
import type { SummaryInput, SummaryLanguage } from './input.ts';
import { asData, inputBlock, PROMPT_VERSION, systemPrompt } from './prompt.ts';
import { TEMPLATES, type SummaryTemplate } from './templates.ts';

export interface SummarizeOptions {
  /** Above this many transcript tokens the meeting is summarized in parts (PRD AI-08). */
  chunkThresholdTokens?: number;
  /** Size of each part when chunked. */
  chunkTokens?: number;
  overlapMs?: number;
  maxOutputTokens?: number;
}

/** One finished run: the unvalidated-for-grounding output plus what produced it (§10.2 step 7). */
export interface SummaryRun {
  /** Schema-valid; citation, owner and date checks are the validation chain's job (S3-02). */
  output: SummaryOutput;
  usage: LlmUsage;
  model: string;
  promptVersion: string;
  template: { id: SummaryTemplate['id']; version: number };
  language: SummaryLanguage;
  llmCalls: number;
  parts: number;
  /** Why answers were retried: schema paths and rule names only, never meeting content. */
  retryReasons: string[];
}

export type SummaryFailure = 'no_transcript' | 'invalid_output' | 'refused';

/** A summary that cannot be produced by retrying now; the job records it and fails visibly. */
export class SummaryFailedError extends Error {
  readonly reason: SummaryFailure;

  constructor(reason: SummaryFailure) {
    super(`summary failed: ${reason}`);
    this.name = 'SummaryFailedError';
    this.reason = reason;
  }
}

/**
 * Defaults: a whole working day of talk fits Gemini's 1M-token window, so chunking is a fallback
 * for unusually long recordings, not the normal path (ARCHITECTURE §10.1).
 */
const DEFAULTS = {
  chunkThresholdTokens: 200_000,
  chunkTokens: 100_000,
  overlapMs: 60_000,
  // [Verify] whether Gemini counts thinking tokens against this limit; generous so a 60-minute
  // meeting's JSON (a few thousand tokens) is never cut off.
  maxOutputTokens: 32_768,
} as const;

const TEMPERATURE = 0.2;

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
  };
}

/** Schema problems as paths and messages only: they go back to the model, never to logs. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 20)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * One structured call with a single retry on unusable or schema-invalid output (§10.2 step 1):
 * the retry carries what was wrong. A refusal is final; HTTP errors propagate so the job queue
 * retries them with backoff.
 */
async function generate(
  llm: LlmProvider,
  system: string,
  input: string,
  maxTokens: number,
  counters: { usage: LlmUsage; calls: number; model: string; retryReasons: string[] },
): Promise<SummaryOutput> {
  let feedback: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const message =
      feedback === null
        ? input
        : `${input}\n<previous_answer_problems>\n${feedback}\n</previous_answer_problems>\n` +
          'Your previous answer was not valid. Answer again with JSON that fixes these problems.';
    try {
      counters.calls += 1;
      const response = await llm.generateStructured({
        system,
        input: message,
        jsonSchema: summaryOutputJsonSchema,
        temperature: TEMPERATURE,
        maxTokens,
      });
      counters.usage = addUsage(counters.usage, response.usage);
      counters.model = response.model;
      const parsed = SummaryOutput.safeParse(response.json);
      if (parsed.success) return parsed.data;
      feedback = describeIssues(parsed.error);
      counters.retryReasons.push(
        ...parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`),
      );
    } catch (error) {
      if (error instanceof LlmRefusedError) throw new SummaryFailedError('refused');
      if (!(error instanceof LlmOutputError)) throw error;
      counters.retryReasons.push(`output:${error.reason}`);
      feedback =
        error.reason === 'truncated'
          ? '- The answer was cut off. Keep every field shorter.'
          : '- The answer was not a JSON object matching the schema.';
    }
  }
  throw new SummaryFailedError('invalid_output');
}

function mergeSystemPrompt(template: SummaryTemplate, language: SummaryLanguage): string {
  return [
    systemPrompt(template, language),
    '',
    'This time the data holds <partial_summaries>: JSON summaries of consecutive parts of one',
    'meeting, in order. Merge them into one summary of the whole meeting:',
    '- one title and one overview for the whole meeting;',
    '- one anchored_sections entry per note, combining the details from every part;',
    '- the same decision, action item or question from two parts appears once, with the union',
    '  of their segment_ids;',
    '- use only segment IDs that appear in the partial summaries.',
  ].join('\n');
}

/**
 * Summarizes one meeting (S3-01, ARCHITECTURE §10.1): a single pass for typical meetings, parts
 * plus a merge pass above `chunkThresholdTokens`. Returns schema-valid output; the validation chain
 * (S3-02) then checks citations, owners and dates against the meeting's own data.
 */
export async function summarize(
  input: SummaryInput,
  llm: LlmProvider,
  options: SummarizeOptions = {},
): Promise<SummaryRun> {
  const o = { ...DEFAULTS, ...options };
  if (!input.segments.some((s) => !s.echo && s.text.trim() !== '')) {
    throw new SummaryFailedError('no_transcript');
  }
  const template = TEMPLATES[input.template];
  const system = systemPrompt(template, input.language);
  const counters = {
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
    calls: 0,
    model: llm.model,
    retryReasons: [] as string[],
  };

  const whole = inputBlock(input);
  let output: SummaryOutput;
  let parts = 1;
  if (estimateTokens(whole) <= o.chunkThresholdTokens) {
    output = await generate(llm, system, whole, o.maxOutputTokens, counters);
  } else {
    const windows = chunkSegments(input.segments, o.chunkTokens, o.overlapMs);
    parts = windows.length;
    const partials: SummaryOutput[] = [];
    for (const [i, window] of windows.entries()) {
      const block = inputBlock(input, window, { index: i + 1, count: windows.length });
      partials.push(await generate(llm, system, block, o.maxOutputTokens, counters));
    }
    const notes = input.notes.map((n) => `[${n.id}] ${asData(n.text)}`).join('\n');
    const participants = input.participants.map((p) => `${p.id} | ${asData(p.name)}`).join('\n');
    const mergeInput = [
      `<participants>\n${participants}\n</participants>`,
      `<notes>\n${notes}\n</notes>`,
      // Partial summaries are model output built from meeting data: data again, not instructions.
      `<partial_summaries>\n${partials.map((p) => asData(JSON.stringify(p))).join('\n')}\n</partial_summaries>`,
    ].join('\n');
    output = await generate(
      llm,
      mergeSystemPrompt(template, input.language),
      mergeInput,
      o.maxOutputTokens,
      counters,
    );
  }

  return {
    output,
    usage: counters.usage,
    model: counters.model,
    promptVersion: PROMPT_VERSION,
    template: { id: template.id, version: template.version },
    language: input.language,
    llmCalls: counters.calls,
    parts,
    retryReasons: counters.retryReasons,
  };
}
