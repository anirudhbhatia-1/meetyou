import { z } from 'zod';

import {
  LlmHttpError,
  LlmOutputError,
  LlmRefusedError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from './types.ts';

/**
 * Gemini API (Google AI Studio) `generateContent` with structured output (S3-01; AGENTS §9: Gemini
 * first, API key, no Vertex). Verified against aistudio.google.com docs on 2026-11-07:
 * - endpoint `v1beta/models/{model}:generateContent`, auth header `x-goog-api-key`;
 * - JSON via `generationConfig.responseFormat.text = { mimeType: 'APPLICATION_JSON', schema }`,
 *   standard JSON Schema (type arrays with null, anyOf, $ref; `pattern` is ignored, so callers
 *   must validate the result);
 * - `temperature` is ignored on Gemini 3.6 Flash and "will return HTTP 400" on later models, so it
 *   is never sent; `systemInstruction` carries the rules;
 * - `candidates[].finishReason`, `promptFeedback.blockReason`, `usageMetadata` token counts.
 * Paid-tier key only for real meetings; the free key is refused outside local/CI (registry.ts).
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.6-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** A 60-minute meeting must summarize within the ≤ 40 s LLM budget (ARCHITECTURE §21.2). */
const TIMEOUT_MS = 90_000;

const GeminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).default([]) })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .default([]),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().default(0),
      candidatesTokenCount: z.number().int().nonnegative().default(0),
      thoughtsTokenCount: z.number().int().nonnegative().default(0),
    })
    .default({ promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0 }),
  modelVersion: z.string().optional(),
});

/** Drops JSON Schema metadata the endpoint does not need (`$schema`). */
export function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}

export function geminiRequestBody(request: StructuredRequest): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: request.input }] }],
    generationConfig: {
      maxOutputTokens: request.maxTokens,
      responseFormat: {
        text: { mimeType: 'APPLICATION_JSON', schema: geminiSchema(request.jsonSchema) },
      },
    },
  };
}

/** Turns a `generateContent` reply into parsed JSON and usage, or a vendor-neutral error. */
export function parseGeminiResponse(json: unknown, model: string): StructuredResponse {
  const data = GeminiResponse.parse(json);
  const blocked = data.promptFeedback?.blockReason;
  if (blocked !== undefined && blocked !== 'BLOCK_REASON_UNSPECIFIED') {
    throw new LlmRefusedError(blocked);
  }
  const candidate = data.candidates[0];
  if (candidate === undefined) throw new LlmOutputError('empty');
  const finish = candidate.finishReason ?? 'STOP';
  if (finish === 'MAX_TOKENS') throw new LlmOutputError('truncated');
  if (finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
    throw new LlmRefusedError(finish);
  }
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (text.trim() === '') throw new LlmOutputError('empty');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LlmOutputError('not_json');
  }
  const usage = data.usageMetadata;
  return {
    json: parsed,
    usage: {
      inputTokens: usage.promptTokenCount,
      outputTokens: usage.candidatesTokenCount,
      thinkingTokens: usage.thoughtsTokenCount,
    },
    model: data.modelVersion ?? model,
  };
}

export function geminiProvider(
  apiKey: string,
  options: { model?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): LlmProvider {
  const model = options.model ?? GEMINI_DEFAULT_MODEL;
  const doFetch = options.fetch ?? fetch;
  return {
    name: 'gemini',
    model,
    async generateStructured(request) {
      const response = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody(request)),
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      });
      // The body is not read on errors: it can echo parts of the request (meeting content).
      if (!response.ok) throw new LlmHttpError(response.status);
      return parseGeminiResponse(await response.json(), model);
    },
  };
}
