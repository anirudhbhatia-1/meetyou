import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** The minimum a migration needs: run a multi-statement script, and a parameterised query. */
export interface SqlRunner {
  exec(script: string): Promise<void>;
  query(sql: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'migrations');

const FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
/** Session advisory lock held while migrating, so two deploys cannot run migrations at once. */
const MIGRATION_LOCK = 72_740_001;

interface MigrationFile {
  version: string;
  name: string;
  script: string;
  checksum: string;
}

async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((name) => FILE.test(name)).sort();
  const out: MigrationFile[] = [];
  for (const name of files) {
    const version = name.slice(0, 4);
    // Two developers can pick the same number; the second file would otherwise never run.
    const clash = out.find((m) => m.version === version);
    if (clash !== undefined) {
      throw new Error(`migrations ${clash.name} and ${name} share version ${version}`);
    }
    const script = await readFile(join(dir, name), 'utf8');
    out.push({
      version,
      name,
      script,
      checksum: createHash('sha256').update(script).digest('hex'),
    });
  }
  return out;
}

/**
 * Applies `migrations/NNNN_name.sql` in order, each in its own transaction, recording version,
 * name and checksum in `schema_migrations`. Plain SQL files keep migrations reviewable and
 * tool-agnostic (ADR-0002). Refuses duplicate versions and edits to already-applied files.
 * Run as the application role, which then owns the tables (row security is forced on owners).
 * Returns the versions applied by this call.
 */
export async function migrate(runner: SqlRunner, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = await readMigrations(dir);
  await runner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
  try {
    await runner.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (' +
        'version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, ' +
        'applied_at timestamptz NOT NULL DEFAULT now())',
    );
    // Read after taking the lock: another runner may have just applied some.
    const done = new Map(
      (await runner.query('SELECT version, checksum FROM schema_migrations', [])).rows.map((r) => [
        String(r.version),
        String(r.checksum),
      ]),
    );
    const applied: string[] = [];
    for (const file of files) {
      const recorded = done.get(file.version);
      if (recorded !== undefined) {
        if (recorded !== file.checksum) {
          throw new Error(`migration ${file.name} changed after it was applied; add a new one`);
        }
        continue;
      }
      await runner.exec('BEGIN');
      try {
        await runner.exec(file.script);
        await runner.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [file.version, file.name, file.checksum],
        );
        await runner.exec('COMMIT');
      } catch (error: unknown) {
        await runner.exec('ROLLBACK');
        throw new Error(`migration ${file.name} failed`, { cause: error });
      }
      applied.push(file.version);
    }
    return applied;
  } finally {
    await runner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
  }
}
