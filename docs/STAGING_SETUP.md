# Staging setup runbook

> **Since 2026-11-12 staging runs on Azure, Central India (Pune)** ([ADR-0012](adr/0012-azure-hosting.md)):
> follow **Part A** below. The Google Cloud sections after it (§0–§13) are kept for reference
> (ADR-0002); the GCP project is no longer used. Their rules on the database role, secrets
> handling, deploy order and the security checklist still apply unless Part A says otherwise.

## Part A — Azure staging (current)

**Who runs it:** Anirudh, in **Azure Cloud Shell (Bash)**, which has `az`, `terraform`, `git` and
`psql` **[Verify]**. The agent writes the code and Terraform; nobody pastes secrets into chat,
files in the repo or logs.

```
Chrome extension ──HTTPS──► api (Container App) ──► Postgres Flexible Server 16 (TLS, RLS)
       │                        └─► Blob Storage (user delegation SAS: video PUT / playback GET)
       └──WSS──► gateway (Container App, sticky) ──► Deepgram
                     ├─ audio chunks ──► Blob Storage      └─ sessions ──► Azure Managed Redis
worker (Container App, 1 replica) ◄── graphile-worker jobs in Postgres (video.finalize, retention…)
web (Container App) ──/v1 proxy──► api            Jobs: migrate, smoke     Secrets: Key Vault
```

### A.1 Accounts (once)
1. **Azure free account** (portal.azure.com): needs a Visa/Mastercard card and phone check.
   Open **Cloud Shell → Bash** and check `az account show --query "{id:id, name:name}"`.
2. Register the resource providers (each takes a minute; safe to rerun):
   ```bash
   for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry \
     Microsoft.DBforPostgreSQL Microsoft.Cache Microsoft.KeyVault Microsoft.Storage \
     Microsoft.ManagedIdentity; do az provider register --namespace $ns; done
   ```
3. **Google sign-in** (ADR-0004) stays with Google. Create a **new Google Cloud project without
   billing** (none is needed for OAuth), then do §7.2 steps 1–3 there. The redirect URIs come in A.8.

### A.2 Terraform, phase 1: everything except the apps and jobs
```bash
git clone https://github.com/anirudhbhatia-1/meetyou.git && cd meetyou/infra/azure
cp terraform.tfvars.example terraform.tfvars   # fill it in with the Cloud Shell editor: `code terraform.tfvars`
```
- `subscription_id` from A.1; `unique_suffix` any 4–8 lowercase letters/digits;
  `image_tag = "bootstrap"` for now; two different random passwords
  (`openssl rand -base64 36 | tr -d '/+='`); `google_client_id` from A.1.3;
  `stream_token_jwks = "{}"` for now (A.5 fills it).
- `terraform.tfvars` and the state hold passwords and the Redis key: never commit them (gitignored).
  The Cloud Shell home drive keeps them between sessions.
```bash
terraform init
terraform apply \
  -target=azurerm_container_app_environment.main \
  -target=azurerm_key_vault_secret.database_url -target=azurerm_key_vault_secret.redis_url \
  -target=azurerm_role_assignment.runtime_kv_secrets -target=azurerm_role_assignment.runtime_acr_pull \
  -target=azurerm_role_assignment.runtime_blob -target=azurerm_storage_management_policy.recordings \
  -target=azurerm_postgresql_flexible_server_firewall_rule.azure_services \
  -target=azurerm_federated_identity_credential.github_main \
  -target=azurerm_role_assignment.deployer_acr_push -target=azurerm_role_assignment.deployer_apps
```
Targets pull in what they depend on (resource group, registry, Key Vault, storage, Postgres,
Redis, identities). Managed Redis and Postgres take 10–20 minutes. Read the plan before `yes`.
Role assignments take a minute or two to apply: a 403 on a Key Vault secret or the blob container
during the first apply means rerun the same command.

### A.3 Database: the application role
The services and migrations connect as **`meetyou_app`**, which must not be a superuser or bypass
row security (§6). The admin login only creates it.
```bash
RG=$(terraform output -raw resource_group); PG=$(terraform output -raw postgres_host)
MYIP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create -g $RG --name ${PG%%.*} \
  --rule-name cloudshell --start-ip-address $MYIP --end-ip-address $MYIP     # [Verify] flags
psql "host=$PG port=5432 dbname=meetyou user=meetyou_admin sslmode=require"  # admin password from tfvars
```
```sql
CREATE ROLE meetyou_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
\password meetyou_app
-- type db_app_password from terraform.tfvars (not echoed, not in history)
GRANT CONNECT, CREATE ON DATABASE meetyou TO meetyou_app;   -- graphile_worker creates its schema
GRANT USAGE, CREATE ON SCHEMA public TO meetyou_app;
\q
```
```bash
az postgres flexible-server firewall-rule delete -g $RG --name ${PG%%.*} --rule-name cloudshell --yes
```

### A.4 Secrets in Key Vault
Terraform already wrote `database-url` and `redis-url`. Add the others without echoing them
(`read -rs` prompts silently; paste, press Enter):
```bash
KV=$(terraform output -raw key_vault)
put() { read -rs V && printf '%s' "$V" | az keyvault secret set --vault-name $KV --name "$1" --file /dev/stdin -o none; unset V; echo "$1 set"; }
put deepgram-api-key        # the paid staging key, not the dev key
put gemini-api-key          # free key only with gemini_free_tier = true and agreed test meetings
put google-client-secret    # from A.1.3
```
`--file /dev/stdin` is **[Verify]**; if `az` refuses it, use `--value "$V"` inside `put` instead.

Token signing key (ADR-0004 §4.2): a P-256 private JWK made with Node's own crypto, piped straight
into the vault (never printed or saved):
```bash
node -e 'const {generateKeyPairSync}=require("crypto");const k=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey.export({format:"jwk"});console.log(JSON.stringify([{...k,kid:"stg-2026-11",alg:"ES256"}]))' \
  | az keyvault secret set --vault-name $KV --name auth-signing-jwks --file /dev/stdin -o none
```

### A.5 The gateway's public keys
Print only the public half (no `d`) and put it in `terraform.tfvars` as `stream_token_jwks`:
```bash
az keyvault secret show --vault-name $KV --name auth-signing-jwks --query value -o tsv \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.stringify({keys:JSON.parse(s).map(({kty,crv,x,y,kid})=>({kty,crv,x,y,kid,alg:"ES256",use:"sig"}))}))))'
```
(The output is already quoted for HCL: `stream_token_jwks = <paste>`.)

