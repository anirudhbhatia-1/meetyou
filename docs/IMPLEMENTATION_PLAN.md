# Implementation Plan

| Field | Value |
|---|---|
| Purpose | How the whole product gets built: stages, tasks, the approach for each task, owners, dependencies, and exit criteria |
| Status | Plan — work starts only when a stage is kicked off by both developers |
| Last updated | 2026-10-28 |
| Owners | **Anirudh** (works with Claude Code) · **Gaurav** (works with Google Antigravity) |
| Related | [PRD.md](PRD.md) · [FEATURES.md](FEATURES.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN.md](DESIGN.md) · [STT_BENCHMARK_PLAN.md](STT_BENCHMARK_PLAN.md) · [STT_PREFLIGHT.md](STT_PREFLIGHT.md) · [adr/](adr/README.md) · [AGENTS.md](../AGENTS.md) |

> **Terminology.** The PRD uses *product phases* (Phase 1 = Meet extension, Phase 2 = breadth and
> memory, Phase 3 = business). This plan uses **stages** (S0–S9) for the order of work. Stages 0–7
> deliver product Phase 1 and map to PRD milestones M0–M4; stages 8–9 cover product Phases 2 and 3.
> Task IDs look like `S2-05`. Durations are **estimates** and will be revised after Stage 1.

---

## Contents

