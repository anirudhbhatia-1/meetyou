import { createLogger, type LogFields } from '@meetyou/log';

export { errorCode, type LogFields } from '@meetyou/log';

const logger = createLogger('gateway');

/**
 * Structured logs with IDs, counts and codes only (AGENTS §7), through the shared allow-list
 * (`@meetyou/log`); severity follows the event name (`*_failed` → ERROR).
 */
export function log(event: string, fields: LogFields = {}): void {
  logger.log(event, fields);
}