### A.6 GitHub deploys and the first images
1. GitHub → Settings → **Environments → New environment `staging`** → Deployment branches:
   **Selected branches → `main`**. The federated credential trusts only this environment.
2. Settings → Secrets and variables → Actions → **Variables**: add each pair from
   `terraform output github_variables` (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_REGISTRY`). The old `GCP_*` variables
   can be deleted.
3. Actions → **Deploy staging → Run workflow** on `main`. It builds and pushes the six images and
   ends with the notice "Apps not created yet … image_tag=<sha>". Copy that SHA.

### A.7 Terraform, phase 2: jobs, migrations, apps
Set `image_tag = "<sha>"` in `terraform.tfvars`, then:
```bash
terraform apply -target=azurerm_container_app_job.job
../../.github/scripts/run-aca-job.sh meetyou-staging-migrate $RG      # "migrations applied: …"
terraform apply -target=azurerm_container_app.backend -target=azurerm_container_app.web
terraform output   # api_url, web_url, gateway_ws_url
```
The worker starts before the gateway enqueues (it installs the queue schema). From now on every
green CI run on `main` deploys automatically (build → migrate → worker, api, gateway, web → smoke).
Terraform ignores image changes, so a later `apply` never rolls an app back.

### A.8 Sign-in and the extension
1. In the Google project from A.1.3 → Credentials → the web client → Authorized redirect URIs:
   `https://hjimcofnjnikbeepahmclaniopbnhbbe.chromiumapp.org/oauth2` **and**
   `<web_url>/auth/callback`.
2. Tell the agent the `api_url`, `web_url` and client ID: it updates `build:staging` in
   `extension/package.json`, and you rebuild the tester zip.

### A.9 Checks
```bash
curl -s $(terraform output -raw api_url)/health
curl -s https://$(terraform output -raw gateway_ws_url | sed 's#wss://##; s#/v1/stream##')/healthz
curl -s $(terraform output -raw web_url)/config.json
az containerapp logs show -n meetyou-staging-gateway -g $RG --tail 30   # gateway.listening … storage "azure", redis true, db true
az containerapp logs show -n meetyou-staging-worker  -g $RG --tail 30   # worker.started
../../.github/scripts/run-aca-job.sh meetyou-staging-smoke $RG
```
Then the ADR-0012 §4 checks: role check (§6 step 2 SQL as admin), a 2-minute recording with video
(fragments PUT 201 to `*.blob.core.windows.net`, `video.finalized` in the worker log, the web player
plays), and a 60-minute recording on one WebSocket.

### A.10 Cost and shutting down
- Portal → Cost Management → **Budgets**: add a monthly budget with an email alert at 50%/90%.
- Always on: the worker (1 replica), Managed Redis, the registry, Postgres (free 12 months).
  Pause when idle: `az postgres flexible-server stop -g $RG --name ${PG%%.*}` (Azure restarts a
  stopped server after 7 days).
- Everything at once: `az group delete -n $RG` deletes **all** staging data. Ask Anirudh first.

---

# Part G — Google Cloud (reference only since 2026-11-12)

## Staging setup on Google Cloud, Mumbai (historical)

**For:** Gaurav (owner of S1-10, S1-11, S2-08..S2-12). **Written by:** Anirudh, 2026-11-06.
**Goal:** a staging environment where a signed-in user records a Meet call with the extension, and
their meetings, transcripts, video and action items are stored online and visible from any device
(D-07). This document says what to create, in which order, how to check each step, and which steps
still wait for code.

Related: [ADR-0002](adr/0002-backend-stack-and-hosting.md) (hosting),
[ADR-0004](adr/0004-auth-and-token-model.md) (sign-in and tokens),
[ADR-0005](adr/0005-job-queue-and-outbox.md) (queue),
[ADR-0011](adr/0011-video-screen-recording.md) (video), [ARCHITECTURE](ARCHITECTURE.md) §6, §11,
§12, §20, and `infra/environments/staging/README.md` (Terraform basics).

> Notation: **[Verify]** marks a command or setting not yet run against our project. Check it in
> the official Google Cloud docs before relying on it, and note the result in HANDOFF.

---

## 0. The picture

```
Chrome extension ──HTTPS──► API (Cloud Run)  ──► Cloud SQL Postgres 16 (private IP, RLS)
       │                        │  sign-in, meetings, notes, action items, signed URLs
       │                        └─► Cloud Storage (signed URLs for video PUT / playback GET)
       │
       └──WSS──► Gateway (Cloud Run) ──► Deepgram (live STT)
                     │  audio chunks ──► Cloud Storage
                     │  segments, usage ──► Cloud SQL
                     └─ session state ──► Memorystore Redis
Worker (Cloud Run) ◄── graphile-worker jobs in Cloud SQL (video.finalize with ffmpeg, retention, …)
Web app (library) ──HTTPS──► API
```

Everything runs in **`asia-south1`**. Video and audio never leave our project except audio sent to
Deepgram for transcription (ADR-0001 §0, `mip_opt_out=true`).

## 1. What is ready in code, and what each step waits for

| Piece | Code status (2026-11-06) | Owner | Blocks |
|---|---|---|---|
| Terraform: bucket, VPC + connector, Cloud SQL, secrets (empty), gateway service (placeholder image) | ✅ in `infra/` | Gaurav | — |
| Database schema + migrations (`backend/packages/db`, `migrate-cli.ts`) | ✅ | Anirudh | §6 |
| Auth library (`backend/packages/auth`): Google PKCE exchange, JWTs, refresh rotation | ✅ | Anirudh | API (S2-08) |
| Job queue library (`backend/packages/queue`) | ✅ | Anirudh | Worker |
| `video.finalize` task (`backend/packages/video`) | ✅ | Anirudh | Worker |
| Gateway: Redis state, JWT tokens, Postgres sinks, health | ✅ | Anirudh | — |
| Gateway staging mode (Cloud Storage chunk store, `0.0.0.0`, `APP_ENV=staging` without dev endpoints, exact origin allow-list) + `Dockerfile.gateway` | ✅ 2026-11-06 | Anirudh | — |
| Worker app (`backend/apps/worker`: health endpoint, RLS check, queue schema, `video.finalize`) + `Dockerfile.worker` (ffmpeg) | ✅ 2026-11-06 | Anirudh | — |
| Signed video URLs + playback helper (`@meetyou/storage`: `signFragmentUploads`, `meetingVideoPlayback`) | ✅ 2026-11-06 | Anirudh | API routes (S2-09/S2-14) |
| API service: S2-08 scaffold ✅ (deployed); S2-09 endpoints, S3-08 action items | ⏳ | Gaurav | sign-in, library |
| Dockerfiles: API + migrate ✅ (Gaurav), gateway + worker ✅ (Anirudh) | ✅ | both | — |
| CI/CD to staging + smoke test (S2-12) | ❌ to do | Gaurav | — |

So: **do §2–§7 now** (they need no new application code), then §8–§10 as each service is ready.

## 2. Accounts and tools (once)

1. Install the Google Cloud CLI (`gcloud`), Terraform ≥ 1.5 (or OpenTofu), Docker, Node 24, pnpm 11.
2. Sign in:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
3. Use a **dedicated staging project** (not a personal one), billing-enabled. Write its ID in
   HANDOFF (the ID is not a secret; keys are).
   ```bash
   gcloud config set project <STAGING_PROJECT_ID>
   gcloud config set compute/region asia-south1
   ```
4. **Budget alert** before creating anything that bills: Billing → Budgets & alerts → a monthly
   budget for this project with e-mail alerts at 50 %, 90 %, 100 % to both of us. Cloud SQL and
   Memorystore bill around the clock even when idle (see §11).
5. Grant Anirudh `roles/viewer` on the project (to read logs and check deploys). Nobody uses
   `roles/owner` day to day; deploys go through the CI service account (§10).

## 3. Terraform state in a bucket (once)

Local state on one laptop is lost easily and cannot be shared. Move it to a versioned bucket:

```bash
gcloud storage buckets create gs://meetyou-staging-tfstate-<STAGING_PROJECT_ID> \
  --location=asia-south1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://meetyou-staging-tfstate-<STAGING_PROJECT_ID> --versioning
```

Then in `infra/environments/staging/main.tf` uncomment the `backend "gcs"` block, set the bucket
name, and run `terraform init -migrate-state`. Never commit `*.tfstate` or `terraform.tfvars`
(already gitignored).

## 4. Fix the extension ID before anything depends on it

Several settings name the extension's origin `chrome-extension://<id>`: bucket CORS (video PUTs),
the API's allowed origins, and the Google OAuth redirect `https://<id>.chromiumapp.org/oauth2`
(ADR-0004 §4.1). An unpacked build's ID changes with its folder, so pin it:

1. Generate a key pair once (keep the private key **out of git**, e.g. in Secret Manager or a
   password manager):
   ```bash
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out extension-key.pem
   openssl rsa -in extension-key.pem -pubout -outform DER | base64 | tr -d '\n'
   ```
2. Put the printed public key (base64, one line) as `"key"` in `extension/public/manifest.json`.
   It is public by design; the `.pem` is not. **[Verify]** the resulting ID on
   `chrome://extensions` after reloading, and record it in HANDOFF.
3. Use that ID everywhere below. Ask Anirudh before changing the manifest (shared file).

## 5. Terraform: apply what exists, then add the missing resources

### 5.1 Apply the current modules
```bash
cd infra/environments/staging
cp terraform.tfvars.example terraform.tfvars   # gitignored
# set project_id, db_password (random, ≥ 32 chars), extension_origins = ["chrome-extension://<id>"]
terraform init && terraform plan && terraform apply
terraform output   # gateway_url, audio_bucket_name, db_connection_name, db_private_ip, …
```
Check: bucket is private (`public_access_prevention = enforced`), CORS lists only the extension
origin with `PUT`, lifecycle 31 days; Cloud SQL has **no public IP**.

Generate `db_password` without it landing in shell history, e.g.
`openssl rand -base64 36 | tr -d '/+=' | head -c 40`, paste it into `terraform.tfvars`, and also
into the database secret (§7).

### 5.2 Resources to add (new Terraform, Gaurav)

| Resource | Settings | Why |
|---|---|---|
| `artifactregistry.googleapis.com` in the enabled APIs + an Artifact Registry Docker repo `meetyou` in `asia-south1` | — | Images for gateway, API, worker, migration job |
| **Memorystore for Redis** (`redis.googleapis.com`) | Basic tier, 1 GB, `asia-south1`, `authorized_network` = our VPC, **[Verify]** connect mode (private service access is already set up for Cloud SQL) | Gateway session registry (S2-04): any instance resumes a session |
| Cloud Run service **`meetyou-staging-api`** | own service account; VPC connector (private ranges); min 0 / max 3; timeout 60 s; public invoker | API (S2-08) |
| Cloud Run service **`meetyou-staging-worker`** | own service account; VPC connector; **min instances 1 and CPU always allocated** (graphile-worker polls and holds a connection; a scaled-to-zero worker never runs jobs) **[Verify]** the current Cloud Run flag name for always-on CPU; no public invoker | Background jobs: `video.finalize`, retention (S2-10), summaries later |
| Cloud Run **job** **`meetyou-staging-migrate`** | same image family, runs `migrate-cli.ts`; VPC connector | Schema changes before each deploy (§6) |
| Secrets (values added in §7): `…-database-url`, `…-auth-signing-jwks`, `…-google-oauth-client-secret` (the module already has `deepgram-api-key`, `jwt-signing-key`, `db-password`; rename or reuse `jwt-signing-key` for the JWKS) | accessor role **per service**: gateway → database-url, deepgram; API → database-url, auth-signing-jwks, google-oauth-client-secret; worker → database-url | Least privilege (ARCHITECTURE §14) |
| Bucket IAM | gateway: `roles/storage.objectUser`; API: sign URLs (**[Verify]**: V4 signing from Cloud Run uses the service account's `iam.serviceAccounts.signBlob`, so grant `roles/iam.serviceAccountTokenCreator` on itself); worker: `objectUser` (reads fragments, writes `playback.mp4`, deletes fragments) | ADR-0011 §3.4 |
| Service accounts | one per service: `…-gateway-sa` (exists), `…-api-sa`, `…-worker-sa`, `…-migrate-sa`, `…-ci-sa` (deploys only) | A leak of one service cannot read everything |

Keep `deletion_protection = false` on staging Cloud SQL only; production sets it to `true`.

## 6. Database: migrations and the application role

Rules that keep tenant isolation working (ARCHITECTURE §11.3, S2-01):
- The application connects as **`meetyou_app`**, which **owns** the tables (row security is
  forced on owners too). Migrations must run **as `meetyou_app`**, never as `postgres`, or the
  tables get the wrong owner and RLS can be bypassed.
- The API, gateway and worker refuse to start if their role has `SUPERUSER` or `BYPASSRLS`
  (`Db.assertRowSecurityEnforced()` — **the API must call it at startup**, S2-08).
- Each process opens at most `PG_POOL_MAX` connections (default 10). Keep
  Σ (max instances × `PG_POOL_MAX`) for API, gateway, worker, migrate and smoke under the
  instance's `max_connections` (100 on the 3.75 GB `db-custom-1-3840` tier **[Verify]** with
  `show max_connections;`); lower `PG_POOL_MAX` per service before raising max instances.

Steps:
1. Build the migration image (§8) and run the job once:
   ```bash
   gcloud run jobs execute meetyou-staging-migrate --region asia-south1 --wait
   ```
   Expected log line: `migrations applied: 0001, 0002, 0003, 0004` the first time, then
   `migrations: up to date`. The runner takes an advisory lock, so two runs cannot collide, and it
   refuses edited migrations.
2. Check the role once from a machine inside the VPC (or Cloud SQL Studio) **[Verify]** access path:
   ```sql
   select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'meetyou_app';
   -- both must be false
   select tablename, tableowner from pg_tables where schemaname = 'public';
   -- every table owned by meetyou_app
   ```
   Cloud SQL users created by Terraform join `cloudsqlsuperuser`; that membership must not give
   `BYPASSRLS` **[Verify]**. If it does, create a separate login role for the application.
3. Worker queue tables: the worker installs graphile-worker's schema on first start
   (`installQueueSchema`), also as `meetyou_app`.
4. Every deploy runs the migration job **before** rolling out new service revisions (§10).

## 7. Secrets: values and how to create them

Never paste a secret into a file in the repo, an issue, a chat or a log. Add each value from a
file or stdin:

```bash
printf '%s' "<value>" | gcloud secrets versions add <secret-id> --data-file=-
```

| Secret | Value | Used by |
|---|---|---|
| `meetyou-staging-db-password` | the `db_password` from §5.1 | reference only |
| `meetyou-staging-database-url` | `postgres://meetyou_app:<password>@<db_private_ip>:5432/meetyou_staging` (URL-encode the password). **[Verify]** TLS: if the instance requires SSL, add `?sslmode=require` and check `pg` accepts it | gateway, API, worker, migrate job |
| `meetyou-staging-deepgram-api-key` | the **paid** Deepgram key for staging (not the dev key) | gateway |
| `meetyou-staging-gemini-api-key` | the Gemini API key for summaries and Ask (§9.4); paid tier for real meetings | API (Ask), worker (S3-03) |
| `meetyou-staging-auth-signing-jwks` | private signing keys, JSON array (below) | API only |
| `meetyou-staging-google-oauth-client-secret` | from §7.2 | API only |

### 7.1 Token signing keys (ADR-0004 §4.2)
Generate a private P-256 key with our own helper (prints JSON; send it straight into the secret,
do not save it to disk):
```bash
node --input-type=module -e "
import { generateSigningJwk } from './backend/packages/auth/src/keys.ts';
console.log(JSON.stringify([await generateSigningJwk('stg-2026-11')]));
" | gcloud secrets versions add meetyou-staging-auth-signing-jwks --data-file=-
```
- The API loads it with `loadKeyRing(JSON.parse(AUTH_SIGNING_JWKS))` and serves the **public**
  keys at `GET /.well-known/jwks.json` (`TokenService.jwks`).
- The gateway gets only the public JWKS (`STREAM_TOKEN_JWKS`, a plain environment value, not a
  secret) and verifies stream tokens with `StreamTokenVerifier`; it never holds a signing key.
- Rotation: add a new key **first** in the array, keep the old one second until every token
  signed with it has expired (refresh tokens are opaque and unaffected), then remove it.

### 7.2 Google sign-in (ADR-0004 §4.1)
1. APIs & Services → OAuth consent screen: type **External**, testing mode, add both our Google
   accounts as test users, scopes **only** `openid email profile`.
2. Credentials → OAuth client ID → **Web application** (the extension uses
   `chrome.identity.launchWebAuthFlow`, which needs a web client with an explicit redirect):
   - Authorized redirect URI: `https://<extension-id>.chromiumapp.org/oauth2`
   - And the web app's callback: `https://<web host>/auth/callback` (§9.2).
3. Client ID → API environment `GOOGLE_CLIENT_ID` (and the extension build, it is public).
   Client secret → `meetyou-staging-google-oauth-client-secret`.
4. The API passes `allowedRedirectUris` exactly; anything else is refused before calling Google.
5. The extension has the `identity` permission and signs in from the side panel (§9.2).

## 8. Container images

Node 24 runs our TypeScript directly (type stripping), so images copy the workspace and run
`node <path>.ts`; no build step. Use `pnpm deploy` to get one package with its production
dependencies. Shape (adapt per service):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS deps
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @meetyou/<service> deploy --prod /app

FROM node:24-slim
# Worker image only: ffmpeg for video.finalize (ADR-0011 §3.4)
# RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app ./
USER node
ENV NODE_ENV=production
CMD ["node", "src/main.ts"]
```

- Add a `.dockerignore` (at least `node_modules`, `**/.data`, `bench-data`, `.env*`, `dist`,
  `shared/fixtures/audio`, `infra/**/.terraform`, `*.tfstate*`): no recordings or keys in images.
- **[Verify]** `pnpm deploy` with workspace dependencies that point at TypeScript sources (our
  packages export `./src/*.ts`); if it does not copy them, build from the repo root instead.
- Tag images with the git SHA, push to `asia-south1-docker.pkg.dev/<project>/meetyou/<service>`.
- Migration job image: the db package, `CMD ["node", "src/migrate-cli.ts"]`.

## 9. Service configuration

Cloud Run sets `PORT`; every service must listen on `0.0.0.0:$PORT`.

### Gateway (`meetyou-staging-gateway`) — waits for the staging mode (§1)
| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `STT_PROVIDER` | `deepgram` |
| `DEEPGRAM_API_KEY` | secret `…-deepgram-api-key` |
| `DATABASE_URL` | secret `…-database-url` |
| `REDIS_URL` | `redis://<memorystore-host>:6379` |
| `STREAM_TOKEN_JWKS` | public JWKS JSON from the API (`GET /.well-known/jwks.json`) |
| `GCS_AUDIO_BUCKET` | `terraform output audio_bucket_name` |
| `DISPLAY_TEXT` | `as_provided` (Anirudh's 2026-11-06 choice) |
Cloud Run: timeout 3600 s (WebSocket), session affinity on (already), concurrency default.
Dev endpoints are **off** outside `local`/`ci`; sessions come from the API.

### API (`meetyou-staging-api`) — Gaurav, S2-08/S2-09
| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `DATABASE_URL` | secret |
| `AUTH_SIGNING_JWKS` | secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | §7.2 |
| `ALLOWED_REDIRECT_URIS` | `https://<extension-id>.chromiumapp.org/oauth2,https://<web host>/auth/callback` (comma list) |
| `CORS_ALLOWED_ORIGINS` | extra origins only; `chrome-extension://*` is built in, and the web app needs none (its server proxies `/v1`) |
| `GCS_AUDIO_BUCKET` | as above (signed video PUT/GET URLs) |
| `GATEWAY_WS_URL` | `wss://<gateway host>/v1/stream` (returned by `POST /sessions`) |
What the API must do, using what already exists:
- Startup: `Db.assertRowSecurityEnforced()`.
- `POST /v1/auth/google` → `AuthService.signIn`; `POST /v1/auth/refresh`, `/logout` → `AuthService`.
- `authenticate` middleware on every other route; every query inside `db.inWorkspace(...)`.
- `POST /v1/sessions` → `createMeetingForSession` (`@meetyou/db`), then
  `TokenService.issueStreamToken({ sessionId, workspaceId, lanes })` (`workspaceId` is required).
- `POST /v1/sessions/{id}/stream-token` for reconnects (same call).
- Video: `fragments:sign` per `SignVideoFragmentsRequest` (≤ 50 URLs, 15 min, content type and
  8 MB bound, own active session); `GET /v1/meetings/{id}/video` → signed GET of
  `video/playback.mp4` (`VideoPlaybackResponse`).
- Contracts for requests and responses live in `shared/contracts` (Anirudh owns it: ask for a
  new shape instead of adding one locally).

### Worker (`meetyou-staging-worker`) — waits for the worker app (§1)
| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `DATABASE_URL` | secret |
| `GCS_AUDIO_BUCKET` | as above |
Image includes `ffmpeg`. Min instances 1, CPU always on.

### 9.1 Deploying the gateway and the worker (ready since 2026-11-06)

Both images build from the repo root; Cloud Shell has Docker. Tag with the commit, not `latest`.
```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev
TAG=$(git rev-parse --short HEAD)
REPO=asia-south1-docker.pkg.dev/<STAGING_PROJECT_ID>/meetyou
docker build -f Dockerfile.gateway -t $REPO/gateway:$TAG . && docker push $REPO/gateway:$TAG
docker build -f Dockerfile.worker  -t $REPO/worker:$TAG  . && docker push $REPO/worker:$TAG
```
Terraform changes (Gaurav; Terraform stays the source of truth, so no `gcloud run services update`
that would drift):
- `gateway_image` / `worker_image` = the tags above.
- **Gateway** env: `APP_ENV=staging`, `STT_PROVIDER=deepgram`, `GCS_AUDIO_BUCKET`,
  `REDIS_URL=redis://10.254.5.203:6379`, `ALLOWED_ORIGINS=chrome-extension://hjimcofnjnikbeepahmclaniopbnhbbe`,
  `STREAM_TOKEN_JWKS` (below), `DISPLAY_TEXT=as_provided`; secrets `DATABASE_URL`,
  `DEEPGRAM_API_KEY`. The gateway refuses to start without any of them and says which.
- **Worker** env: `APP_ENV=staging`, `GCS_AUDIO_BUCKET`; secret `DATABASE_URL`. It serves
  `/healthz` on `$PORT` (Cloud Run needs a listener) and installs the queue schema on start.
- **Bucket CORS** now also lists `x-goog-content-length-range` (`infra/modules/storage`): apply it
  before the extension uploads to signed URLs.
- `STREAM_TOKEN_JWKS` = the **public** half of the signing keys. Until the API serves
  `/.well-known/jwks.json`, derive it in Cloud Shell (prints public keys only, never `d`):
  ```bash
  gcloud secrets versions access latest --secret=meetyou-staging-auth-signing-jwks \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({keys:JSON.parse(s).map(({kty,crv,x,y,kid})=>({kty,crv,x,y,kid,alg:"ES256",use:"sig"}))})))'
  ```
- **Deploy the worker before the gateway**: the gateway enqueues `video.finalize` when a meeting
  ends, which needs the queue schema the worker installs.

Checks after deploy:
```bash
curl -s https://<gateway-url>/healthz            # {"ok":true}
gcloud run services logs read meetyou-staging-gateway --region asia-south1 --limit 20   # gateway.listening … storage "gcs", redis true, db true
gcloud run services logs read meetyou-staging-worker  --region asia-south1 --limit 20   # worker.started
```
Cloud tests still to run once the API's `/sessions` exists (S2 exit criteria): stream a session,
kill the gateway revision mid-stream (`gcloud run services update-traffic` to a new revision, or
delete the instance) and check the client resumes with no loss; restart the worker during a
`video.finalize` and check it completes exactly once; record 60 minutes and check video ↔
transcript sync within ±0.5 s.

### 9.2 Sign-in, the library web app and cloud recording (ready since 2026-11-06)

What this turns on: the extension signs in with Google (`launchWebAuthFlow` + PKCE), starts each
recording with `POST /v1/sessions`, streams to the gateway with the API's stream token, and uploads
video to API-signed URLs; the worker finalizes `video/playback.mp4`; the web app
(`meetyou-staging-web`) signs in with the same Google client and plays the video on the meeting's
Transcript tab, with click-to-seek from transcript lines.

The web app is one Cloud Run service: `web/server/server.ts` serves the Vite build and proxies
`/v1/*` to the API, so the API's `minutes_rt` refresh cookie (`HttpOnly; Secure; SameSite=Lax`,
path `/v1/auth`) is first-party and the page needs no CORS. The browser keeps only the 15-minute
access token, in memory. Auth calls must send `X-Minutes-Client: web` (CSRF guard).

1. **Images** (Cloud Shell, repo at the pushed commit):
   ```bash
   cd ~/meetyou && git fetch origin main && git checkout --detach FETCH_HEAD
   TAG=$(git rev-parse --short HEAD)
   REPO=asia-south1-docker.pkg.dev/<STAGING_PROJECT_ID>/meetyou
   docker build -f Dockerfile.api -t $REPO/api:$TAG . && docker push $REPO/api:$TAG
   docker build -f Dockerfile.web -t $REPO/web:$TAG . && docker push $REPO/web:$TAG
   ```
2. **API signing permissions** (signed URLs on Cloud Run use the IAM `signBlob` API, no key file;
   `infra/modules/cloud-run/api.tf` already declares both grants — this only checks them):
   ```bash
   gcloud services enable iamcredentials.googleapis.com
   API_SA=$(gcloud run services describe meetyou-staging-api --region asia-south1 --format='value(spec.template.spec.serviceAccountName)')
   gcloud iam service-accounts get-iam-policy $API_SA --format=json | grep -A3 serviceAccountTokenCreator
   gcloud storage buckets get-iam-policy gs://<GCS_AUDIO_BUCKET> --format=json | grep -B2 -A3 $API_SA
   ```
3. **API revision** (`--update-env-vars` keeps the other variables; `^@^` makes `@` the separator
   because the redirect list contains a comma):
   ```bash
   gcloud run services update meetyou-staging-api --region asia-south1 --image $REPO/api:$TAG \
     --update-env-vars "^@^GCS_AUDIO_BUCKET=<bucket>@GATEWAY_WS_URL=wss://<gateway host>/v1/stream@ALLOWED_REDIRECT_URIS=https://<extension-id>.chromiumapp.org/oauth2,https://<web host>/auth/callback"
   ```
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SIGNING_JWKS` and `DATABASE_URL` must already
   be set (`gcloud run services describe … --format=yaml(spec.template.spec.containers[0].env)`
   lists names; secrets show as references).
4. **Web service** (public; no secrets — the Google client ID is public):
   ```bash
   gcloud run deploy meetyou-staging-web --region asia-south1 --image $REPO/web:$TAG \
     --allow-unauthenticated --min-instances 0 --max-instances 2 --memory 256Mi \
     --set-env-vars "API_URL=https://<api host>,GOOGLE_CLIENT_ID=<client id>"
   ```
   Its URL is the `<web host>` above (`https://meetyou-staging-web-<hash>-el.a.run.app`; the hash is
   the same as the other services'). If it differs, redo step 3 with the printed URL.
5. **Google OAuth client** (Console → APIs & Services → Credentials → the web client): Authorized
   redirect URIs = `https://<extension-id>.chromiumapp.org/oauth2` **and**
   `https://<web host>/auth/callback`. Google can take a few minutes to apply it.
6. **Extension**: `pnpm --filter @meetyou/extension build:staging` (API, client ID and web URL are
   in `extension/package.json`), load `extension/dist` unpacked, open the side panel on a Meet tab →
   **Continue with Google** → Start.
7. **Checks**: `curl -s https://<web host>/healthz` → `ok`; `curl -s https://<web host>/config.json`
   → the client ID; sign in on the web app; record a short call with only us two, stop, wait for
   "video.finalized" in the worker logs, then open the meeting → Transcript: the player plays and a
   click on a transcript line seeks to it.

Not in the web app yet (shown as empty states, `TODO`s in `web/src/api/http.ts`): summaries,
participants and action items (S3-08), server search (S3-09), audio playback without video
(S4-17).

### 9.3 Lifecycle jobs, observability and CI/CD (ready since 2026-11-06)

**Lifecycle (S2-10).** The worker now runs `meeting.delete` (10 s after `DELETE /v1/meetings/{id}`
unless restored), `account.delete` (`POST /v1/account:delete`, web Settings → Privacy & data) and
`retention.sweep` (scheduled by `video.finalize` at the video's `delete_after`; it deletes
`playback.mp4` + `poster.jpg` and marks the row `expired`). A storage failure fails the job so it
retries instead of leaving objects behind. Audio chunks have no `audio_assets` rows yet: they are
covered by the bucket's 31-day lifecycle rule until the S3 pipeline writes the rows after the
summary (D-02: audio is never deleted while processing or after a failure). Nothing to configure:
the next worker image picks them up.

**Observability (S2-11).** Every service logs one JSON line per event through `@meetyou/log`
(`severity`, `message` = event, IDs/counts/codes only; other fields are dropped and counted). The
API's Fastify logs use the same `severity`/`message` keys and log paths without query strings. The
worker logs `queue.depth` every minute. `infra/modules/monitoring` turns these into log-based
metrics (audio loss, STT errors, reconnects, sessions, dead-lettered jobs by task, ERROR lines by
service, queue depth), six alert policies (audio loss, STT errors, job failed for good — includes
retention and deletion jobs —, error spike, queue backlog, API 5xx) and a "Minutes staging"
dashboard. It only adds resources, so it can be applied on its own even before the rest of the
live config is codified:
```bash
cd ~/meetyou/infra/environments/staging
# terraform.tfvars: alert_emails = ["you@example.com"]
terraform init && terraform plan -target=module.monitoring
terraform apply -target=module.monitoring
```
**Tracing** (`@meetyou/tracing`, OpenTelemetry): one trace per meeting across API, gateway and
worker — the trace ID is derived from the meeting ID, so no context is passed between services.
Spans: `session.start`, `session.recover`, `session.end_request` (API); `stream.admit`,
`stream.ready`, `stt.open`, `segment.store`, `usage.save`, `session.end` (gateway); `job.<task>`
(worker). Attributes use the log allow-list (IDs, counts, codes). Export is OTLP/HTTP to the
Telemetry API with the service account's credentials (the old Cloud Trace exporter is deprecated).
Tracing turns itself on inside Cloud Run; `TRACING=off` disables it and `TRACE_SAMPLE_RATIO`
(default 1) samples meetings. One-time IAM (Telemetry API + `roles/telemetry.tracesWriter` and
`roles/serviceusage.serviceUsageConsumer` for the api/gateway/worker accounts; adds only):
```bash
cd ~/meetyou/infra/environments/staging
terraform plan -target=google_project_iam_member.telemetry -var project_id=<project> -var db_password=not-used -out tel.tfplan
terraform apply tel.tfplan
```
Then Cloud Trace → Trace explorer, filter on `meetingId`, shows a meeting's spans on one timeline.
From Cloud Shell (user credentials need the quota-project header):
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: <project>" \
  "https://cloudtrace.googleapis.com/v1/projects/<project>/traces?view=COMPLETE&pageSize=20&startTime=$(date -u -d '-3 hours' +%FT%TZ)" \
  | jq -r '.error.message // empty, (.traces[]?.spans[]?.name)' | sort | uniq -c
```
A refused export shows up as a `tracing.export_failed` log line (error class and code, at most once
a minute per service).

**Session timeline** (§20, no content): every log line carries the session ID, so one query lists a
session's events across services in order (connections, resumes, STT health, chunk failures, end
with latency and cost):
```bash
gcloud logging read 'jsonPayload.sessionId="ses_..." OR jsonPayload.meetingId="mtg_..."' \
  --order asc --freshness 2d --format='table(timestamp,resource.labels.service_name,labels.instanceId,jsonPayload.message)'
```

**Latency and spend** (§20): `stream.ended` carries the session's `sttFinalP50Ms`/`sttFinalP95Ms`
(audio sent → final), `ackLagP50Ms`/`ackLagP95Ms` (chunk ready → durable ack) and
`estimatedCostUsd`; the monitoring module turns them into dashboard tiles and an "Expensive STT
session" alert (`stt_session_cost_alert_usd`, default 1.5 USD). Google Cloud spend: set
`billing_account_id` and re-apply `-target=module.monitoring` for a monthly budget (default
₹5,000) with 50/90/100 % and forecast alerts (needs Billing Account Administrator or Costs
Manager). With user credentials the billing API needs a quota project, and every monitoring apply
must pass the alert email again or the channel is planned for removal:
```bash
export GOOGLE_BILLING_PROJECT=<project> USER_PROJECT_OVERRIDE=true
terraform plan -target=module.monitoring -var project_id=<project> -var db_password=not-used \
  -var 'alert_emails=["you@example.com"]' -var billing_account_id=<billing account> -out mon.tfplan
```
A new log-based metric takes up to 10 minutes before an alert can use it ("Cannot find metric"):
apply again after a few minutes. Applied on staging 2026-11-06 (budget on `013C6E-…`, INR).
Not done: summary latency (S3).

**CI/CD (S2-12).** `.github/workflows/deploy-staging.yml` runs after every green `CI` run on
`main` (or by hand): build and push `api gateway worker web migrate smoke` tagged with the commit,
run the migrate job, update `worker → api → gateway → web` (image only: env and secrets stay), then
run the smoke job. GitHub reaches Google Cloud through Workload Identity Federation — no key file.
The smoke job (`backend/apps/smoke`, `Dockerfile.smoke`) signs in a synthetic account
(`smoke-test@minutes.invalid`) through the same bootstrap function, mints a token with the API's
signing key, starts a session on the API, streams espeak-ng speech through the gateway, checks
every frame was acked, reads the segments back through the API, checks the meeting's `usage_records` row, deletes the
meeting and waits until the worker has removed it after the 10 s grace (about
20 s of Deepgram per lane per deploy). The same flow runs locally in `smoke.test.ts` against the
real gateway and API with scripted STT.

One-time setup:
1. Identity (adds a pool, a provider and the deployer account, plus any of the listed APIs not
   yet enabled). Cloud Shell has no Terraform: install it once into `~/bin`, which survives
   sessions (`curl -fsSLo /tmp/tf.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip && unzip -o /tmp/tf.zip terraform -d ~/bin`).
   The plan must show `0 to change, 0 to destroy`:
   ```bash
   cd ~/meetyou/infra/environments/staging
   terraform plan -target=module.ci -var project_id=<project> -var db_password=not-used-by-ci -out ci.tfplan
   terraform apply ci.tfplan
   terraform output github_wif_provider
   terraform output github_deploy_service_account
   ```
2. GitHub → repository → Settings → Secrets and variables → Actions → **Variables**:
   `GCP_PROJECT_ID` = the project ID, `GCP_WIF_PROVIDER` and `GCP_DEPLOY_SA` = the two outputs.
   (Variables, not secrets: none of these is secret.)
3. The smoke job, once (the workflow later only changes its image). Copy the VPC connector and the
   `DATABASE_URL` secret name from the API service:
   ```bash
   gcloud run services describe meetyou-staging-api --region asia-south1 \
     --format='yaml(spec.template.metadata.annotations,spec.template.spec.serviceAccountName,spec.template.spec.containers[0].env)'
   gcloud run jobs create meetyou-staging-smoke --region asia-south1 \
     --image $REPO/smoke:$TAG --service-account <api service account> \
     --vpc-connector <connector> --vpc-egress private-ranges-only \
     --set-secrets DATABASE_URL=<database-url secret>:latest,AUTH_SIGNING_JWKS=meetyou-staging-auth-signing-jwks:latest \
     --set-env-vars API_URL=https://<api host>,SMOKE_ORIGIN=chrome-extension://<extension-id> \
     --task-timeout 300s --max-retries 0
   gcloud run jobs execute meetyou-staging-smoke --region asia-south1 --wait
   gcloud logging read 'resource.labels.job_name="meetyou-staging-smoke" AND jsonPayload.message=~"^smoke\."' --limit 5 --format='value(jsonPayload)'
   ```
   `smoke.passed` with `segments` > 0 and `acked: true` means the whole path works.
4. The migrate job and all four services must exist before the first run (§9.1, §9.2).

### 9.4 "Ask this meeting" on staging (2026-11-07)
The API answers questions about one recording (FEATURES E4, DESIGN §12.7) with Gemini. Migration
0004 (`meeting_questions`) runs with the next deploy. The API needs the key and three settings;
without them it answers `503 answers_unavailable` and the website shows "Answers aren't available
right now".
1. The key, typed at a hidden prompt so it never lands in shell history or a file:
   ```bash
   gcloud secrets create meetyou-staging-gemini-api-key --replication-policy=automatic
   read -rsp 'Gemini API key: ' K; echo; printf '%s' "$K" | gcloud secrets versions add meetyou-staging-gemini-api-key --data-file=-; unset K
   gcloud secrets add-iam-policy-binding meetyou-staging-gemini-api-key \
     --member=serviceAccount:meetyou-staging-api-sa@<project>.iam.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor
   ```
2. The API service. With the **free** key (temporary staging exception, ADR-0001 §7 amendment:
   test meetings only, everyone told):
   ```bash
   gcloud run services update meetyou-staging-api --region asia-south1 \
     --update-secrets GEMINI_API_KEY=meetyou-staging-gemini-api-key:latest \
     --update-env-vars LLM_PROVIDER=gemini,GEMINI_FREE_TIER_ACCEPTED=true,GEMINI_FREE_TIER_ON_STAGING=true
   ```
   Once the key is **paid**, add a new secret version with it and declare the tier — do not just
   remove the variable: since 2026-11-10 a service with a Gemini key and no
   `GEMINI_FREE_TIER_ACCEPTED` refuses to start outside local/CI:
   `--update-env-vars GEMINI_FREE_TIER_ACCEPTED=false --remove-env-vars GEMINI_FREE_TIER_ON_STAGING`
   (on the API and the worker).
3. Check: on the website open a meeting with a transcript → **Ask** → "What did we decide?". The
   answer has numbered sources; "Write me a poem" gets "I can only answer questions about this
   recording."

Guardrails (all in code, `backend/apps/api/src/routes/ask.ts`): owner only (forced RLS; another
user's meeting is 404), the model sees only that recording, citations must be its own segments,
fixed refusal texts, 500 characters, 30 per hour and 150 per 24 hours per user, tokens stored per
question. The API's request timeout (60 s) covers a Gemini call (about 13 s on a short meeting).

### 9.5 Notes, batch pass and export on staging (S3, 2026-11-09)
Migrations 0005 (search indexes), 0006 (`exports`) and 0007 (participants' Meet IDs,
`speaker_signals`) run with the deploy. The **worker** writes the notes (`meeting.summarize`), so it
needs the same Gemini key and settings as the API (§9.4); without them meetings become ready with no
notes.
1. Worker: the Gemini key (secret from §9.4) and the free-key switches, until the key is paid:
   ```bash
   gcloud secrets add-iam-policy-binding meetyou-staging-gemini-api-key \
     --member=serviceAccount:meetyou-staging-worker-sa@<project>.iam.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor
   gcloud run services update meetyou-staging-worker --region asia-south1 \
     --update-secrets GEMINI_API_KEY=meetyou-staging-gemini-api-key:latest \
     --update-env-vars LLM_PROVIDER=gemini,GEMINI_FREE_TIER_ACCEPTED=true,GEMINI_FREE_TIER_ON_STAGING=true
   ```
2. Optional, **paid Deepgram minutes**: the batch pass (S3-04) re-transcribes each meeting of 2+
   minutes after its first notes (not with "delete immediately" retention):
   ```bash
   gcloud secrets add-iam-policy-binding meetyou-staging-deepgram-api-key \
     --member=serviceAccount:meetyou-staging-worker-sa@<project>.iam.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor
   gcloud run services update meetyou-staging-worker --region asia-south1 \
     --update-secrets DEEPGRAM_API_KEY=meetyou-staging-deepgram-api-key:latest \
     --update-env-vars STT_PROVIDER=deepgram,BATCH_TRANSCRIPTION=on
   ```
   The worker refuses to start with `BATCH_TRANSCRIPTION=on` but no `STT_PROVIDER` key.
3. Export (S3-11): the worker writes `ws/<workspace>/exports/<id>.zip` to the recordings bucket
   (its existing object role), the API signs the download link (the `signBlob` permission from §5.2
   it already has for video).
4. Check after a test call: the meeting page shows notes within about a minute (progress while
   writing), `audio_assets` rows have a `delete_after`, Settings → Download all my data gives a
   zip, and with step 2 the log line `batch.done` appears (`status` `replaced` or `kept`).

## 10. Deploy order and checks

First time:
1. §3 state bucket → §5.1 apply → §5.2 resources → §7 secrets.
2. Migration job (§6) → check the role query.
3. API: deploy, then `curl https://<api>/healthz` and `curl https://<api>/.well-known/jwks.json`
   (public keys only: no `"d"` member).
4. Gateway (after its staging mode lands): set `STREAM_TOKEN_JWKS` from step 3; check
   `curl https://<gateway>/healthz`.
5. Worker: logs show it started and installed the queue schema.
6. Extension: `build:staging` (§9.2), sign in,
   record a short **test call with only us two**, then check: rows in `meetings`,
   `transcript_segments`, `usage_records`; audio chunks under `ws/<workspace>/meetings/<meeting>/`
   in the bucket; after the call `video/playback.mp4` and a `video_assets` row with `ready`.

Every deploy (S2-12 CI): tests (`pnpm check`) → build images → **migration job** → deploy API,
gateway, worker revisions → smoke test: stream the synthetic fixture session
(`shared/fixtures`) through the gateway and read the segments back through the API. Never use a
real meeting recording as a fixture (AGENTS §8).

## 11. Cost control

- Cloud SQL and Memorystore are billed every hour they exist; Cloud Run scales to zero except the
  worker (min 1). Look up current `asia-south1` prices in the pricing calculator before creating
  Memorystore and record the monthly estimate in HANDOFF (ADR-0002 check 5).
- When nobody tests for days: stop Cloud SQL
  (`gcloud sql instances patch meetyou-staging-pg16 --activation-policy=NEVER`; start with
  `ALWAYS`), set the worker's min instances to 0. Memorystore cannot be stopped, only deleted
  (the gateway works without Redis on a single instance: unset `REDIS_URL`).
- Per-meeting cost is tracked in `usage_records` (AGENTS §3 rule 10).

## 12. Security checklist (tick before inviting anyone)

- [ ] No public IP on Cloud SQL; bucket private; CORS only `chrome-extension://<id>`, `PUT` only.
- [ ] Each service has its own service account with only the roles above.
- [ ] All keys in Secret Manager; none in images, env files in git, logs or chat.
- [ ] `meetyou_app` has no `SUPERUSER`/`BYPASSRLS`; tables owned by it; services refuse otherwise.
- [ ] Logs carry IDs and counts only (AGENTS §7) — spot-check gateway and API logs after a call.
- [ ] Deepgram key is the paid staging key; `mip_opt_out=true` is sent (adapter does it).
- [ ] The free Gemini key is **not** configured anywhere in staging once the paid key is in (every
      service with a Gemini key declares `GEMINI_FREE_TIER_ACCEPTED=true|false`; `true` is refused
      outside local/CI unless the temporary `GEMINI_FREE_TIER_ON_STAGING=true` exception is set).
- [ ] Budget alert active; OAuth consent screen in testing mode with only our accounts.
- [ ] Retention: the 31-day lifecycle rule is in place; the retention job (S2-10) is next.

## 13. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Migration job cannot connect | Job missing the VPC connector, or wrong private IP / password in `DATABASE_URL` |
| Service exits with "database role bypasses row-level security" | Connected as `postgres` or a role with `BYPASSRLS`; use `meetyou_app` |
| Extension gets 401 on the WebSocket | `STREAM_TOKEN_JWKS` on the gateway does not match the API's current keys, token older than 10 min, or a token reused (single use) |
| Gateway logs `stream.admit_failed` (503) | Redis or Postgres unreachable from the gateway (VPC connector, Memorystore network) |
| Video PUT fails in the browser with a CORS error | `extension_origins` does not match the pinned extension ID (§4) |
| `video.finalize` never runs | Worker scaled to zero or CPU throttled; or queue schema missing (check worker logs) |
| Google sign-in "redirect_uri_mismatch" | Redirect URI differs from `https://<id>.chromiumapp.org/oauth2` in the OAuth client or the API's allowed list |
