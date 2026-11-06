import pg from 'pg';

import type { SqlRunner } from './migrate.ts';

/**
 * Connection pool for Cloud SQL / local Postgres. The connection string comes from the environment
 * (Secret Manager in staging), never from code. Pool size is per Cloud Run instance: the total,
 * Σ (max instances × `PG_POOL_MAX`) over API, gateway, worker and jobs, must stay under the
 * instance's `max_connections` (STAGING_SETUP §6). Default 10.
 */
export function createPgPool(
  connectionString: string,
  max: number = poolMax(process.env.PG_POOL_MAX),
): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, types: TYPE_PARSERS });
  attachPoolErrorHandlers(pool);
  return pool;
}

export function poolMax(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 10;
}

/**
 * Without these, an idle connection that Cloud SQL closes (maintenance, failover, network) emits
 * an unhandled 'error' and crashes the process; pg then simply opens a new connection on the next
 * query. graphile-worker asks for both handlers (err.red/wpeh). Logs carry the code only.
 */
export function attachPoolErrorHandlers(pool: pg.Pool): void {
  const report = (scope: 'pool' | 'client') => (error: Error & { code?: string }) => {
    console.error(
      JSON.stringify({ event: 'pg.connection_error', scope, code: error.code ?? error.name }),
    );
  };
  pool.on('error', report('pool'));
  pool.on('connect', (client) => client.on('error', report('client')));
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
