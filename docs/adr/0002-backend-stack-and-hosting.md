# ADR-0002: Backend stack and hosting

| Field | Value |
|---|---|
| Status | **Option B selected (2026-10-28)** — becomes *Accepted* once the verification checks in §9 pass |
| Date | 2026-10-28 |
| Decision | D-08 (PRD §22) |
| Related | [ARCHITECTURE.md §17, §25](../ARCHITECTURE.md) · [PRD §11, §17](../PRD.md) · [STT_PREFLIGHT.md](../STT_PREFLIGHT.md) |
| Follow-up ADRs | 0003 audio transport · 0004 auth/token model · 0005 job queue |

> Prices below are **order-of-magnitude estimates** for a small Phase 1 deployment, not quotes.
> Platform facts marked **[Verify]** come from secondary sources and must be checked before
> committing.

---

## 1. Context

We need to choose:
1. The **runtime and libraries** for the backend (API, realtime gateway, workers).
2. Where to **host** compute, PostgreSQL, Redis, and object storage.

Constraints from the architecture and PRD:

| Constraint | Source | Implication |
|---|---|---|
| Long-lived WebSockets for the realtime gateway | ARCHITECTURE §3, §6 | Needs containers/VMs; short-lived serverless functions do not work |
| PostgreSQL with row-level security, full-text search, pgvector later, and a Postgres-backed queue | ARCHITECTURE §11, §25 | Managed Postgres with extensions and PITR backups |
| Users mostly in India; privacy expectations (DPDP) | PRD §4, §17 | An **India region** is strongly preferred |
| Gemini must run on a **billing-enabled Google Cloud project** (no free tier with real voices) | STT_PREFLIGHT §4.3 | We need a Google Cloud project with billing regardless of hosting |
| Two developers, using AI coding agents | AGENTS.md | Low operational overhead matters more than maximum control |
| Phase 1 scale: ~1,000 users, ~200 concurrent sessions | PRD §11.4 | Small; must scale horizontally later without re-architecture |
| Deletion within 30 days including backups | PRD PRV-06 | Backup retention must be configurable to ≤ 30 days |
| Enterprise and data-residency features later | FEATURES M5 | Prefer a platform credible for business customers |

---

## 2. Decision drivers (weighted)

| # | Driver | Weight |
|---|---|---|
| D1 | Supports long-lived WebSockets well | 15% |
| D2 | India region for all core components | 15% |
| D3 | Low operational effort for a 2-person team | 20% |
| D4 | Low cost at Phase 1 scale | 10% |
| D5 | Fewer vendors (one bill, one IAM, one set of logs) | 10% |
| D6 | Fit with Gemini / vendor setup we need anyway | 5% |
| D7 | Credible for enterprise and data residency later | 10% |
| D8 | Portability (no deep lock-in) | 10% |
| D9 | Team familiarity | 5% — team chose Google Cloud (2026-10-28) |

---

## 3. Part A — Runtime and libraries

| Concern | Choice | Alternatives considered | Why |
|---|---|---|---|
| Language | **TypeScript** | Python, Go | One language across extension, backend, and `shared/` schemas; strong WebSocket ecosystem; no in-house ML (vendors do STT/LLM) so Python's advantage does not apply |
| Runtime | **Node.js, current LTS** | Bun, Deno | Most mature for production WebSockets and vendor SDKs |
| HTTP framework | **Fastify** (proposed) | Express, Hono, NestJS | Fast, schema-friendly, good plugin ecosystem; NestJS is heavier than we need |
| WebSocket server | **`ws`** library on the gateway | Socket.IO, uWebSockets.js | Plain, standard WebSocket protocol (ARCHITECTURE §5); Socket.IO adds its own protocol |
| Database access | **Type-safe SQL query builder** (Kysely or Drizzle) | Prisma, raw SQL | We need per-transaction `SET LOCAL` for row-level security and control over queries; full ORMs make that awkward |
| Migrations | SQL migrations, versioned in `backend/packages/db` | — | Reviewable, tool-agnostic |
| Validation / contracts | **zod** schemas in `shared/` | JSON Schema only | Same schemas validate on extension and backend; JSON Schema generated for the LLM output |
| Job queue | Postgres-backed queue (pg-boss or graphile-worker) | Redis queues, cloud task queues | Fewer moving parts; transactional outbox in the same DB — **decided in ADR-0005** |
| Monorepo | **pnpm workspaces** (+ a task runner if needed) | npm/yarn workspaces, Nx | Simple, fast, good for shared packages |
| Testing | **Vitest** | Jest | Already chosen in AGENTS.md §7 |
| Observability | **OpenTelemetry** SDK → platform logging/metrics; error reporting service optional | Vendor-specific SDKs | Vendor-neutral (ARCHITECTURE §20) |
| Infrastructure as code | **Terraform / OpenTofu** from the start, small | Click-ops | Reproducible staging and production; easy for agents to review |

