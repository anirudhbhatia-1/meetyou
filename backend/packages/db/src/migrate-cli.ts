import process from 'node:process';

import { migrate } from './migrate.ts';
import { createPgPool, pgRunner } from './pg.ts';

/**
 * Applies pending migrations as the application role (it then owns the tables):
 *   DATABASE_URL=postgres://meetyou_app@…/meetyou_staging node backend/packages/db/src/migrate-cli.ts
 * The URL comes from the environment (Secret Manager in staging); it is never printed.
 */
const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const pool = createPgPool(url);
const client = await pool.connect();
try {
  const applied = await migrate(pgRunner(client));
  console.log(
    applied.length === 0 ? 'migrations: up to date' : `migrations applied: ${applied.join(', ')}`,
  );
} finally {
  client.release();
  await pool.end();
}
