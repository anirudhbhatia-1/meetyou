import { LlmHttpError, type LlmProvider } from './types.ts';

/**
 * One retry on a second model when the first is overloaded or down (429/5xx). Gemini answered 503
 * for every attempt of a summary over ~1.5 h on 2026-11-13; another model usually still answers.
 * Other failures (bad request, refusal, invalid output) are the caller's to handle, unchanged.
 * The response names the model that answered, so stored summaries and costs stay accurate.
 */
export function withFallback(primary: LlmProvider, fallback: LlmProvider): LlmProvider {
  return {
    name: primary.name,
    model: primary.model,
    async generateStructured(request) {
      try {
        return await primary.generateStructured(request);
      } catch (error) {
        if (!(error instanceof LlmHttpError) || !error.retryable) throw error;
        return fallback.generateStructured(request);
      }
    },
  };
}