Part A is largely independent of hosting and is **recommended as stated**.

---

## 4. Part B — Hosting options

### Option A — AWS, Mumbai region (`ap-south-1`)
| Component | Service |
|---|---|
| API, gateway, workers | ECS on Fargate behind an Application Load Balancer (WebSocket support, long idle timeout) |
| Postgres | RDS for PostgreSQL (or Aurora) |
| Redis | ElastiCache |
| Object storage | S3 |
| Secrets | Secrets Manager |

**Pros:** everything in an India region (Hyderabad also available); strongest enterprise credibility
and data-residency story; no WebSocket duration cap on ALB/Fargate beyond configurable idle
timeouts; huge ecosystem.
**Cons:** highest operational effort (VPC, NAT, IAM, ALB, task definitions); baseline costs (load
balancer, NAT gateway) even when idle; slowest for a 2-person team; second cloud anyway because
Gemini needs a Google Cloud billing project.
**Rough Phase 1 cost:** ~USD 120–200/month.

### Option B — Google Cloud, Mumbai region (`asia-south1`)  ← recommended
| Component | Service |
|---|---|
| API, gateway, workers | **Cloud Run** services (containers); gateway with CPU always allocated and min instances ≥ 1 |
| Postgres | **Cloud SQL for PostgreSQL** (pgvector supported) [Verify extension versions] |
| Redis | Memorystore, or a serverless Redis provider to cut idle cost |
| Object storage | Cloud Storage (lifecycle rules, CMEK available) |
| Secrets | Secret Manager |
| Scheduler | Cloud Scheduler → worker endpoint |

**Pros:** India region (Delhi `asia-south2` also exists); containers without managing servers;
**same cloud and billing project we already need for Gemini**; one IAM, one log/metrics stack;
good enterprise credibility; API and workers can scale to zero.
**Cons:** Cloud Run WebSocket connections are bounded by the request timeout (**max 60 minutes**),
and session affinity is best-effort — clients **will** reconnect during long meetings and on deploys.
Our protocol already supports resume + replay (ARCHITECTURE §5.3, §6.2), so this is acceptable but
must be tested. Cloud SQL and Memorystore have baseline costs.
**Rough Phase 1 cost:** ~USD 60–130/month.

### Option C — Supabase (Mumbai) + container host
| Component | Service |
|---|---|
| Postgres, object storage, (optionally) auth | **Supabase**, region South Asia / Mumbai (`ap-south-1`) |
| API, gateway, workers | Container host with an India region — e.g. Fly.io Mumbai [Verify] — or Cloud Run (Option B compute) |
| Redis | Serverless Redis provider |

**Pros:** fastest start: managed Postgres with RLS tooling, pgvector, dashboard, S3-compatible
storage, and optional built-in auth (could shortcut ADR-0004); low cost; standard Postgres, so
portable.
**Cons:** two or three vendors (bills, IAM, logs split); container-host India availability needs
verification; enterprise data-residency and compliance story depends on two vendors; using Supabase
Auth or client-side APIs couples us to Supabase more than plain Postgres would.
**Rough Phase 1 cost:** ~USD 40–90/month.

### Option D — Single PaaS (Railway / Render)
**Pros:** simplest developer experience.
**Cons:** **no India region** found for either (feature requests exist; Singapore is the nearest
reported region) [Verify]; weaker enterprise story; managed Postgres less flexible.
**Verdict:** rejected because of D2.

