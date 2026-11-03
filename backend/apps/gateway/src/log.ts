/**
 * Structured logs with IDs, counts and codes only (AGENTS §7): no transcript text, audio, names,
 * emails or tokens. Values are restricted to primitives so free text cannot slip in by accident.
 */
export type LogFields = Record<string, string | number | boolean | null>;

export function log(event: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name}:${code}` : error.name;
  }
  return 'UnknownError';
}
