import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Db, migrate, pgRunner, TYPE_PARSERS } from '@meetyou/db';
import pg from 'pg';

import { installQueueSchema } from './worker.ts';

/**
 * Real Postgres over TCP for graphile-worker (decided 2026-11-06): PGlite served by pglite-socket,
 * whose multiplexer lets several pg connections share the one PGlite session. Test-only.
 * The session runs as the non-superuser `meetyou_app`, as in Cloud SQL, so RLS is enforced.
 */
export async function createQueueTestEnv(): Promise<{
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}> {
  const pglite = await PGlite.create({
    parsers: { 20: (v: string) => Number(v), 1082: (v: string) => v },
  });
  await pglite.exec(`
    CREATE ROLE meetyou_app NOLOGIN;
    GRANT CREATE ON DATABASE postgres TO meetyou_app;
    GRANT CREATE ON SCHEMA public TO meetyou_app;
    SET ROLE meetyou_app;
  `);
  const server = new PGLiteSocketServer({
    db: pglite,
    port: 0,
    host: '127.0.0.1',
    maxConnections: 20,
  });
  await server.start();
  const address = (
    server as unknown as { server?: { address(): { port: number } } }
  ).server?.address();
  if (address === undefined) throw new Error('pglite socket did not start');
  const pool = new pg.Pool({
    connectionString: `postgres://postgres@127.0.0.1:${address.port}/postgres`,
    max: 10,
    types: TYPE_PARSERS,
  });
  // Test pool: connection errors surface as failed queries; graphile-worker also wants per-client handlers.
  pool.on('error', () => undefined);
  pool.on('connect', (client) => client.on('error', () => undefined));
  const client = await pool.connect();
  try {
    await migrate(pgRunner(client));
  } finally {
    client.release();
  }
  await installQueueSchema(pool);
  const db = new Db(pool);
  return {
    pool,
    db,
    async close() {
      await pool.end();
      await server.stop();
      await pglite.close();
    },
  };
}