1. [Ownership](#1-ownership)
2. [Working agreement](#2-working-agreement)
3. [Stage overview](#3-stage-overview)
4. [Stage 0 — Foundations and decisions (M0)](#stage-0--foundations-and-decisions-m0)
5. [Stage 1 — Capture spike (M1)](#stage-1--capture-spike-m1)
6. [Stage 2 — Realtime core and data platform](#stage-2--realtime-core-and-data-platform)
7. [Stage 3 — Notes and summaries](#stage-3--notes-and-summaries)
8. [Stage 4 — Product UI](#stage-4--product-ui)
9. [Stage 5 — Internal alpha (M2)](#stage-5--internal-alpha-m2)
10. [Stage 6 — Private beta (M3)](#stage-6--private-beta-m3)
11. [Stage 7 — Public launch (M4)](#stage-7--public-launch-m4)
12. [Stage 8 — Product Phase 2](#stage-8--product-phase-2)
13. [Stage 9 — Product Phase 3](#stage-9--product-phase-3)
14. [Hand-offs between owners](#14-hand-offs-between-owners)
15. [Critical path and timeline](#15-critical-path-and-timeline)
16. [Definition of done](#16-definition-of-done)
17. [Contingencies](#17-contingencies)
18. [Keeping this plan current](#18-keeping-this-plan-current)

---

## 1. Ownership

### 1.1 Areas
| Area | Owner | Includes |
|---|---|---|
| Capture engine | **Anirudh** | `tabCapture`, offscreen document, microphone, audio worklets, encoding, local buffer, stream client, recording state machine |
| Realtime gateway | **Anirudh** | WebSocket server, session state, STT provider sessions, transcript assembly |
| Provider layer | **Anirudh** | STT streaming/batch, LLM, transliteration, embeddings adapters; data-use opt-outs |
| Processing pipeline | **Anirudh** | Outbox, queue, workers, batch re-transcription, speaker resolution |
| Summarization and evaluation | **Anirudh** | Prompt/templates engine, validation, citations, evaluation harness |
| Data platform and auth | **Anirudh** | Schema, migrations, tenancy enforcement, token model |
| Shared contracts | **Anirudh** | Event schema, WebSocket protocol, REST DTOs, summary schema (`shared/`) |
| Security review | **Anirudh** | Threat model checks, tenancy tests, prompt-injection tests |
| Meet adapter (DOM) | **Gaurav** | Call detection, metadata, active-speaker and mute signals, chat notice, selector health |
| Extension shell and UI | **Anirudh** (since 2026-11-05) | Manifest, build, side panel UI, Meet overlay UI, onboarding, badge, notifications |
| Library app | **Anirudh** (since 2026-11-05) | Home, Meetings, Meeting detail, Share, Action items, Settings (web app, D-07) |
| Design system | **Anirudh** (since 2026-11-05) | Tokens, components, dark mode, accessibility (sources: DESIGN.md + the Claude Code design, AGENTS §2) |
| REST API endpoints | **Gaurav** | CRUD endpoints, search, export, action items, glossary, settings |
| Data lifecycle jobs | **Gaurav** | Retention, deletion with grace and restore, export archives |
| Infrastructure and delivery | **Gaurav** | Terraform, Google Cloud environments, CI/CD, observability setup |
| Launch and compliance documents | **Gaurav** | Privacy policy, terms, store listing, consent forms, support docs |

### 1.2 Review pairing
Every pull request is reviewed by the **other** owner, using their own agent (Claude Code reviews
Gaurav's PRs; Antigravity reviews Anirudh's). Changes to `shared/` contracts need both approvals,
and breaking changes need an ADR (AGENTS.md §3, ARCHITECTURE §24.3).

---

## 2. Working agreement

1. **Contracts first.** Anirudh publishes `shared/` schemas (and fixture data) before the code that
   uses them, so the UI and Gaurav's endpoints can proceed in parallel against mocks.
2. **Mocks over waiting.** The UI is built against a mock API and a **recorded session stream**
   (fixture replay of real WebSocket messages) until the real services are ready.
3. **One owner per task**, named in this plan. Help is welcome; ownership does not move without an
   update to this file.
4. **Branches and PRs** per task (`feature/S2-05-transcript-assembler`). Never commit to `main`.
5. **Requirement IDs** (PRD/FEATURES/DESIGN) in every PR description.
6. **Agents follow AGENTS.md**: plan first, verify vendor APIs against docs, run checks, ask before
   risky actions.
7. **Weekly sync** (30 min): stage status, blockers, hand-offs (§14), plan updates (§18).
8. **No real meeting data** in git, fixtures, or logs. Fixtures are synthetic or recorded with
   consent and stored outside the repo.

---

## 3. Stage overview

| Stage | Name | Milestone | Product phase | Outcome |
|---|---|---|---|---|
| S0 | Foundations and decisions | M0 | 1 | STT provider chosen, ADRs accepted, repo and contracts ready |
| S1 | Capture spike | M1 | 1 | 60-minute Meet call recorded with no audio loss; open technical questions answered |
| S2 | Realtime core and data platform | M2 | 1 | Recording → live transcript → stored segments, end to end on staging |
| S3 | Notes and summaries | M2 | 1 | Cited notes, decisions, action items within 60 s; evaluation baseline |
| S4 | Product UI | M2 | 1 | All Phase 1 screens from DESIGN.md, against mocks then real services |
| S5 | Internal alpha | M2 exit | 1 | Both developers use it for every Meet call for 2 weeks |
| S6 | Private beta | M3 | 1 | 10–30 external users; legal, security, performance ready |
| S7 | Public launch | M4 | 1 | Chrome Web Store listing live |
| S8 | Product Phase 2 | — | 2 | Desktop app, upload, calendar, memory, MCP, integrations, billing |
| S9 | Product Phase 3 | — | 3 | Clips and adaptive video, bot, automations, CRM, analytics, enterprise |

S2, S3, and S4 run **in parallel** after S1; S4 starts on mocks during S1.

---

## Stage 0 — Foundations and decisions (M0)

**Goal:** make the decisions that everything else depends on, and set up the repository.
**Estimate:** weeks 1–4.

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S0-01 | **Benchmark logistics:** consent forms (STT_BENCHMARK_PLAN App. A), recording sessions with OBS two-track setup, clip metadata sheet | Anirudh | — | 20 core + 2 long clips recorded with signed consent |
| S0-02 | **Provider pre-flight actions** (STT_PREFLIGHT §6): Sarvam training opt-out + screenshot + credits top-up, Deepgram account + `mip_opt_out` check, Gemini billing-enabled Cloud project, rate-limit notes | Anirudh | — | All 9 pre-flight actions ticked |
| S0-03 | **Annotation guideline and canonical Hinglish spelling list v1** (STT_BENCHMARK_PLAN §4.2) | Anirudh | — | Guideline doc + spelling list committed (no audio) |
| S0-04 | **Reference transcripts**, clips 1–10, plus review of clips 11–20 | Anirudh | S0-01, S0-03 | Clips annotated and cross-reviewed |
| S0-05 | **Reference transcripts**, clips 11–20, plus review of clips 1–10; double-annotation agreement check | Anirudh | S0-01, S0-03 | Agreement < 5% WER or guideline fixed |
| S0-06 | **Batch runner:** sends each prepared file to each provider/config, saves raw JSON + run metadata | Anirudh | S0-02 | Phase A raw results stored |
| S0-07 | **Streaming replay harness:** plays PCM at real-time speed in 100 ms chunks to each provider, records message arrival times, handles keep-alive/reconnect | Anirudh | S0-02 | Phases B and C runnable for all providers |
| S0-08 | **Normalizer + scorer:** STT_BENCHMARK_PLAN §5–§6 (WER, CER, code-switch WER, entity accuracy, DER, latency, hallucination, echo) | Anirudh | S0-03 | Results sheet generated from raw outputs |
| S0-09 | **Benchmark Phases D–G** (Opus vs PCM, boosting, downstream summary test) and analysis | Anirudh | S0-06..08 | Results analysed |
| S0-10 | **Display readability test** (Phase G) — prepare blind samples, collect both ratings | Anirudh | S0-06 | Ratings recorded |
| S0-11 | **ADR-0001** STT provider(s) | Anirudh | S0-09, S0-10 | ADR accepted; AGENTS.md D-03 closed |
| S0-12 | **ADR-0002 checks** 2, 3, 5, 6 (Cloud SQL pgvector, backup retention, cost estimate, credits) | Anirudh | — | Checks recorded in ADR §9 |
| S0-13 | **ADR-0002 checks** 1 and 4 (Cloud Run WebSocket behaviour, latency from Mumbai to vendors) | Anirudh | S0-07 | ADR-0002 Accepted |
| S0-14 | **ADR-0004** auth and token model; **ADR-0005** queue and outbox | Anirudh | — | Both accepted |
| S0-15 | **Monorepo setup:** pnpm workspaces, TypeScript strict, ESLint/Prettier/EditorConfig, Vitest, `.gitignore`, `.vscode/extensions.json`, CI (lint, typecheck, test) | Anirudh | GitHub repo created | CI green on an empty skeleton |
| S0-16 | **Shared contracts v0** in `shared/`: capture events, WebSocket protocol messages, REST DTO skeleton, summary JSON schema (zod) + generated JSON Schema | Anirudh | S0-15 | Contracts merged with tests |
| S0-17 | **Design tokens and fonts** as CSS variables (DESIGN §5), bundled font files, icon set | Anirudh | S0-15 | Token package merged |
| S0-18 | **Draft legal texts:** privacy policy, terms of use, consent explainer, sub-processor list | Anirudh | ADR-0001 for vendor names | Drafts ready for legal review in S6 |

**Exit criteria:** ADR-0001, ADR-0002, ADR-0004, ADR-0005 accepted · repository with green CI ·
contracts v0 merged · tokens package merged.

### Stage 0 status — complete (2026-11-01)

All Stage 0 work was done by Anirudh (Claude Code) on branch `anirudh`. Two product decisions on
2026-11-01 changed the scope: **Google's speech library for transcription, Sarvam dropped**
([ADR-0001](adr/0001-stt-provider.md)), and **video of the meeting screen is recorded too**
([ADR-0011](adr/0011-video-screen-recording.md)). Benchmark data lives in `recording/bench-data/`
(gitignored).

| Task | Status | Result / what moved |
|---|---|---|
| S0-01 | ✅ Replaced | No consented recordings were available, so the benchmark used the public **MUCS 2021 Hindi-English** set (20 clips, CC BY-SA 4.0). The consent and recording kit stays in `docs/benchmark/` for meeting recordings during **S1 dogfooding** |
| S0-02 | ✅ Done | Deepgram (`mip_opt_out`) and Gemini (free tier — public data only) keys used; Sarvam used then dropped. Google Speech-to-Text is no longer needed (Deepgram only, ADR-0001 §0, 2026-11-05) |
| S0-03 | ✅ Done | Annotation guideline; canonical Hinglish list v1 (92 entries) |
| S0-04 / S0-05 | ✅ Replaced | References come from the dataset (`bench import-kaldi`); own annotation moves to S1 dogfooding |
| S0-06 | ✅ Done | Batch runner; Phase A run on 20 clips for Deepgram, Gemini, Sarvam |
| S0-07 | ✅ Done | Streaming harness; Phase B run (Deepgram 20, Gemini 20, Sarvam 19). **Google Chirp 3 provider added** (`provider: "google"`, 5-min rotation) |
| S0-08 | ✅ Done | Normalizer + scorer, plus spelling-insensitive WER; `summarize`, `score --out` |
| S0-09 | ✅ Done (partial phases) | Phase D (Opus) done → ADR-0003. Phases E–G need entities, multi-person meetings and summaries — moved to S1 dogfooding |
| S0-10 | ➡️ Moved | Blind readability rating runs on Deepgram output during dogfooding (tool ready: `bench blind-samples`) |
| S0-11 | ✅ Accepted | [ADR-0001](adr/0001-stt-provider.md): first Google Chirp 3 primary (gated); amended 2026-11-05 to **Deepgram Nova-3 only**, gate cancelled; D-03 closed |
| S0-12 | ✅ Done | ADR-0002 checks 2, 3, 5 (estimate), 6. Confirm the estimate in the pricing calculator when provisioning (S1-10) |
| S0-13 | ✅ Accepted, checks moved to S1-11 | [ADR-0002](adr/0002-backend-stack-and-hosting.md) accepted 2026-11-01; the Cloud Run 2-hour test and the `asia-south1` latency run need the staging project |
| S0-14 | ✅ Accepted | ADR-0003, ADR-0004, ADR-0005 |
| S0-15 | ✅ Done | Monorepo, CI, `pnpm check` |
| S0-16 | ✅ Done | Contracts v0 + video additions (`video.part_started/stopped`, `recordVideo`, fragment signing and playback DTOs) |
| S0-17 | ✅ Done | Design tokens, fonts, icons |
| S0-18 | ✅ Drafted | Legal drafts updated for video and the new sub-processors — legal review in S6-05 |

**Carried into Stage 1 (Anirudh):** the ADR-0001 gate (cancelled 2026-11-05, Deepgram only), the
ADR-0011 verification checks (S1-13), the S0-13 live checks (S1-11), and Phases E–G on dogfooding
recordings.

---

## Stage 1 — Capture spike (M1)

**Goal:** prove the core technical path — two-lane capture in Chrome, streamed without loss — and
answer ARCHITECTURE §26.2.
**Estimate:** weeks 3–6 (overlaps the end of S0).

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S1-01 | ✅ **Extension skeleton:** MV3 manifest with PRD §18 permissions, build tooling, service worker entry, offscreen document creation, tab-specific side panel registration, content script injection on `meet.google.com` (2026-11-02) | Gaurav | S0-15 | Unpacked extension loads; side panel opens on the Meet tab only |
| S1-02 | ✅ **Two-lane capture:** stream ID in the service worker → offscreen `getUserMedia` (tab + mic with echo cancellation) → playback routing to speakers (2026-11-03) | Anirudh | S1-01 | Both lanes captured; user still hears Meet |
| S1-03 | **Audio worklets:** downmix, resample to 16 kHz PCM16, 100 ms framing, per-lane level output; optional Opus encoder | Anirudh | S1-02 | Frames verified in tests; CPU measured |
| S1-04 | **Local buffer and stream client:** IndexedDB write-first, sequence numbers per lane, ack-based pruning, reconnect with `hello.resumeFrom` replay | Anirudh | S1-03, S0-16 | Network-drop test loses no frames |
| S1-05 | **Minimal gateway:** accept WS with a stream token, store 10 s chunks to Cloud Storage, ack after durable write, forward to one STT provider, return interim/final. **Local done 2026-11-04** (Deepgram, Opus via Ogg, cost per session); staging moved to S2 — dev endpoints have no sign-in, so they stay local until ADR-0004 auth exists (Anirudh, 2026-11-04) | Anirudh | S1-04, S1-10 | Live transcript returns locally ✅; in staging after S2 sign-in |
| S1-06 | **Recording state machine** in the service worker, persisted in `chrome.storage.session`, broadcast to all surfaces | Anirudh | S1-01 | Survives service-worker restart mid-recording |
| S1-07 | ✅ **Meet adapter v0:** selectors module with fallbacks + version tags, in-call/lobby/ended detector, title and participant names, selector health report (merged 2026-11-04) | Gaurav | S1-01 | Detection within 5 s; never in lobby |
| S1-08 | ✅ **Active-speaker and mute signals:** observe Meet's DOM, emit `speaker.active` and mute events per the contract (2026-11-05) | Gaurav | S1-07, S0-16 | Events logged with timestamps, live verified in Chrome ✅ |
| S1-09 | ✅ **Prompt chip prototype in Shadow DOM:** in-page chip over Google Meet, Escape/dismiss, user-gesture verified for `tabCapture` and `sidePanel.open()` (2026-11-05) | Gaurav | S1-01 | Answers to §26.2 questions 1 and 7 written up ✅ |
| S1-10 | ✅ **Staging infrastructure v0** (Terraform, `asia-south1`): Cloud Run gateway, Cloud SQL PostgreSQL 16 (private IP), Cloud Storage bucket with 7-day lifecycle rule, Secret Manager, Serverless VPC Access connector — provisioned via `terraform apply` (2026-11-05) | Gaurav | ADR-0002 | `terraform apply` creates staging from scratch ✅ |
| S1-11 | **Measurements and long sessions:** CPU/memory, echo leakage on laptop speakers, 2-hour meeting through Cloud Run's 60-minute reconnect (after S2 sign-in, see S1-05), Deepgram backlog catch-up speed, gateway cost per session | Anirudh | S1-05 | §26.2 questions 2, 3, 5, 6 written up; ADR-0003 decided |
| S1-13 | **Video capture spike** ([ADR-0011](adr/0011-video-screen-recording.md) §5): `MediaRecorder` on the tab video + WebAudio mix in the offscreen document, 10 s fragments to IndexedDB `video_buffer`, MIME support, hidden-tab rendering, CPU/battery with video on/off, audio-first uploader on a 2 Mbps link | Anirudh | S1-02, S1-04 | ADR-0011 checks 1–4 recorded; audio loss 0 with video on. **Code done 2026-11-05:** recorder, audio-first uploader to the local gateway, data-saver switch; Chrome checks pending |
| S1-14 | ~~**ADR-0001 gate** with Google Chirp 3~~ — **cancelled 2026-11-05**: Deepgram is the only STT provider (ADR-0001 §0) | Anirudh | — | — |
| S1-12 | ✅ **DOM signal reliability and overlay performance:** active-speaker accuracy on calls; glass `backdrop-filter` cost inside Meet (2026-11-05) | Gaurav | S1-08, S1-09 | §26.2 questions 4 and 8 written up ✅ |

**Exit criteria (PRD M1):** a 60-minute Meet call recorded with no audio loss, with video on, live Deepgram
transcript for the whole call · CPU/memory measured ·
user-gesture and permission questions answered · ADR-0003 accepted · findings recorded in
ARCHITECTURE §26.2.

---

## Stage 2 — Realtime core and data platform

**Goal:** production-quality realtime path and data platform: record → live transcript → stored,
tenant-isolated segments, visible through the API.
**Estimate:** weeks 6–11.

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S2-01 | ✅ **Database schema and migrations** (PRD §13) with row-level security keyed on workspace, data-access layer that refuses unscoped queries, cross-tenant tests. **Code done 2026-11-05** (`backend/packages/db`, Kysely + PGlite tests); applied on staging by the migrate job on every deploy | Anirudh | ADR-0002 | Migrations apply on staging; cross-tenant tests fail as expected |
| S2-02 | ✅ **Auth service** (ADR-0004): Google ID token exchange, access tokens, rotating refresh tokens with reuse detection, session-scoped stream tokens, auth middleware package. **Done 2026-11-05** (`backend/packages/auth`, migration 0002); real Google client checks in S4-03 | Anirudh | S2-01 | Token tests pass; middleware published for the API |
| S2-03 | ✅ **Provider layer** (ARCHITECTURE §7): STT streaming/batch, LLM, transliterator interfaces, capability descriptors, registry, enforced opt-outs, free-key guard by environment (free Gemini key only in `local`/`ci`), adapter for the ADR-0001 provider (Deepgram Nova-3, streaming and pre-recorded). **Done 2026-11-06** (`backend/packages/providers`); the LLM adapter comes with S3-01 (Gemini Flash first, 2026-11-07) | Anirudh | ADR-0001 | Contract tests against each adapter |
| S2-04 | **Gateway, production version:** **Code done 2026-11-06** (session registry memory/Redis via `ioredis`, takeover on any instance, JWT stream tokens from the public JWKS, health + batch-later marking, glossary keyterms; kill-an-instance test). Cloud Storage chunk store and staging boot done 2026-11-06 (`GcsChunkStore`, `Dockerfile.gateway`); deploy and the cloud failover test remain. Redis session state, resume on any instance, per-lane STT sessions with keep-alive and rotation overlap, outage handling (degraded health, batch-later marking), glossary terms in session config | Anirudh | S1-05, S2-03 | Kill-an-instance test resumes with no loss |
| S2-05 | ✅ **Transcript assembler:** **Code done 2026-11-06** (`assembler.ts`, `@meetyou/hinglish`; segments stored with or without a client, in Postgres or files; display policy `as_provided` by default, `roman_rules` available). session-clock mapping, Roman transliteration, canonical spelling normalization, ULID segment IDs, echo flags, `transcript.segment` push | Anirudh | S2-04, S0-03 | Segments stored with `text` + `raw_text`; echo test flags duplicates |
| S2-06 | **Outbox, job queue, worker runtime, scheduler** (ADR-0005) with retries, backoff, dead-letter state. **Code done 2026-11-06** (`backend/packages/queue`; worker app `backend/apps/worker` + `Dockerfile.worker` 2026-11-06); crash test on Cloud Run with S2-12 | Anirudh | S2-01 | Crash-during-job test completes exactly once |
| S2-07 | ✅ **Usage and cost records** **Done 2026-11-06** (one realtime `usage_records` row per meeting, checked on staging by every smoke run; LLM tokens come with S3). per meeting (STT seconds per lane, tokens, storage) | Anirudh | S2-04 | `usage_records` populated for every session |
| S2-08 | ✅ **API service scaffold:** Fastify app, error format, idempotency keys, cursor pagination, OpenAPI generated from `shared/` schemas, uses the auth middleware (2026-11-06) | Gaurav | S2-02, S0-16 | Health endpoint deployed; OpenAPI published ✅ |
| S2-09 | ✅ **Core endpoints:** `/me`, `/settings`, `/meetings` (list, detail, patch, soft delete, restore), `/meetings/{id}/notes` (append & bulk sync), `/segments`, `/consent-log` (save & fetch), `/sessions` (start with stream token, end, recover), and public JWKS (2026-11-06) | Gaurav | S2-08, S2-01 | 29 tests pass; multi-tenant isolation and contracts verified ✅ |
| S2-10 | ✅ **Data lifecycle jobs:** **Done 2026-11-06**; meeting delete verified on staging by every smoke run (worker deletes after the grace) (Gaurav: `@meetyou/queue` lifecycle tasks; Anirudh: fixes — retention deletes the audio row, account delete sets `app.user_id`, storage errors retry —, worker registration with bucket cleanup, retention scheduled by `video.finalize`, `POST /v1/account:delete` + web Settings alert). Audio rows arrive with S3. audio retention scheduler (`delete_after`), lifecycle backstop rule, meeting deletion with 10 s grace and `:restore`, account deletion, deletion audit | Gaurav | S2-06 | Retention and deletion tests pass, including "failed processing never deletes audio" |
| S2-11 | ✅ **Observability:** **Done 2026-11-06 (Anirudh)**: `@meetyou/log` allow-list logger in gateway/worker, Fastify `severity`/`message`, worker `queue.depth`, `infra/modules/monitoring` (7 log metrics, 6 alerts, "Minutes staging" dashboard) applied; OpenTelemetry tracing in `@meetyou/tracing` (one trace per meeting, OTLP to the Telemetry API; IAM via `-target=google_project_iam_member.telemetry`); STT final latency, ack lag and per-session STT cost metrics, an expensive-session alert and an optional monthly budget (re-apply `module.monitoring`). OpenTelemetry setup, logging library with field allow-list, dashboards and alerts from ARCHITECTURE §20 | Gaurav | S2-08 | Dashboards live in staging; content-free logs verified |
| S2-12 | ✅ **CI/CD to staging** **Done 2026-11-06 (Anirudh)**: `deploy-staging.yml` (build, migrate, roll out, smoke), WIF in `infra/modules/ci` (applied), smoke job `backend/apps/smoke` (passing on staging); first automatic deploy green (run 42244940247). One-time setup in STAGING_SETUP §9.3. with smoke test: synthetic audio fixture streamed through gateway → segments visible via API | Gaurav | S2-05, S2-09 | Every merge to `main` deploys and smoke-tests staging |
| S2-14 | **Video upload and finalize:** **Code done 2026-11-06; running on staging** (uploads also resume at browser startup; only the 60-min sync check remains) (`@meetyou/video`: finalize with ffmpeg, gap fill, poster, queue task with re-checks and 24 h cap, retention `delete_after`; part timing events; dev playback with Range). V4 signed URLs + playback helper in `@meetyou/storage` (2026-11-06); API routes (S2-09), CORS apply and the 60-min sync check remain. `fragments:sign` endpoint (own active session, ≤ 50 URLs, 15-min expiry, content-type and size bound), bucket CORS for the extension origin, `video.finalize` job (concat, faststart MP4 remux, gap fill, poster), `video_assets.delete_after` in the retention job, `GET /meetings/{id}/video` | Anirudh | S2-06, S2-09, S1-13 | 60-min recording plays with transcript sync ±0.5 s; retention deletes video |
| S2-13 | ✅ **Synthetic audio fixtures and recorded WebSocket sessions** **Done 2026-11-06** (`shared/fixtures`: scripted standup, recorded session + replayer, local TTS audio script). for tests and UI mocks | Anirudh | S2-05 | Fixtures published in `shared/fixtures` (synthetic only) |

### Stage 2 — Anirudh's remaining work (plan of 2026-11-06)

Decisions for this plan (Anirudh, 2026-11-06): Redis through **`ioredis`** behind an interface (the
long-term choice); video finalize uses the **`ffmpeg` binary** in the worker; Hindi display text
stays as the STT provider returns it for now — the assembler gets a transliterator plug-in point
(identity by default) that Anirudh will switch later.

| Step | Task | What gets built | Verified by |
|---|---|---|---|
| 1 | S2-05 | `transcript assembler` module in the gateway: session-clock mapping, transliterator plug-in (identity), canonical Hinglish spelling normalization on Roman words (display only, `rawText` kept), ULID IDs, echo flags; segments are **stored even when no client is attached** | Unit tests; gateway tests |
| 2 | S2-05, S2-07 | `backend/packages/db` repository functions: create the meeting for a session, upsert speaker clusters, insert segments, end the meeting, write `usage_records`, upsert `video_assets`; gateway sinks: database when `DATABASE_URL` is set, files under the chunk store otherwise | PGlite tests with RLS on |
| 3 | S2-04 | `SessionRegistry` interface (in-memory + Redis via `ioredis`): session records (workspace, codec, ended, STT health, batch-needed), single-use stream-token JTIs; any instance attaches a known session and resumes from durable chunks; JWT stream tokens (`@meetyou/auth`) when signing keys are configured; `health` messages (`ok`/`degraded`/`down`) and **batch-later marking** on STT failures; glossary key terms passed to Deepgram | Two-gateway kill test (shared store + registry); Redis tests against a local `redis-server` (`REDIS_URL`) |
| 4 | S2-14 | `video.finalize` queue task: join each part's playable fragments, remux to faststart MP4 (`ffmpeg -c copy`), poster JPEG, duration from `ffprobe`, gaps recorded; `video_assets` row; local CLI | Test with synthetic `ffmpeg` fragments |
| 5 | S2-13 | `shared/fixtures`: recorded WebSocket session (synthetic text, JSON) and a replayer for tests and UI mocks; script that makes synthetic TTS audio locally (`say` + `ffmpeg`, output gitignored — no audio committed) | Replayer tests |
| — | needs staging or Gaurav (runbook: [STAGING_SETUP.md](STAGING_SETUP.md)) | S2-01 apply on Cloud SQL (migration job), S2-06 Cloud Run crash test, Memorystore for Redis, Cloud Storage V4 signed PUT URLs and bucket CORS, `GET /meetings/{id}/video` and `/sessions` in the API (S2-09) | Listed in HANDOFF for Gaurav |

**Exit criteria:** recording in staging produces live transcript and stored segments · resume and
failover tests pass · tenancy tests pass · smoke test runs on every deploy.

---

## Stage 3 — Notes and summaries

**Goal:** trustworthy, cited notes within 60 seconds, with a measured quality baseline.
**Estimate:** weeks 9–14.

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S3-01 | **Summarization engine** (ARCHITECTURE §10): **Code done 2026-11-07** (`backend/packages/summarizer` + Gemini adapter in `@meetyou/providers`, `gemini-3.6-flash`; real run on the synthetic standup passes the schema in Hinglish with citations). Golden-set check in S3-05. prompt builder with data-wrapped transcript and notes, templates stored as data, single-pass with chunked fallback, JSON schema validation and retry | Anirudh | S2-03, S2-05 | Summaries validate on the golden set |
| S3-12 | ✅ **Ask this meeting** (Phase 1 since 2026-11-07, FEATURES E4): **Done 2026-11-07** — migration 0004 `meeting_questions` (RLS), `POST /v1/meetings/{id}/ask` + `GET …/questions`, Q&A engine in `@meetyou/summarizer`, website Ask tab (DESIGN §12.7); owner only, one recording, citations checked, fixed refusals, 500 chars, 30/h and 150/24 h; real Gemini check on the synthetic standup | Anirudh | S3-01 | Guardrail tests pass; staging enabled per STAGING_SETUP §9.4 |
| S3-02 | **Code done 2026-11-09** (`validate.ts`, `due-date.ts`; numbers check flags items whose numbers are not in the cited lines). **Validation chain:** citation existence, owner restriction to participants, relative-date resolution with `due_phrase`, unverified flags, numbers/dates check (P2) | Anirudh | S3-01 | Validation unit tests pass |
| S3-03 | **Code done 2026-11-09** (`backend/packages/pipeline` `meeting.summarize`, SSE progress; audio retention scheduled after the first notes). Staging 60 s P95 not measured yet. **Fast-path pipeline:** finalize → summarize → validate → index → notify, `processing_step` updates, SSE `GET /meetings/{id}/events` | Anirudh | S2-06, S3-02 | 60-minute meeting summary ≤ 60 s P95 on staging |
| S3-04 | **Code done 2026-11-09** (`meeting.retranscribe`, off unless `BATCH_TRANSCRIPTION=on`; migration 0007 speaker signals; Deepgram batch on joined Ogg checked on synthetic audio). Not run on staging. **Batch path:** batch re-transcription, speaker resolution (diarization clusters aligned with `speaker.active`), segment-ID mapping, compare-and-resummarize, action-item status carry-over | Anirudh | S3-03, S1-08 | "Notes updated" flow works; citations survive |
| S3-05 | **Code done 2026-11-09** (`tools/summary-eval`, 10 of 30+ golden meetings, baseline + CI gate; [ADR-0007](adr/0007-llm-provider-and-prompt-versions.md) **Proposed**). **Evaluation harness:** golden meeting set, metrics (PRD §14.6), regression gate in CI, ADR-0007 for the LLM choice | Anirudh | S3-01 | Baseline recorded; ADR-0007 accepted |
| S3-06 | ✅ **Done 2026-11-09** (3 injection meetings in the golden set; tests that data stays data and the request has no tools). **Prompt-injection tests** (ARCHITECTURE §14.3) added to the evaluation set | Anirudh | S3-05 | Tests pass; summary LLM has no tools |
| S3-07 | **v1 in use; v2 parked 2026-11-09** (sections + refined wording written; re-record blocked by the free-tier limit, kept in a git stash on `anirudh`). **Template content:** sections, emphasis rules, and wording for General, Standup, Client call, Interview, 1:1 (as data) | Anirudh (2026-11-09) | S3-01 | Templates pass the evaluation gate |
| S3-08 | **Code done 2026-11-09** (Anirudh) — endpoints + web Notes tab. **Summary endpoints:** `GET /summary`, `POST /summary:regenerate` (versioned, keep/go back), `PATCH /summary-items/{id}` (text, owner, due, status), `POST /feedback`, `GET /action-items` | Anirudh (2026-11-09) | S3-03, S2-08 | Endpoint tests pass |
| S3-09 | **Code done 2026-11-09** (Anirudh) — migration 0005; ~1.15 s on 500 meetings in PGlite (forced RLS prevents GIN use), staging not measured. **Search endpoint:** Postgres full-text search over normalized text (normalizer package from S2-05) for segments, notes, summary items | Anirudh (2026-11-09) | S2-05, S2-08 | Results < 1 s on 500 meetings |
| S3-10 | ✅ **Done 2026-11-09** (Anirudh) — terms reach the Deepgram session config (tested); Settings → Vocabulary. **Glossary endpoint** `GET/PUT /glossary` with provider-limit validation (limits from S2-03 capability descriptors) | Anirudh (2026-11-09) | S2-03, S2-08 | Terms reach the STT session config |
| S3-11 | **Code done 2026-11-09** (Anirudh) — migration 0006, worker zip job, Settings download, Download as .md; staging not run. **Export job:** JSON + Markdown archive, notification when ready, 24 h link | Anirudh (2026-11-09) | S2-06 | Export completes and downloads |

**Exit criteria:** cited summary package ≤ 60 s P95 · evaluation baseline and regression gate in CI ·
all summary, search, glossary, export endpoints live in staging.

---

## Stage 4 — Product UI

**Goal:** every Phase 1 screen in DESIGN.md, first against mocks, then wired to real services.
**Estimate:** weeks 5–14 (parallel with S1–S3).

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S4-01 | **Mock layer:** **Started 2026-11-06: mock API in `web/src/api`.** mock API from `shared/` schemas and a session-stream replayer using S2-13 fixtures (interim/final/health/speaker events) | Anirudh | S0-16 (S2-13 later) | UI runs fully offline against mocks |
| S4-02 | ✅ **Component library — done 2026-11-09:** `shared/ui` adds Sheet, Alert dialog (focus trap, Cancel first), Menu (arrow keys), text input/textarea, dismissible Banner, unverified chip, arrow-key Segmented; catalogue at `#/catalogue` (dev builds); Moonrise colour tokens (contrast-tested light and dark). Earlier: **Started 2026-11-06: base components in `shared/ui` (`@meetyou/ui`), used by `web/` and the side panel.** (DESIGN §6) with light/dark tokens, focus states, reduced motion/transparency | Anirudh | S0-17 | Storybook-style catalogue reviewed against DESIGN §24 |
| S4-03 | **Onboarding** (DESIGN §7): welcome, Google sign-in, mic permission with denied path, preferences, consent acknowledgement | Anirudh | S4-02, S2-02 | Under 60 s; consent ack stored |
| S4-04 | **Meet overlay UI** (DESIGN §8.2–§8.4): **Started 2026-11-06: recording pill (states, drag to corner, collapse, click to panel) and prompt restyled to §8.2; shift-left of Meet's side panel and real-Meet layout checks left.** prompt and draggable recording pill in Shadow DOM, never covering Meet controls | Anirudh | S1-09, S4-02 | Works across Meet layouts (grid, spotlight, side panels open) |
| S4-05 | **Side panel** (DESIGN §8.5–§8.7): **Started 2026-11-06: React panel with Ready, Recording (meters, transcript, notes composer, jump to live), Processing, Ready, Error; consent step waits for S4-07.** all states, transcript list with interim replacement, notes composer with tags and typed markers, offline drafts, lane meters, jump to live, processing steps, ready, too short, failed | Anirudh | S4-01, S1-06 | All states reachable with mock streams |
| S4-06 | **Client-side interim transliteration helper** and **notes sync client** (IndexedDB drafts, debounced PUT) packages | Anirudh | S2-05 | Packages published with tests |
| S4-07 | **Consent chat notice:** DOM posting into Meet chat, failure fallback with copy, consent events to the stream | Gaurav | S1-07, S4-05 | Notice posts on a real call; failure path tested |
| S4-08 | **Failure and edge states** (DESIGN §9): **Started 2026-11-06: reconnecting, back online, mic lost/missing, video stopped, tab silent, error in the panel.** reconnecting, mic lost, silent lane, transcript delayed, error, crash recovery banner, session limit, second tab, stop and delete | Anirudh | S4-05 | Each state reproducible from mock stream scripts |
| S4-09 | **Library app as a web app (D-07, 2026-11-05):** **Started 2026-11-06 (`web/`, React + Vite): Home, Meetings, Meeting detail (notes, transcript, citations), Action items; Google sign-in, real API for meetings/transcript/video, Cloud Run server with `/v1` proxy (STAGING_SETUP §9.2).** sign-in (ADR-0004 §4.5), hosting per ADR-0006; Home, Meetings (search, filters), Meeting detail (Notes with legend, anchored sections, decisions, open questions, unverified; Transcript with search, speaker rename, echo toggle; citation popover and card; audio player; rename; regenerate menu with version banner; inline edit; feedback) | Anirudh | S4-02, S3-08 | Matches DESIGN §10–§12 |
| S4-10 | **Share sheet, export, delete with undo, consent-log sheet** (DESIGN §13) | Anirudh | S4-09 | Paste tests in Slack, WhatsApp, Gmail, Notion pass |
| S4-11 | **Action items page and Home to-dos** (DESIGN §14) | Anirudh | S3-08 | Status persists; undo works |
| S4-12 | **Settings** (DESIGN §15): recording, consent mode + message, language, show-Hindi-as, retention with effect sentence, export, sub-processors, analytics opt-out, vocabulary, account delete | Anirudh | S2-09, S3-10 | All settings persist and take effect |
| S4-13 | **Badge and notifications:** toolbar badge states from the state machine, Chrome notifications for notes ready and export ready, keyboard shortcuts | Anirudh | S1-06 | Badge mirrors every state; shortcuts work |
| S4-14 | **Wire UI to real services** (replace mocks), including SSE processing progress | Anirudh | S2-12, S3-03 | Mocks removed from production build |
| S4-15 | **Product analytics events** (typed IDs/counts/enums only; opt-out honoured) | Anirudh | S4-14 | Event schema reviewed; no content fields |
| S4-17 | **Video UI** (DESIGN, ADR-0011): **Started 2026-11-06: web player (§6.19) with click-to-seek and Play from.** video toggle + quality in the pre-recording sheet, side-panel video state and "Uploading video — N%", meeting-view player above the transcript with click-to-seek from segments and citations, settings rows | Anirudh | S4-05, S4-09, S2-14 | Seek from any segment lands within ±0.5 s; states covered in design QA |
| S4-16 | **Accessibility and design QA** (DESIGN §20, §24) across all screens, light and dark, 320–480 px side panel | Anirudh | S4-14 | Checklist passes |

**Exit criteria:** every Phase 1 screen and state in DESIGN.md implemented and wired · design QA
checklist passes · no mocks in the production build.

---

## Stage 5 — Internal alpha (M2)

**Goal:** both developers use the product for every Google Meet call for two weeks.
**Estimate:** weeks 14–16.

| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S5-01 | **Alpha distribution:** signed unpacked build or trusted-tester listing; update channel | Gaurav | S4-14 | Both machines on the alpha build |
| S5-02 | **Failure drills:** network drop, gateway instance kill, STT provider outage simulation, LLM outage, browser crash recovery | Anirudh | S4-08 | Each drill ends with no data loss and correct UI state |
| S5-03 | **Capture, pipeline, and quality fixes** from dogfooding; quality metrics review against PRD §11.3 | Anirudh | S5-01 | P0 issues in owned areas closed |
| S5-04 | **Endpoint fixes** from dogfooding (UI fixes and usability notes: Anirudh, since 2026-11-05) | Gaurav | S5-01 | P0 issues in owned areas closed |
| S5-05 | **Cost per meeting-hour review** from usage records vs PRD §20 target | Anirudh | S2-07 | Report in docs; levers prioritised |
| S5-06 | **Operational dashboards review** (health, latency, selector health, retention job) | Gaurav | S2-11 | Alerts tuned; no noisy alerts |

**Exit criteria (PRD M2):** two weeks of real use · P0 bugs fixed · quality metrics baseline recorded.

---

## Stage 6 — Private beta (M3)

**Goal:** 10–30 external users with legal, security, and performance readiness.
**Estimate:** weeks 16–22.

| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S6-01 | ~~**ADR-0006** library surface~~ — **moved 2026-11-05**: D-07 decided (web app from alpha); ADR-0006 hosting and the web deploy happen with S4-09 | Gaurav | — | — |
| S6-02 | **Security review:** tenancy, token theft/reuse, signed URLs, extension message validation, logging content checks, dependency scan, prompt-injection set | Anirudh | S5 | Findings fixed or accepted with owner and date |
| S6-03 | **Performance tuning** to budgets (ARCHITECTURE §21): live latency, summary P95, extension CPU/memory | Anirudh | S5 | Budgets met on beta traffic |
| S6-04 | **Cost optimisations** behind flags: silence gating on the `me` lane, Opus transport, batch-pass policy | Anirudh | S5-05 | Cost per meeting-hour ≤ target or plan to get there |
| S6-05 | **Legal review** of privacy policy, terms, consent explainer, consent notice text; DPDP checklist | Gaurav | S0-18 | Final texts published and linked in product |
| S6-06 | **Beta operations:** invite flow, feedback channel, support diagnostics bundle (content-free), FAQ | Gaurav | S6-01 | 10–30 active beta users |
| S6-07 | **Beta metrics dashboard** (PRD §19: activation, retention, summary open rate, thumbs-up) | Gaurav | S4-15 | Weekly metrics report |
| S6-08 | **Template and prompt tuning** from feedback through the evaluation gate | Anirudh | S3-05 | Improvements merged without regressions |
| S6-09 | **Template wording updates** from beta feedback | Gaurav | S6-08 | Updated templates pass the gate |

**Exit criteria (PRD M3):** activation and retention measured · no open P0 privacy/security issues ·
legal review complete.

---

## Stage 7 — Public launch (M4)

**Goal:** public Chrome Web Store listing.
**Estimate:** weeks 22–24.

| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S7-01 | **Store listing:** description, screenshots, permission justifications (PRD §18), privacy disclosures, support URL | Gaurav | S6 | Submitted and approved |
| S7-02 | **Google OAuth consent screen** branding/verification for production | Gaurav | S6 | Verified (if required for our scopes) |
| S7-03 | **Production readiness:** production environment via Terraform, backup and point-in-time restore drill, alert routing, capacity check for 200 concurrent sessions, vendor concurrency limits confirmed | Anirudh | S6 | Restore drill passed; load test passed |
| S7-04 | **Runbooks:** incident response, vendor outage, Meet UI change, data deletion request handling | Gaurav | S7-03 | Runbooks in `docs/runbooks/` |
| S7-05 | **Launch checklist and rollback plan** (extension version rollback, feature flags, provider fallback) | Anirudh | S7-03 | Checklist signed off by both |
| S7-06 | **Help centre and onboarding content** | Gaurav | S7-01 | Published |

**Exit criteria (PRD M4):** store approval · production readiness checklist complete.

---

## Stage 8 — Product Phase 2

**Goal:** breadth (more platforms) and memory (search, chat, integrations). Order is decided after
beta data; ADRs listed must be accepted first.

| ID | Task and approach | Owner | Refs |
|---|---|---|---|
| S8-01 | **ADR-0008 and macOS desktop capture adapter:** Core Audio process taps for the meeting app, built-in-mic preference, echo cancellation, meeting detection, same event contract | Anirudh | FEATURES C6 |
| S8-02 | **Desktop app UI shell:** panel window, tray/menu-bar state, settings, auto-update | Gaurav | DESIGN §22 |
| S8-03 | **Windows desktop capture adapter** (WASAPI process loopback + mic) | Anirudh | FEATURES C6 |
| S8-04 | **File upload/import:** upload sheet, format checks, conversion, batch pipeline entry, participant names for speaker labels | Gaurav | FEATURES C5 |
| S8-05 | **ADR-0009 and retrieval service:** chunking, multilingual embeddings, pgvector + keyword hybrid search, permission filtering, reranking | Anirudh | FEATURES H3 |
| S8-06 | **Cross-meeting chat** with citations to meetings and segments; **live Q&A / catch me up** | Anirudh | FEATURES H3, E4 |
| S8-07 | **Ask UI** (sidebar page, panel tab) | Gaurav | DESIGN §22 |
| S8-08 | **Calendar sync** (Google, then Microsoft): push channels, sync tokens, renewal, upcoming meetings, Home "Up next" | Gaurav | FEATURES B2 |
| S8-09 | **Recording rules** (prompt/auto-start conditions) — engine and UI | Gaurav | FEATURES B3 |
| S8-10 | **Pre-meeting brief** generation from retrieval + open action items | Anirudh | FEATURES B4 |
| S8-11 | **MCP server:** remote, OAuth, read-only tools, workspace scoping, rate limits, audit | Anirudh | FEATURES I2 |
| S8-12 | **Delivery integrations:** Slack, Notion, Google Docs, email draft links | Gaurav | FEATURES I1, F8 |
| S8-13 | **Share links** with permissions, expiry, revoke | Gaurav | FEATURES G2 |
| S8-14 | **Highlights** in composer and shortcut; **chapters** timeline UI | Gaurav | FEATURES E3, F9 |
| S8-15 | **Chapters generation** in the summary call; follow-up draft generation | Anirudh | FEATURES F9, F8 |
| S8-16 | **Transcript editing** UI and endpoint (stable segment IDs, glossary feedback) | Gaurav | FEATURES D6 |
| S8-17 | **Plans, usage metering, payments** (INR, UPI, invoices) | Gaurav | FEATURES N1, N2 |
| S8-18 | **Microsoft sign-in** | Gaurav | FEATURES A1 |
| S8-19 | **Action-item suggestions** (detect completion in later meetings) and daily digest | Anirudh (detection) / Gaurav (digest) | FEATURES H4 |

---

## Stage 9 — Product Phase 3

| ID | Task and approach | Owner | Refs |
|---|---|---|---|
| S9-01 | **ADR-0010 and bot adapter** via a meeting-bot API vendor (webhooks → normalized events) | Anirudh | FEATURES C7 |
| S9-02 | **Video additions:** adaptive streaming (HLS) renditions; **clips service** (basic recording and playback are Phase 1, S1-13 / S2-14) | Anirudh | FEATURES K2 |
| S9-03 | **Clip UI** on the Phase 1 player | Gaurav | DESIGN §22 |
| S9-04 | **Automation engine:** triggers, conditions, actions, run log, replay, preview on past meetings | Anirudh | FEATURES I5 |
| S9-05 | **Automations UI** | Gaurav | DESIGN §22 |
| S9-06 | **CRM / ATS / task-tool sync** with review-before-push | Gaurav | FEATURES I4 |
| S9-07 | **Public API and webhooks** (scoped keys, HMAC signing, retries, delivery log) | Anirudh | FEATURES I3 |
| S9-08 | **Roles and permissions policy module**; team workspaces and folders backend | Anirudh | FEATURES M1, G4 |
| S9-09 | **Team, folder, comments, and admin UI**; audit-log viewer and export | Gaurav | FEATURES G3, G4, M4 |
| S9-10 | **SSO and SCIM** via an identity provider service | Gaurav | FEATURES M2 |
| S9-11 | **Org policies** (recording, retention, consent, integrations) enforcement | Anirudh | FEATURES M3 |
| S9-12 | **PII redaction** (Indian identifiers + named entities) before storage display and LLM input | Anirudh | FEATURES L4 |
| S9-13 | **Analytics and topic trackers** (talk share by speaking time, questions; keyword sets with Hinglish variants) | Gaurav | FEATURES J1, J2 |
| S9-14 | **India-region data residency deployment** option | Anirudh | FEATURES M5 |
| S9-15 | **Mobile app** (later; reuses the batch pipeline) | Gaurav | FEATURES C8 |

---

## 14. Hand-offs between owners

| From → To | What | Needed by | Mock until ready |
|---|---|---|---|
| Anirudh → Gaurav | `shared/` contracts v0 (events, WS protocol, DTOs, summary schema) | S1-07, S2-08, S4-01 | — (first deliverable) |
| Anirudh → Gaurav | Auth middleware package | S2-08 | Stub verifying fixed test tokens |
| Anirudh → Gaurav | Synthetic fixtures + recorded session streams | S2-12 | Hand-written mock messages |
| Anirudh → Gaurav | Normalizer package (Hinglish spelling, Roman) | S3-09 | Lowercase-only stub |
| Anirudh → Gaurav | Session creation logic for `/sessions` | S2-09 | Fake session IDs |
| Anirudh → Gaurav | Provider capability descriptors (glossary limits) | S3-10 | Fixed limit of 50 terms |
| Gaurav → Anirudh | Extension skeleton and build | S1-02, S1-06 | — |
| Gaurav → Anirudh | Meet adapter events (`speaker.active`, participants, mute, meeting ended) | S1-04, S3-04 | Fixture event script |
| Gaurav → Anirudh | Staging infrastructure (Cloud Run, Cloud SQL, Storage, Redis, secrets) | S1-05, S2-01 | Local emulators |
| Gaurav → Anirudh | API scaffold conventions (errors, idempotency, pagination) | S3-03 SSE endpoint | — |
| Gaurav → Anirudh | REST endpoints the UI uses (meetings, notes, summary, action items, search, settings, export) | S4-14 | Mock API (S4-01) |
| Gaurav → Anirudh | Consent chat notice in Meet (S4-07) | S4-05 | Copy-to-clipboard fallback |
| Gaurav → Anirudh | Benchmark recordings, references (clips 1–10), batch results | S0-08, S0-09 | — |

---

## 15. Critical path and timeline

### 15.1 Critical path
```
S0 benchmark (S0-01 → S0-04/05 → S0-06..09) → ADR-0001 → S2-03 provider layer → S2-04 gateway
→ S2-05 assembler → S3-01..03 summaries → S4-14 wiring → S5 alpha → S6 beta → S7 launch

Parallel tracks: S0-15/16 → S1 capture spike → S2-01/02 data + auth
                 S0-17 → S4-01/02 → S4-03..13 UI on mocks
```
Anything on the critical path that slips by more than one week triggers a plan update (§18).

### 15.2 Indicative timeline (weeks)
```
Week          1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16 … 22  23  24
Anirudh  S0  ███████████████
         S1          ███████████████
         S2                      ███████████████████████
         S3                                  ███████████████████████
         S5                                                      ███████████
         S6                                                              ████…████
         S7                                                                       ███████
Gaurav   S0  ███████████████
         S1          ███████████████
         S2                      ███████████████████████
         S3                                      ███████████████
         S4              ████████████████████████████████████████████
         S5                                                      ███████████
         S6                                                              ████…████
         S7                                                                       ███████
```
Estimates assume both developers working steadily on this project; revise after S1.

---

## 16. Definition of done

A task is done when:
1. Code follows AGENTS.md and the relevant doc (ARCHITECTURE / DESIGN).
2. Typecheck, lint, and tests pass in CI; new logic has tests.
3. Vendor API usage verified against current docs (noted in the PR).
4. The other owner reviewed and approved the PR.
5. Requirement IDs listed in the PR; docs updated if behaviour or contracts changed.
6. Deployed to staging (for services) or loaded in the alpha build (for the extension) and checked.
7. No transcript text, names, tokens, or real meeting data in logs, fixtures, or analytics.
8. **Every user-facing feature has its UI** (Anirudh, 2026-11-06): the DESIGN.md screen or state is
   built in the same work, or listed as a Stage 4 task naming its DESIGN section. A developer control
   (e.g. the S1 capture-controls panel) does not count as the feature's UI.

---

## 17. Contingencies

| If… | Then… | Decided by |
|---|---|---|
| Benchmark shows no provider meets Hinglish targets | Hybrid streaming + batch provider, post-processing, or revisit providers (STT_BENCHMARK_PLAN §8.3); S2-03 adapters start with the best two | Both, recorded in ADR-0001 |
| `tabCapture` gesture rules block the prompt-chip start | Start from toolbar icon or side panel only; DESIGN §8.2 prompt becomes a pointer to the icon | Both, after S1-09 |
| Cloud Run 60-minute reconnects hurt continuity | Move only the gateway to VM/GKE (ADR-0002 fallback) | Anirudh proposes, both approve |
| Meet DOM signals unreliable for speaker names | Rely on batch diarization + user rename; captions as optional signal | Both, after S1-12 |
| Summary P95 above 60 s | Faster model for first pass, refine in background; reduce prompt size | Anirudh proposes, both approve |
| UI ahead of backend | Continue on mocks; move S4-14 later; no change to contracts | Gaurav |
| Backend ahead of UI | Anirudh adds test tooling and failure drills (S5-02) early | Anirudh |

---

## 18. Keeping this plan current

- Update task status in the weekly sync; mark done tasks with ✅ and the merge date.
- Ownership or scope changes are edited here in the same PR that starts the changed work.
- After S1, revise estimates in §15 with measured data.
- When a stage closes, add a short "Stage N review" note at the end of its section: what worked,
  what changed, follow-ups.
