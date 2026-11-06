# Staging setup runbook (Google Cloud, Mumbai)

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

Steps:
1. Build the migration image (§8) and run the job once:
   ```bash
   gcloud run jobs execute meetyou-staging-migrate --region asia-south1 --wait
   ```
   Expected log line: `migrations applied: 0001, 0002, 0003` the first time, then
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
   - Later (S4-09): the web app's callback URL.
3. Client ID → API environment `GOOGLE_CLIENT_ID` (and the extension build, it is public).
   Client secret → `meetyou-staging-google-oauth-client-secret`.
4. The API passes `allowedRedirectUris` exactly; anything else is refused before calling Google.
5. The extension needs the `identity` permission back in its manifest (S4-03, Anirudh).

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
| `GOOGLE_REDIRECT_URIS` | `https://<extension-id>.chromiumapp.org/oauth2` (comma list) |
| `ALLOWED_ORIGINS` | `chrome-extension://<extension-id>` (+ web app origin later) |
| `GCS_AUDIO_BUCKET` | as above (signed video PUT/GET URLs) |
| `GATEWAY_URL` | `wss://<gateway host>/v1/stream` (returned by `POST /sessions`) |
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

## 10. Deploy order and checks

First time:
1. §3 state bucket → §5.1 apply → §5.2 resources → §7 secrets.
2. Migration job (§6) → check the role query.
3. API: deploy, then `curl https://<api>/healthz` and `curl https://<api>/.well-known/jwks.json`
   (public keys only: no `"d"` member).
4. Gateway (after its staging mode lands): set `STREAM_TOKEN_JWKS` from step 3; check
   `curl https://<gateway>/healthz`.
5. Worker: logs show it started and installed the queue schema.
6. Extension: build with the staging URLs (Anirudh adds the build variables in S4-14), sign in,
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
- [ ] The free Gemini key is **not** configured anywhere in staging (the provider registry refuses
      `GEMINI_FREE_TIER_ACCEPTED=true` outside local/ci).
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