### Option E — Serverless-first (e.g. Vercel functions for everything)
**Cons:** cannot host the realtime gateway (long-lived WebSockets).
**Verdict:** rejected for backend; still fine for hosting the **web app** (beta) static/frontend.

---

## 5. Scoring

Scores 1–5 (5 = best), weighted by §2.

| Driver (weight) | A: AWS | B: GCP | C: Supabase + host | D: PaaS |
|---|---|---|---|---|
| D1 WebSockets (15%) | 5 | 3 | 4 | 4 |
| D2 India region (15%) | 5 | 5 | 4 | 1 |
| D3 Low ops effort (20%) | 2 | 4 | 5 | 5 |
| D4 Low cost (10%) | 2 | 3 | 5 | 4 |
| D5 Fewer vendors (10%) | 3 | 5 | 2 | 4 |
| D6 Gemini fit (5%) | 2 | 5 | 3 | 2 |
| D7 Enterprise / residency (10%) | 5 | 5 | 3 | 2 |
| D8 Portability (10%) | 4 | 4 | 4 | 3 |
| D9 Familiarity (5%) | ? | ? | ? | ? |
| **Weighted (without D9, re-normalized to 95%)** | **3.6** | **4.2** | **3.9** | **3.3** |

B and C are close. The deciding factors: B keeps everything in one cloud we must use anyway (Gemini
billing), has the stronger enterprise path, and keeps the vendor count low; C is faster to start
and cheaper. **Team familiarity (D9) can flip the result** — if the team is already productive with
Supabase, C is a reasonable choice.

---

## 6. Decision

**Option B — Google Cloud, Mumbai (`asia-south1`)**, with the Part A runtime stack.
Selected by the team on 2026-10-28.

| Component | Choice |
|---|---|
| Realtime gateway | Cloud Run service, CPU always allocated, min instances ≥ 1, request timeout 60 min, session affinity on |
| API | Cloud Run service (can scale to zero in staging) |
| Workers | Cloud Run service(s) pulling from the Postgres queue; scheduler via Cloud Scheduler |
| Database | Cloud SQL for PostgreSQL, PITR enabled, backup retention ≤ 30 days, private networking |
| Redis | Start with a low-cost option (serverless Redis or smallest Memorystore); it holds no system-of-record data |
| Object storage | Cloud Storage, one bucket per environment, uniform access, lifecycle rule as retention backstop |
| Secrets | Secret Manager; vendor keys per environment |
| Web app (beta) | Static hosting / CDN (Cloud Run, Firebase Hosting, or Vercel — decide in ADR-0006) |
| Environments | Separate Google Cloud **projects** for staging and production |
| IaC | Terraform/OpenTofu for all of the above |

**Fallback:** if the M1 spike shows that 60-minute Cloud Run reconnects hurt user experience or
STT continuity, move **only the gateway** to a VM-based or Kubernetes deployment in the same
region (e.g. GKE Autopilot or a managed instance group). No other component changes.

**Contingency only:** if a verification check in §9 fails for Cloud SQL (e.g. pgvector or backup
retention), Option C's Supabase Postgres in Mumbai can replace Cloud SQL while compute stays on
Cloud Run. The portability rules below keep that switch cheap. This requires a new ADR.

---

## 7. Portability rules (apply whichever option is chosen)

1. Use **plain PostgreSQL features** only (RLS, FTS, pgvector, standard extensions). No
   platform-specific database APIs from application code.
2. Access object storage through a small **storage interface** with an S3-compatible implementation
   (Cloud Storage supports S3-compatible access [Verify for our usage]; Supabase Storage is
   S3-compatible).
3. Everything runs as a **container** built from our repo; no platform-specific runtime APIs in
   application code.
4. Configuration via environment variables and secrets; no hard-coded platform endpoints.
5. Auth stays in our own service behind the ADR-0004 token model, even if a platform auth product is
   used underneath.

---

## 8. Consequences

