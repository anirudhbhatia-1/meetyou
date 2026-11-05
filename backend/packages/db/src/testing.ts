import { PGlite } from '@electric-sql/pglite';
import type { PostgresPool, PostgresPoolClient, PostgresQueryResult } from 'kysely';

import { Db } from './db.ts';
import { migrate, type SqlRunner } from './migrate.ts';

/**
 * Test database: real Postgres in-process (PGlite, decided 2026-11-05), so row-level security is
 * tested for real without a local server. Test-only: imports a dev dependency.
 *
 * The session switches to a non-superuser `meetyou_app` role before migrating, as in Cloud SQL,
 * where that role owns the tables. Superusers always bypass row security; this role does not.
 */
export async function createTestDb(): Promise<{ db: Db; pg: PGlite; close(): Promise<void> }> {
  const pg = new PGlite();
  await pg.exec(`
    CREATE ROLE meetyou_app NOLOGIN;
    GRANT CREATE ON SCHEMA public TO meetyou_app;
    SET ROLE meetyou_app;
  `);
  await migrate(pgliteRunner(pg));
  const db = new Db(pglitePool(pg));
  return {
    db,
    pg,
    async close() {
      await db.destroy();
      await pg.close();
    },
  };
}

export function pgliteRunner(pg: PGlite): SqlRunner {
  return {
    async exec(script) {
      await pg.exec(script);
    },
    async query(sql, params) {
      const result = await pg.query<Record<string, unknown>>(sql, [...params]);
      return { rows: result.rows };
    },
  };
}

const COMMANDS = new Set(['UPDATE', 'DELETE', 'INSERT', 'SELECT', 'MERGE']);

/**
 * A `pg.Pool` stand-in over one PGlite connection. PGlite is single-connection, so the pool hands
 * the client to one borrower at a time (Kysely transactions keep it for their duration).
 */
export function pglitePool(pg: PGlite): PostgresPool {
  let queue: Promise<void> = Promise.resolve();
  const client = (release: () => void): PostgresPoolClient =>
    ({
      async query<R>(sql: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<R>> {
        const result = await pg.query<R>(sql, [...parameters]);
        const word = sql.trimStart().split(/\s/, 1)[0]?.toUpperCase() ?? 'SELECT';
        return {
          command: (COMMANDS.has(word) ? word : 'SELECT') as PostgresQueryResult<R>['command'],
          rowCount: result.affectedRows ?? result.rows.length,
          rows: result.rows,
        };
      },
      release,
    }) as PostgresPoolClient;
  return {
    options: {},
    connect() {
      let release: () => void = () => undefined;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = queue.then(() => client(release));
      queue = queue.then(() => next);
      return ready;
    },
    end: () => Promise.resolve(),
  };
}
