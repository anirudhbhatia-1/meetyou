import {
  LlmOutputError,
  LlmRefusedError,
  type LlmProvider,
  type LlmUsage,
} from '@meetyou/providers';
import type { z } from 'zod';

export type GenerationFailure = 'no_transcript' | 'too_long' | 'invalid_output' | 'refused';

/** A summary or answer that retrying now cannot produce; the caller fails visibly. */
export class GenerationFailedError extends Error {
  readonly reason: GenerationFailure;

  constructor(reason: GenerationFailure) {
    super(`generation failed: ${reason}`);
    this.name = 'GenerationFailedError';
    this.reason = reason;
  }
}

/** Running totals across every model call of one summary or answer. */
export interface GenerationCounters {
  usage: LlmUsage;
  calls: number;
  model: string;
  /** Why answers were retried: schema paths and rule names only, never meeting content. */
  retryReasons: string[];
}

export function newCounters(model: string): GenerationCounters {
  return {
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
    calls: 0,
    model,
    retryReasons: [],
  };
}

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
 * One structured call with a single retry on unusable or schema-invalid output (ARCHITECTURE
 * §10.2 step 1): the retry carries what was wrong. A refusal is final; HTTP errors propagate so the
 * caller (job queue, API) decides about retrying later.
 */
export async function generateValidated<T>(
  llm: LlmProvider,
  request: {
    system: string;
    input: string;
    schema: z.ZodType<T>;
    jsonSchema: Record<string, unknown>;
    maxTokens: number;
  },
  counters: GenerationCounters,
): Promise<T> {
  let feedback: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const input =
      feedback === null
        ? request.input
        : `${request.input}\n<previous_answer_problems>\n${feedback}\n</previous_answer_problems>\n` +
          'Your previous answer was not valid. Answer again with JSON that fixes these problems.';
    try {
      counters.calls += 1;
      const response = await llm.generateStructured({
        system: request.system,
        input,
        jsonSchema: request.jsonSchema,
        temperature: TEMPERATURE,
        maxTokens: request.maxTokens,
      });
      counters.usage = addUsage(counters.usage, response.usage);
      counters.model = response.model;
      const parsed = request.schema.safeParse(response.json);
      if (parsed.success) return parsed.data;
      feedback = describeIssues(parsed.error);
      counters.retryReasons.push(
        ...parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`),
      );
    } catch (error) {
      if (error instanceof LlmRefusedError) throw new GenerationFailedError('refused');
      if (!(error instanceof LlmOutputError)) throw error;
      counters.retryReasons.push(`output:${error.reason}`);
      feedback =
        error.reason === 'truncated'
          ? '- The answer was cut off. Keep every field shorter.'
          : '- The answer was not a JSON object matching the schema.';
    }
  }
  throw new GenerationFailedError('invalid_output');
}
