import { describe, expect, it } from 'vitest';

import { createLlmProvider } from '../registry.ts';
import {
  GEMINI_DEFAULT_MODEL,
  geminiProvider,
  geminiRequestBody,
  parseGeminiResponse,
} from './gemini.ts';
import { LlmHttpError, LlmOutputError, LlmRefusedError, type StructuredRequest } from './types.ts';

const request: StructuredRequest = {
  system: 'rules',
  input: '<transcript>…</transcript>',
  jsonSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { title: { type: 'string' } },
  },
  temperature: 0.2,
  maxTokens: 8192,
};

function reply(text: string, finishReason = 'STOP', extra: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 450 },
    modelVersion: 'gemini-3.6-flash-001',
    ...extra,
  };
}

describe('Gemini request (verified 2026-11-07)', () => {
  it('sends rules as systemInstruction, data as user content, JSON via responseFormat', () => {
    const body = geminiRequestBody(request) as {
      systemInstruction: unknown;
      contents: unknown;
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'rules' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: request.input }] }]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 8192,
      responseFormat: {
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
      },
    });
    // Ignored by Gemini 3.6 and rejected by later models.
    expect(JSON.stringify(body)).not.toContain('temperature');
  });
});

describe('Gemini response', () => {
  it('returns parsed JSON, token usage and the served model version', () => {
    expect(parseGeminiResponse(reply('{"title":"Standup"}'), 'gemini-3.6-flash')).toEqual({
      json: { title: 'Standup' },
      usage: { inputTokens: 1200, outputTokens: 300, thinkingTokens: 450 },
      model: 'gemini-3.6-flash-001',
    });
  });

  it('joins text split across parts', () => {
    const json = {
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
    };
    expect(parseGeminiResponse(json, 'm').json).toEqual({ a: 1 });
  });

  it('maps cut-off, empty and non-JSON output to LlmOutputError', () => {
    const reason = (json: unknown) => {
      try {
        parseGeminiResponse(json, 'm');
      } catch (error) {
        return error instanceof LlmOutputError ? error.reason : 'other';
      }
      return 'none';
    };
    expect(reason(reply('{"title":', 'MAX_TOKENS'))).toBe('truncated');
    expect(reason(reply('  '))).toBe('empty');
    expect(reason({ candidates: [] })).toBe('empty');
    expect(reason(reply('Sure! Here is the summary'))).toBe('not_json');
  });

  it('maps a blocked prompt or a safety stop to LlmRefusedError', () => {
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }, 'm')).toThrow(
      LlmRefusedError,
    );
    expect(() => parseGeminiResponse(reply('{}', 'RECITATION'), 'm')).toThrow(LlmRefusedError);
  });
});

describe('Gemini provider', () => {
  it('posts to the model endpoint with the key in a header, never in the URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = geminiProvider('secret-key', {
      fetch: ((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response(JSON.stringify(reply('{"title":"x"}'))));
      }) as unknown as typeof fetch,
    });
    expect(provider.model).toBe(GEMINI_DEFAULT_MODEL);
    const result = await provider.generateStructured(request);
    expect(result.json).toEqual({ title: 'x' });
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    );
    expect(calls[0]?.url).not.toContain('secret-key');
    expect(new Headers(calls[0]?.init.headers).get('x-goog-api-key')).toBe('secret-key');
  });

  it('reports HTTP failures by status only, retryable for 429 and 5xx', async () => {
    const failing = (status: number) =>
      geminiProvider('k', {
        fetch: (() =>
          Promise.resolve(
            new Response('{"error":{"message":"echoes the request"}}', { status }),
          )) as unknown as typeof fetch,
      }).generateStructured(request);
    await expect(failing(429)).rejects.toMatchObject({ status: 429, retryable: true });
    await expect(failing(503)).rejects.toMatchObject({ status: 503, retryable: true });
    const bad = await failing(400).catch((error: unknown) => error);
    expect(bad).toBeInstanceOf(LlmHttpError);
    expect(bad).toMatchObject({ retryable: false });
    expect(String(bad)).not.toContain('echoes');
  });
});

describe('LLM registry', () => {
  it('builds nothing by default, Gemini with a key, and refuses a free key on staging', () => {
    expect(createLlmProvider({})).toBeNull();
    const gemini = createLlmProvider({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' });
    expect(gemini?.name).toBe('gemini');
    expect(gemini?.model).toBe(GEMINI_DEFAULT_MODEL);
    expect(
      createLlmProvider({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'x' })?.model,
    ).toBe('x');
    expect(() => createLlmProvider({ LLM_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(() =>
      createLlmProvider({
        APP_ENV: 'staging',
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'k',
        GEMINI_FREE_TIER_ACCEPTED: 'true',
      }),
    ).toThrow(/refused in staging/);
  });
});
