import { describe, expect, it } from 'vitest';

import { withFallback } from './fallback.ts';
import {
  LlmHttpError,
  LlmRefusedError,
  type LlmProvider,
  type StructuredRequest,
} from './types.ts';

const request: StructuredRequest = {
  system: 's',
  input: 'i',
  jsonSchema: {},
  temperature: 0,
  maxTokens: 10,
};

function provider(model: string, result: () => unknown, calls: string[]): LlmProvider {
  return {
    name: 'gemini',
    model,
    generateStructured() {
      calls.push(model);
      try {
        const json = result();
        return Promise.resolve({
          json,
          usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
          model,
        });
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
  };
}

describe('withFallback (2026-11-13 Gemini 503 outage)', () => {
  it('answers from the second model when the first is overloaded or down', async () => {
    for (const status of [429, 500, 503]) {
      const calls: string[] = [];
      const llm = withFallback(
        provider(
          'a',
          () => {
            throw new LlmHttpError(status);
          },
          calls,
        ),
        provider('b', () => ({ ok: true }), calls),
      );
      const response = await llm.generateStructured(request);
      expect(response.model).toBe('b');
      expect(calls).toEqual(['a', 'b']);
    }
  });

  it('does not call the second model when the first answers or fails for good', async () => {
    const calls: string[] = [];
    const ok = withFallback(
      provider('a', () => ({}), calls),
      provider('b', () => ({}), calls),
    );
    expect((await ok.generateStructured(request)).model).toBe('a');
    for (const error of [new LlmHttpError(400), new LlmRefusedError('SAFETY')]) {
      const failing = withFallback(
        provider(
          'a',
          () => {
            throw error;
          },
          calls,
        ),
        provider('b', () => ({}), calls),
      );
      await expect(failing.generateStructured(request)).rejects.toBe(error);
    }
    expect(calls).toEqual(['a', 'a', 'a']);
  });

  it('passes the outage on when both models are down, for the queue to retry', async () => {
    const calls: string[] = [];
    const llm = withFallback(
      provider(
        'a',
        () => {
          throw new LlmHttpError(503);
        },
        calls,
      ),
      provider(
        'b',
        () => {
          throw new LlmHttpError(503);
        },
        calls,
      ),
    );
    await expect(llm.generateStructured(request)).rejects.toBeInstanceOf(LlmHttpError);
  });
});
