// Creates or updates meetyou_app on the Supabase staging database (ADR-0012 §2.3) and checks
// that it can log in through the session pooler. Run from the repo root:
//   read -rs PGADMIN && PGADMIN="$PGADMIN" node infra/azure/create-app-role.mjs; unset PGADMIN
// PGADMIN is the project's postgres password. meetyou_app's password comes from
// infra/azure/terraform.tfvars. Prints role flags only, never a password.
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(new URL('../../backend/packages/db/package.json', import.meta.url));
const pg = require('pg');
const vars = readFileSync(new URL('./terraform.tfvars', import.meta.url), 'utf8');
const get = (k) => vars.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
const host = get('database_host');
const appUser = get('database_user'); // meetyou_app.<ref>
const appPw = get('db_app_password');
const ref = appUser.split('.')[1];
const adminPw = process.env.PGADMIN;
if (!adminPw) throw new Error('set PGADMIN (the postgres password) first');
if (!/^[A-Za-z0-9]+$/.test(appPw)) throw new Error('unexpected meetyou_app password characters');

// Supabase signs with its own CA; TLS stays on (ADR-0012 §2.3).
const ssl = { rejectUnauthorized: false };
const base = { host, port: 5432, database: 'postgres', ssl };

const admin = new pg.Client({ ...base, user: `postgres.${ref}`, password: adminPw });
await admin.connect();
const exists =
  (await admin.query("select 1 from pg_roles where rolname = 'meetyou_app'")).rowCount > 0;
// The password is alphanumeric (checked above), so it cannot break out of the literal.
await admin.query(
  `${exists ? 'ALTER' : 'CREATE'} ROLE meetyou_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${appPw}'`,
);
await admin.query('GRANT CONNECT, CREATE ON DATABASE postgres TO meetyou_app');
await admin.query('GRANT USAGE, CREATE ON SCHEMA public TO meetyou_app');
const role = await admin.query(
  "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'meetyou_app'",
);
console.log(`meetyou_app ${exists ? 'updated' : 'created'}:`, JSON.stringify(role.rows[0]));
await admin.end();

const app = new pg.Client({ ...base, user: appUser, password: appPw });
await app.connect();
const who = await app.query('select current_user, version()');
console.log(
  'pooler login as',
  who.rows[0].current_user,
  'OK;',
  who.rows[0].version.split(' on ')[0],
);
await app.end();
