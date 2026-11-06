/**
 * Structured logs (S2-11, ARCHITECTURE §20): one JSON line per event in the shape Cloud Logging
 * reads (`severity`, `message`), correlated by IDs. AGENTS §7: never transcript text, audio, names,
 * emails or tokens. Field names pass an allow-list and values are short primitives, so free text
 * cannot slip in by accident; anything else is dropped and counted in `dropped`.
 * Log-based metrics and alerts match on `message` (infra/modules/monitoring).
 */
export type LogValue = string | number | boolean | null;
export type LogFields = Record<string, LogValue>;
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

const ALLOWED = new Set([
  'acked',
  'action',
  'appEnv',
  'at',
  'attempt',
  'code',
  'codec',
  'count',
  'db',
  'deleted',
  'display',
  'errorCode',
  'fragments',
  'framesSent',
  'health',
  'host',
  'index',
  'invalid',
  'kind',
  'lane',
  'parts',
  'port',
  'provider',
  'reason',
  'redis',
  'retryable',
  'scope',
  'segments',
  'service',
  'status',
  'step',
  'storage',
  'stt',
  'task',
]);
/** IDs, durations, sizes, counts and costs by suffix (`meetingId`, `durationMs`, `sttMsMe`, …). */
const ALLOWED_SUFFIX = /^[a-z][a-zA-Z0-9]*(Id|Ms|MsMe|MsThem|Count|Bytes|Stored|Usd|Me|Them)$/;
/** Codes and IDs are short and have no spaces; a longer or spaced string is likely content. */
const SAFE_STRING = /^[\w.:/@+-]{0,120}$/;

export function allowedField(name: string): boolean {
  return ALLOWED.has(name) || ALLOWED_SUFFIX.test(name);
}

/** Severity from the event name: `*_failed` / `*.error` → ERROR; refusals → WARNING. */
export function severityOf(event: string): Severity {
  if (/(_failed|[._]error)$/.test(event)) return 'ERROR';
  if (/(rejected|unauthorized|replayed|invalid|bad_message|dead_lettered|evicted)$/.test(event)) {
    return 'WARNING';
  }
  return 'INFO';
}

export function formatLine(
  service: string,
  event: string,
  fields: LogFields,
  severity: Severity = severityOf(event),
  now: Date = new Date(),
): string {
  const kept: LogFields = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    const ok =
      allowedField(key) &&
      (value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && SAFE_STRING.test(value)));
    if (ok) kept[key] = value;
    else dropped += 1;
  }
  return JSON.stringify({
    severity,
    message: event,
    time: now.toISOString(),
    service,
    ...kept,
    ...(dropped > 0 ? { dropped } : {}),
  });
}

export interface Logger {
  log(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(
  service: string,
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  return {
    log: (event, fields = {}) => write(formatLine(service, event, fields)),
    error: (event, fields = {}) => write(formatLine(service, event, fields, 'ERROR')),
  };
}

/** A short, content-free code for an error: its class name and system code. */
export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    // Node uses string codes (ECONNRESET); Google client libraries use HTTP status numbers (403).
    const code = (error as Error & { code?: unknown }).code;
    return typeof code === 'string' || typeof code === 'number'
      ? `${error.name}:${String(code)}`
      : error.name;
  }
  return 'UnknownError';
}
