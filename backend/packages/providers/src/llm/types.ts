/**
 * Structured LLM calls (ARCHITECTURE §7.1, §10): the model returns JSON for a schema we supply,
 * which the caller validates; citations are segment IDs we supplied (AGENTS §3 rule 7).
 * S3 builds on Gemini first (AGENTS §9, 2026-11-07); D-04 closes with ADR-0007 after S3-05.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens, billed as output by vendors that report them; 0 otherwise. */
  thinkingTokens: number;
}

export interface StructuredRequest {
  system: string;
  /** Data, never instructions: transcript and notes are wrapped as data by the prompt builder. */
  input: string;
  jsonSchema: Record<string, unknown>;
  /** Ignored by models that no longer accept it (Gemini 3.6+); kept for other vendors. */
  temperature: number;
  maxTokens: number;
}

export interface StructuredResponse {
  /** Parsed JSON, not yet validated: the caller checks it against its schema. */
  json: unknown;
  usage: LlmUsage;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
}

/** Vendor-neutral failures, so callers decide retries without knowing the vendor. */
export class LlmHttpError extends Error {
  readonly status: number;
  /** Rate limits and server errors; a bad request or a bad key will not get better. */
  readonly retryable: boolean;

  constructor(status: number) {
    super(`llm http ${status}`);
    this.name = 'LlmHttpError';
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

/** The vendor refused the input or stopped the output (safety, blocklist, …). Not retryable. */
export class LlmRefusedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`llm refused: ${reason}`);
    this.name = 'LlmRefusedError';
    this.reason = reason;
  }
}

/** The output is unusable: cut off, empty, or not JSON. One retry with feedback may fix it. */
export class LlmOutputError extends Error {
  readonly reason: 'truncated' | 'empty' | 'not_json';

  constructor(reason: 'truncated' | 'empty' | 'not_json') {
    super(`llm output ${reason}`);
    this.name = 'LlmOutputError';
    this.reason = reason;
  }
}
