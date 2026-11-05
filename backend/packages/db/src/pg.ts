import pg from 'pg';

import type { SqlRunner } from './migrate.ts';

/**
 * Connection pool for Cloud SQL / local Postgres. The connection string comes from the environment
 * (Secret Manager in staging), never from code. TODO(S2-04): pool size per Cloud Run instance.
 */
export function createPgPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, types: TYPE_PARSERS });
}

const INT8_OID = 20;
const DATE_OID = 1082;

/**
 * Same JavaScript types as the PGlite test database (`testing.ts`), so tests see what production
 * sees: int8 as number (byte counts and durations stay far below 2^53), `date` as its
 * 'YYYY-MM-DD' text (a Date would shift by the server's timezone). numeric stays a string.
 */
export const TYPE_PARSERS: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === INT8_OID) return (value: string) => Number(value);
    if (oid === DATE_OID) return (value: string) => value;
    return pg.types.getTypeParser(oid, format);
  }) as pg.CustomTypesConfig['getTypeParser'],
};

/** Migration runner over one dedicated client (BEGIN/COMMIT must share a connection). */
export function pgRunner(client: pg.ClientBase): SqlRunner {
  return {
    async exec(script) {
      await client.query(script);
    },
    async query(sql, params) {
      const result = await client.query(sql, [...params]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}