**Positive**
- All core data and compute in India, under one cloud account with Gemini.
- Low operations: no servers, no clusters in Phase 1.
- Clear upgrade path for enterprise (CMEK, VPC controls, India-only data residency).

**Negative / risks**
| Risk | Mitigation |
|---|---|
| WebSocket reconnects at 60 min and on deploys/scale-in | Resume + replay protocol; deploy gateway outside peak hours; test 2-hour meetings in M1; fallback to VM/GKE for gateway |
| Session affinity is best-effort | Session state in Redis; any instance can resume a session |
| Baseline cost of Cloud SQL + Redis even when idle | Smallest tiers in staging; serverless Redis; review monthly |
| Cross-region latency to STT vendors hosted elsewhere | Measure in benchmark Phase B from the Mumbai region; client latency budget allows ~100–250 ms extra |
| Vendor lock-in | Portability rules (§7) |

---

## 9. Verification before approval

| # | Check | Owner |
|---|---|---|
| 1 | Cloud Run WebSocket behaviour in `asia-south1`: 60-min timeout, session affinity, SIGTERM grace on deploy | Anirudh — **Docs checked 2026-10-28:** request timeout up to 60 min applies to WebSockets; session affinity is best effort; clients must reconnect. SIGTERM grace period [Verify]. Live 2-hour test in S1-11 |
| 2 | Cloud SQL Postgres version and pgvector availability in `asia-south1` | Gaurav — **Partly checked:** pgvector is supported on Cloud SQL for PostgreSQL (secondary source); exact extension version still to confirm on Google's extensions page |
| 3 | Backup/PITR retention can be set ≤ 30 days | Gaurav — **Checked (secondary sources):** automated backup count is configurable (e.g. 7) and PITR log retention is configurable (default 7 days) → ≤ 30 days achievable. Confirm limits in Google docs when provisioning |
| 4 | Latency from `asia-south1` to Sarvam, Deepgram, and Gemini endpoints | Anirudh — **Partly done:** `bench measure-latency` from a laptop in India (2026-10-28): TLS connect Sarvam ~70–90 ms, Gemini ~40 ms (first byte 130–460 ms), Deepgram ~510–610 ms (first byte ~770–870 ms). Re-run from Cloud Shell in `asia-south1` |
| 5 | Monthly cost estimate with the pricing calculator for the §6 setup | Gaurav — **Open:** needs the Google Cloud pricing calculator with chosen tiers |
| 6 | Startup credit programs we may be eligible for (Google for Startups, others) | Gaurav — **Checked:** Google for Startups Cloud Program has a self-serve *Start* tier (reported up to ~$2,000 for 1 year, for startups not yet equity-funded) and a *Scale* tier for VC-funded startups (much larger credits); apply via cloud.google.com/startup |
| 7 | ~~Team familiarity (D9) and preference between B and C~~ — **Done 2026-10-28: Option B** | Both |

---

## 10. Sources

- [Google for Startups Cloud Program FAQ](https://cloud.google.com/startup/faq) · [Benefits](https://cloud.google.com/startup/benefits)
- [Cloud SQL backups and PITR (tutorial)](https://oneuptime.com/blog/post/2026-02-17-how-to-configure-automated-backups-and-point-in-time-recovery-in-cloud-sql/markdown) · [PITR without impacting storage (Google blog)](https://cloud.google.com/blog/products/databases/point-in-time-recovery-without-impacting-instance-storage/)

- [Cloud Run — Using WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets) (request timeout up to 60 minutes; clients must reconnect)
- [Cloud Run — Session affinity](https://docs.cloud.google.cn/run/docs/configuring/session-affinity?hl=en) (best-effort affinity)
- [Supabase — Regions](https://supabase.com/docs/guides/platform/regions) (South Asia / Mumbai `ap-south-1`)
- [Railway — India region feature request](https://station.railway.com/feedback/feature-request-add-an-india-infrastruc-fee82197)
- [Render — Mumbai region feature request](https://feedback.render.com/features/p/mumbai-region)
- [Fly.io region listing (secondary)](https://productgrowth.in/tools/developer/fly-io/)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms) (paid services require a billing-enabled Cloud project)
