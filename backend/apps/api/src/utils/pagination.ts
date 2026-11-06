/**
 * Cursor-based pagination utilities (ARCHITECTURE §12.2).
 * Formats outputs matching the `page<T>` contract `{ items: T[], nextCursor: string | null }`.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface CursorPayload {
  id: string;
  createdAtMs?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

/** Parses and bounds a pagination limit query param. */
export function parseLimit(
  rawLimit: unknown,
  defaultLimit = DEFAULT_PAGE_LIMIT,
  maxLimit = MAX_PAGE_LIMIT,
): number {
  if (typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0) {
    return Math.min(rawLimit, maxLimit);
  }
  if (typeof rawLimit === 'string') {
    const parsed = parseInt(rawLimit, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.min(parsed, maxLimit);
    }
  }
  return defaultLimit;
}

/** Serializes a cursor object into a URL-safe base64 string. */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Deserializes a URL-safe base64 cursor string. Returns null if invalid or malformed. */
export function decodeCursor(cursor: string | undefined | null): CursorPayload | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id === '') return null;
    return {
      id: obj.id,
      createdAtMs: typeof obj.createdAtMs === 'number' ? obj.createdAtMs : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Slices a query result containing up to `limit + 1` records, producing the current page
 * and computing `nextCursor`.
 */
export function paginate<T>(
  fetchedItems: readonly T[],
  limit: number,
  getCursorPayload: (item: T) => CursorPayload,
): PaginatedResult<T> {
  const hasMore = fetchedItems.length > limit;
  const items = hasMore ? fetchedItems.slice(0, limit) : [...fetchedItems];
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem !== undefined ? encodeCursor(getCursorPayload(lastItem)) : null;

  return {
    items,
    nextCursor,
  };
}
