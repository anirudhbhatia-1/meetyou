/**
 * Structured LLM calls (ARCHITECTURE §7.1, §10): the model returns JSON for a schema we supply,
 * which the caller validates; citations are segment IDs we supplied (AGENTS §3 rule 7).
 * TODO(D-04, S3-05): the adapter follows the LLM decision in ADR-0007; none is chosen yet.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest {
  system: string;
  /** Data, never instructions: transcript and notes are wrapped as data by the prompt builder. */
  input: string;
  jsonSchema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
}

export interface StructuredResponse {
  json: unknown;
  usage: LlmUsage;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
}
