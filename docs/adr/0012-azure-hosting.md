# ADR-0012: Move staging hosting from Google Cloud to Azure (Central India)

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-11-12) |
| Date | 2026-11-12 |
| Supersedes | The hosting half (Part B) of [ADR-0002](0002-backend-stack-and-hosting.md). Part A (TypeScript, Node, Fastify, Postgres, graphile-worker) stands |
| Related | [STAGING_SETUP.md](../STAGING_SETUP.md) · [ARCHITECTURE.md §17, §25](../ARCHITECTURE.md) · ADR-0004 (Google sign-in) · ADR-0011 (video) |

> Facts marked **[Verify]** come from documentation or secondary sources and must be checked on
> the first deploy.

## 1. Context

On 2026-11-11 the Google Cloud staging project stopped serving: its billing account
(`013C6E-…`) was closed and asked for account verification and a new payment method. Every
service returned 500/503 with "billing is disabled". Anirudh decided to leave Google Cloud and host
on **Azure, Central India (Pune)**.

What does **not** move:
- **Google sign-in** (ADR-0004). An OAuth client lives in a Google Cloud project, but that
  project needs no billing. A new project without billing holds the client.
- **Gemini** (Gemini API key, ADR-0007) and **Deepgram** (ADR-0001). Both are called over the
  internet with API keys and do not depend on the host.
- **The extension ID** (`hjimcofnjnikbeepahmclaniopbnhbbe`, fixed by the manifest key). The
  extension redirect URI and the CORS origin stay the same.

## 2. Decision

| Concern | Google Cloud (before) | Azure (now) |
|---|---|---|
| Region | asia-south1 (Mumbai) | **centralindia (Pune)** |
| Containers | Cloud Run services + jobs | **Container Apps** (Consumption) apps `api`, `gateway`, `web`, `worker`; **Container Apps Jobs** `migrate`, `smoke` |
| Postgres | Cloud SQL 16 | **Azure Database for PostgreSQL Flexible Server** 16, `B_Standard_B1ms`, TLS required |
| Redis (gateway sessions) | Memorystore | **Azure Managed Redis** `Balanced_B0`, TLS, non-clustered. Azure Cache for Redis does not accept new customers from 2026-04-01 |
| Object storage | Cloud Storage bucket | **Blob Storage** account, private container `recordings` |
| Signed URLs | V4 signed URLs (IAM signBlob) | **User delegation SAS** (managed identity, no account key) |
| Secrets | Secret Manager | **Key Vault** (RBAC), referenced by the Container Apps |
| Images | Artifact Registry | **Container Registry** Basic |
| Runtime identity | One service account per service | One **user-assigned managed identity** for all apps and jobs (staging) |
| CI/CD | WIF → deployer service account | **GitHub OIDC → federated credential** on a deployer identity |
| Logs | Cloud Logging | **Log Analytics** workspace (Container Apps console logs) |
| Tracing | OTLP → Google Telemetry API | **Off on Azure** (the tracer only starts on Cloud Run). Re-adding it is follow-up work |
| Terraform | `infra/environments/staging` (google) | **`infra/azure`** (azurerm 5.x). The Google modules stay in the repo, unused, until production hosting is decided |

### 2.1 Code changes

Storage is provider-neutral behind the existing bucket interface (ARCHITECTURE §25):
- `SignableBucket` (`backend/packages/storage/src/bucket.ts`) adds `signUpload` and `signRead`
  to `ObjectBucket`. `GcsBucket` keeps V4 signing. `AzureBlobBucket` signs with a
  user delegation key (cached up to 24 h and renewed with 2 h left).
- `bucketFromEnv` picks Azure when `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_CONTAINER` are
  set, otherwise GCS from `GCS_AUDIO_BUCKET`. The API, gateway and worker all use it.
- `DefaultAzureCredential` finds the user-assigned identity through `AZURE_CLIENT_ID`.
- The web server's CSP `media-src`/`connect-src` storage origin comes from `STORAGE_ORIGIN`
  (default `https://storage.googleapis.com`).
- New dependencies: `@azure/storage-blob` and `@azure/identity`, both from Microsoft and pinned.

