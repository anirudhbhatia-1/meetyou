import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** The minimum a migration needs: run a multi-statement script, and a parameterised query. */
export interface SqlRunner {
  exec(script: string): Promise<void>;
  query(sql: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'migrations');

const FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Applies `migrations/NNNN_name.sql` in order, each in its own transaction, recording it in
 * `schema_migrations`. Plain SQL files keep migrations reviewable and tool-agnostic (ADR-0002).
 * Run as the application role, which then owns the tables (row security is forced on owners).
 * Returns the versions applied by this call.
 */
export async function migrate(runner: SqlRunner, dir = MIGRATIONS_DIR): Promise<string[]> {
  await runner.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      'version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set(
    (await runner.query('SELECT version FROM schema_migrations', [])).rows.map((r) =>
      String(r.version),
    ),
  );
  const files = (await readdir(dir)).filter((name) => FILE.test(name)).sort();
  const applied: string[] = [];
  for (const name of files) {
    const version = name.slice(0, 4);
    if (done.has(version)) continue;
    const script = await readFile(join(dir, name), 'utf8');
    await runner.exec('BEGIN');
    try {
      await runner.exec(script);
      await runner.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await runner.exec('COMMIT');
    } catch (error: unknown) {
      await runner.exec('ROLLBACK');
      throw new Error(`migration ${name} failed`, { cause: error });
    }
    applied.push(version);
  }
  return applied;
}
