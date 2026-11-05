import {
  CamelCasePlugin,
  Kysely,
  PostgresDialect,
  sql,
  type PostgresPool,
  type Transaction,
} from 'kysely';

import type { Database } from './schema.ts';

/** Workspace IDs are prefixed ULIDs (ARCHITECTURE §11.2). */
export const WORKSPACE_ID = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;

export type WorkspaceTx = Transaction<Database>;

export interface GoogleProfile {
  googleSub: string;
  email: string;
  displayName: string;
}

/** Caller-generated IDs for a first sign-in (prefixed ULIDs). */
export interface NewAccountIds {
  userId: string;
  workspaceId: string;
  membershipId: string;
  settingsId: string;
}

export interface SignInResult {
  userId: string;
  workspaceId: string;
  created: boolean;
}

/**
 * Data access with tenancy enforcement (ARCHITECTURE §11.3). There is no unscoped query method:
 * every read and write runs in `inWorkspace`, which sets `app.workspace_id` for that transaction
 * only (SET LOCAL semantics), and the row-level security policies see nothing else. Either layer
 * alone would catch most mistakes; together they make cross-tenant leaks very unlikely.
 */
export class Db {
  readonly #kysely: Kysely<Database>;

  constructor(pool: PostgresPool) {
    this.#kysely = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
      plugins: [new CamelCasePlugin()],
    });
  }

  /** Runs `work` in one transaction that can see only `workspaceId`'s rows. */
  async inWorkspace<T>(workspaceId: string, work: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
    if (!WORKSPACE_ID.test(workspaceId)) throw new Error('invalid workspace id');
    return this.#kysely.transaction().execute(async (tx) => {
      await sql`select set_config('app.workspace_id', ${workspaceId}, true)`.execute(tx);
      return work(tx);
    });
  }

  /**
   * Google sign-in bootstrap (ADR-0004): finds the user by Google subject, or creates the user,
   * a personal workspace, the owner membership and default settings in one transaction.
   */
  async signInGoogleUser(profile: GoogleProfile, ids: NewAccountIds): Promise<SignInResult> {
    return this.#kysely.transaction().execute(async (tx) => {
      const { rows } = await sql<{ userId: string; workspaceId: string; created: boolean }>`
        select user_id, workspace_id, created from app_sign_in_google_user(
          ${profile.googleSub}, ${profile.email}, ${profile.displayName},
          ${ids.userId}, ${ids.workspaceId}, ${ids.membershipId}, ${ids.settingsId})`.execute(tx);
      const row = rows[0];
      if (row === undefined) throw new Error('sign-in returned no row');
      return row;
    });
  }

  destroy(): Promise<void> {
    return this.#kysely.destroy();
  }
}