### 2.2 Differences that change behaviour

1. **Upload size is no longer bound by the signature.** A V4 URL carried
   `x-goog-content-length-range`. A SAS cannot limit size. Each URL still names one object,
   expires in 15 minutes and is issued only for the caller's own active session. Nothing rejects
   an over-sized fragment today: a signed-in user could store large objects for up to 31 days
   (lifecycle rule). A size check before `video.finalize` reads fragments (blob properties) is
   Stage-5 hardening and is on hold with the rest of Stage 5.
2. **Upload headers.** Put Blob needs `x-ms-blob-type: BlockBlob`. The sign response already
   returns `headers`, and the extension sends them with every PUT, so the extension does not
   change. Blob CORS allows `Content-Type` and `x-ms-blob-type` from the extension origin.
3. **WebSocket idle timeout.** Container Apps' default ingress closes a request idle for 4
   minutes, and only premium ingress can raise that limit. The gateway pings every 30 s, so
   streams stay open. Whether ping frames reset the idle timer is **[Verify]** in the 60-minute
   test. There is no hard request-duration cap on the default ingress like Cloud Run's 3600 s
   **[Verify]**.
4. **Session affinity** is `session_affinity_enabled` on the gateway's ingress (azurerm 5.13).
5. **Database connections.** B1ms allows about 50 connections, some of them reserved by Azure
   **[Verify]** (`show max_connections;`). Use `PG_POOL_MAX=4` per process and at most 2
   replicas for the API and the gateway.
6. **Network.** Staging uses public endpoints. Postgres has TLS, a 32+ character password and the
   "Azure services" firewall rule (Consumption Container Apps have no fixed outbound IP). Redis
   has TLS and an access key. Blob has no public access, and every request is signed.
   A VNet with private endpoints is required before production.
7. **Retention backstop.** A blob lifecycle rule deletes `recordings/ws/` objects 31 days after
   creation, as the GCS rule did. Blob soft delete stays off, so a deletion is final
   (PRD PRV-06).

## 3. Consequences

- Staging comes back on Azure. The data in the closed Google project (test meetings only) is not
  migrated. Testers sign in again, and their old recordings are gone.
- The extension needs a new `build:staging`: new API and web URLs, and the new Google OAuth client
  ID if the client is recreated.
- Cost on a free account: Container Apps' monthly free grant, B1ms Postgres (750 h/month), and
  5 GB of Blob storage for 12 months. Managed Redis, Container Registry Basic and Log Analytics
  ingestion are paid from the trial credit, then billed **[Verify]** on the pricing page. The
  worker keeps one replica running and is the main compute cost.
- The **Gemini free-tier rules do not change** (ADR-0001 §7): staging may use the free key only
  with `GEMINI_FREE_TIER_ON_STAGING=true` for agreed test meetings.
- Gateway fencing and shared rate limits (Stage 5) are as before. Nothing in this move depends on
  them.

## 4. Verification (first deploy)

1. `gateway.listening` logs `storage "azure"`, `redis true` and `db true`; the worker logs
   `worker.started`.
2. The migrate job logs `migrations applied` and `meetyou_app` has `rolsuper = false` and
   `rolbypassrls = false`.
3. A 2-minute recording uploads video fragments (PUT 201 to `*.blob.core.windows.net`), and
   `video.finalize` produces `playback.mp4`. The web player plays it (CSP allows the blob origin).
4. A 60-minute recording keeps one WebSocket open (the idle-timeout check in §2.2.3).
5. The smoke job passes.

## 5. Sources

- Container Apps ingress modes and premium idle timeout: learn.microsoft.com/azure/container-apps/ingress-environment-configuration
- azurerm 5.13 provider docs (`container_app` `session_affinity_enabled`, `container_app_job`,
  `postgresql_flexible_server`, `managed_redis`, `key_vault` `rbac_authorization_enabled`,
  `federated_identity_credential` `user_assigned_identity_id`, `storage_management_policy`).
- Azure Cache for Redis retirement for new customers (2026-04-01) and Azure Managed Redis.
- User delegation SAS: learn.microsoft.com/rest/api/storageservices/create-user-delegation-sas
