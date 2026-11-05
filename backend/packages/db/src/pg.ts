import pg from 'pg';

import type { SqlRunner } from './migrate.ts';

/**
 * Connection pool for Cloud SQL / local Postgres. The connection string comes from the environment
 * (Secret Manager in staging), never from code. TODO(S2-04): pool size per Cloud Run instance.
 */
export function createPgPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

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
