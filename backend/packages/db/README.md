# @meetyou/db (S2-01)

PostgreSQL schema, migrations and the workspace-scoped data-access layer (ARCHITECTURE §11,
PRD §13).

- **Migrations:** plain SQL in `migrations/NNNN_name.sql`, applied in order, each in a
  transaction, recorded in `schema_migrations` (`src/migrate.ts`).
- **Tenancy (§11.3):** every tenant table has `workspace_id` and forced row-level security keyed
  on `app.workspace_id`. `Db.inWorkspace(workspaceId, tx => …)` sets it for one transaction; there
  is no unscoped query method. Children of a meeting reference `(meeting_id, workspace_id)`, so a
  row cannot point at another workspace's meeting.
- **Users** have no `workspace_id`; a row is visible only to its own sign-in. First sign-in goes
  through `app_sign_in_google_user()` (`Db.signInGoogleUser`), which creates the user, a personal
  workspace, the owner membership and default settings.
- **Roles:** run migrations as the application role (`meetyou_app` in Cloud SQL) so it owns the
  tables; `FORCE ROW LEVEL SECURITY` then applies to it. Never connect the app as a superuser or a
  role with `BYPASSRLS`: those skip the policies.
- **Library:** Kysely with `CamelCasePlugin` (TypeScript camelCase ↔ SQL snake_case), `pg` driver.

## Commands (repo root)

| Command | What it does |
|---|---|
| `pnpm --filter @meetyou/db test` | Tenancy and schema tests on PGlite (in-process Postgres; no server needed) |
| `DATABASE_URL=… node backend/packages/db/src/migrate-cli.ts` | Applies pending migrations to a real database |

## Not yet

- TODO(S2-10): a cross-workspace path for the retention scheduler (it must find due rows in all
  workspaces); planned as a narrow function, not a `BYPASSRLS` role.
- TODO(S2-06): graphile-worker schema and the `add_job` wrapper (ADR-0005).
- Full-text search columns (S3-09) and pgvector (Phase 2).
