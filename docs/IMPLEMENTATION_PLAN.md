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
| Extension shell and UI | **Gaurav** | Manifest, build, side panel UI, Meet overlay UI, onboarding, badge, notifications |
| Library app | **Gaurav** | Home, Meetings, Meeting detail, Share, Action items, Settings |
| Design system | **Gaurav** | Tokens, components, dark mode, accessibility |
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
   uses them, so Gaurav's UI and endpoints can proceed in parallel against mocks.
2. **Mocks over waiting.** Gaurav builds UI against a mock API and a **recorded session stream**
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
| S9 | Product Phase 3 | — | 3 | Video, bot, automations, CRM, analytics, enterprise |

S2, S3, and S4 run **in parallel** after S1; S4 starts on mocks during S1.

---

## Stage 0 — Foundations and decisions (M0)

**Goal:** make the decisions that everything else depends on, and set up the repository.
**Estimate:** weeks 1–4.

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S0-01 | **Benchmark logistics:** consent forms (STT_BENCHMARK_PLAN App. A), recording sessions with OBS two-track setup, clip metadata sheet | Gaurav | — | 20 core + 2 long clips recorded with signed consent |
| S0-02 | **Provider pre-flight actions** (STT_PREFLIGHT §6): Sarvam training opt-out + screenshot + credits top-up, Deepgram account + `mip_opt_out` check, Gemini billing-enabled Cloud project, rate-limit notes | Gaurav | — | All 9 pre-flight actions ticked |
| S0-03 | **Annotation guideline and canonical Hinglish spelling list v1** (STT_BENCHMARK_PLAN §4.2) | Anirudh | — | Guideline doc + spelling list committed (no audio) |
| S0-04 | **Reference transcripts**, clips 1–10, plus review of clips 11–20 | Gaurav | S0-01, S0-03 | Clips annotated and cross-reviewed |
| S0-05 | **Reference transcripts**, clips 11–20, plus review of clips 1–10; double-annotation agreement check | Anirudh | S0-01, S0-03 | Agreement < 5% WER or guideline fixed |
| S0-06 | **Batch runner:** sends each prepared file to each provider/config, saves raw JSON + run metadata | Gaurav | S0-02 | Phase A raw results stored |
| S0-07 | **Streaming replay harness:** plays PCM at real-time speed in 100 ms chunks to each provider, records message arrival times, handles keep-alive/reconnect | Anirudh | S0-02 | Phases B and C runnable for all providers |
| S0-08 | **Normalizer + scorer:** STT_BENCHMARK_PLAN §5–§6 (WER, CER, code-switch WER, entity accuracy, DER, latency, hallucination, echo) | Anirudh | S0-03 | Results sheet generated from raw outputs |
| S0-09 | **Benchmark Phases D–G** (Opus vs PCM, boosting, downstream summary test) and analysis | Anirudh | S0-06..08 | Results analysed |
| S0-10 | **Display readability test** (Phase G) — prepare blind samples, collect both ratings | Gaurav | S0-06 | Ratings recorded |
| S0-11 | **ADR-0001** STT provider(s) | Anirudh | S0-09, S0-10 | ADR accepted; AGENTS.md D-03 closed |
| S0-12 | **ADR-0002 checks** 2, 3, 5, 6 (Cloud SQL pgvector, backup retention, cost estimate, credits) | Gaurav | — | Checks recorded in ADR §9 |
| S0-13 | **ADR-0002 checks** 1 and 4 (Cloud Run WebSocket behaviour, latency from Mumbai to vendors) | Anirudh | S0-07 | ADR-0002 Accepted |
| S0-14 | **ADR-0004** auth and token model; **ADR-0005** queue and outbox | Anirudh | — | Both accepted |
| S0-15 | **Monorepo setup:** pnpm workspaces, TypeScript strict, ESLint/Prettier/EditorConfig, Vitest, `.gitignore`, `.vscode/extensions.json`, CI (lint, typecheck, test) | Gaurav | GitHub repo created | CI green on an empty skeleton |
| S0-16 | **Shared contracts v0** in `shared/`: capture events, WebSocket protocol messages, REST DTO skeleton, summary JSON schema (zod) + generated JSON Schema | Anirudh | S0-15 | Contracts merged with tests |
| S0-17 | **Design tokens and fonts** as CSS variables (DESIGN §5), bundled font files, icon set | Gaurav | S0-15 | Token package merged |
| S0-18 | **Draft legal texts:** privacy policy, terms of use, consent explainer, sub-processor list | Gaurav | ADR-0001 for vendor names | Drafts ready for legal review in S6 |

**Exit criteria:** ADR-0001, ADR-0002, ADR-0004, ADR-0005 accepted · repository with green CI ·
contracts v0 merged · tokens package merged.

### Stage 0 status (2026-10-28, branch `feature/stage-0`)

All repository and document work for S0-01..S0-18 was prepared by Anirudh (Claude Code). Items marked
🟡 need people, accounts, or real recordings and keep their original owner.

| Task | Status | What exists / what is left |
|---|---|---|
| S0-01 | 🟡 Kit ready | [Consent form](benchmark/CONSENT_FORM.md), [topic cards](benchmark/TOPIC_CARDS.md) (20 + 2), [recording guide](benchmark/RECORDING_GUIDE.md) with OBS setup, [metadata sheet](benchmark/templates/clip-metadata.csv). **Left:** recruit participants, sign consent, record sessions (Gaurav) |
| S0-02 | 🟡 Runbook ready | [Pre-flight runbook](benchmark/PREFLIGHT_RUNBOOK.md). **Left:** console actions — Sarvam opt-out + top-up, Deepgram account, billing-enabled Gemini project, keys (Gaurav) |
| S0-03 | ✅ Done | [Annotation guideline](benchmark/ANNOTATION_GUIDELINE.md); canonical Hinglish list v1 (92 entries) in `tools/stt-benchmark/data/` |
| S0-04 / S0-05 | 🟡 Blocked on S0-01 | Reference format + example + validation in the scorer. **Left:** annotate clips (Gaurav 1–10, Anirudh 11–20) |
| S0-06 | ✅ Built | `bench run-batch` for Sarvam (SDK jobs), Deepgram (pre-recorded), Gemini (Files + Interactions). **Left:** first live run (Phase A) |
| S0-07 | ✅ Built | `bench run-stream`: real-time 100 ms replay, keep-alive, Gemini 10-min rotation. **Left:** first live run (Phases B–C) |
| S0-08 | ✅ Built | Normalizer (Devanagari→Roman, canonical spellings, numbers) + scorer (WER/CER, code-switch, entities, DER, hallucination, echo, latency); 48 tests |
| S0-09 | 🟡 Blocked on data | Run configs for Phases A, B, E in `tools/stt-benchmark/examples/`; Opus prep in README. **Left:** run D–G and analyse |
| S0-10 | 🟡 Tool ready | `bench blind-samples` creates provider-blind samples + key. **Left:** both people rate |
| S0-11 | 🟡 Template ready | [ADR-0001](adr/0001-stt-provider.md) with gates, results tables, weighted score. **Left:** fill after benchmark |
| S0-12 | 🟡 Mostly checked | ADR-0002 §9 checks 2, 3, 6 recorded; **left:** pgvector version, pricing calculator (check 5) |
| S0-13 | 🟡 Partly done | Cloud Run WebSocket rules from docs; latency measured from India laptop. **Left:** Cloud Shell run in `asia-south1`, live 2-hour test (S1-11) |
| S0-14 | ✅ Proposed | [ADR-0004](adr/0004-auth-and-token-model.md), [ADR-0005](adr/0005-job-queue-and-outbox.md). **Left:** approval + verification items |
| S0-15 | ✅ Done | pnpm workspace, TypeScript 6 strict (erasable syntax only), ESLint, Prettier, EditorConfig, Vitest, `.vscode/extensions.json`, GitHub Actions CI, `pnpm check` |
| S0-16 | ✅ Done | `shared/contracts`: events, WS protocol + binary frames, segments, REST DTOs, summary schema + JSON Schema; 11 tests |
| S0-17 | ✅ Done | `shared/design-tokens`: light/dark tokens, generated `tokens.css`, bundled fonts, icon list; 34 tests incl. WCAG contrast for both themes |
| S0-18 | ✅ Drafted | [Privacy policy](legal/PRIVACY_POLICY.md), [terms](legal/TERMS_OF_USE.md), [consent explainer](legal/CONSENT_EXPLAINER.md), [sub-processors](legal/SUBPROCESSORS.md) — legal review in S6-05 |

---

## Stage 1 — Capture spike (M1)

**Goal:** prove the core technical path — two-lane capture in Chrome, streamed without loss — and
answer ARCHITECTURE §26.2.
**Estimate:** weeks 3–6 (overlaps the end of S0).

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S1-01 | **Extension skeleton:** MV3 manifest with PRD §18 permissions, build tooling, service worker entry, offscreen document creation, tab-specific side panel registration, content script injection on `meet.google.com` | Gaurav | S0-15 | Unpacked extension loads; side panel opens on the Meet tab only |
| S1-02 | **Two-lane capture:** stream ID in the service worker → offscreen `getUserMedia` (tab + mic with echo cancellation) → playback routing to speakers | Anirudh | S1-01 | Both lanes captured; user still hears Meet |
| S1-03 | **Audio worklets:** downmix, resample to 16 kHz PCM16, 100 ms framing, per-lane level output; optional Opus encoder | Anirudh | S1-02 | Frames verified in tests; CPU measured |
| S1-04 | **Local buffer and stream client:** IndexedDB write-first, sequence numbers per lane, ack-based pruning, reconnect with `hello.resumeFrom` replay | Anirudh | S1-03, S0-16 | Network-drop test loses no frames |
| S1-05 | **Minimal gateway:** accept WS with a stream token, store 10 s chunks to Cloud Storage, ack after durable write, forward to one STT provider, return interim/final | Anirudh | S1-04, S1-10 | Live transcript returns in staging |
| S1-06 | **Recording state machine** in the service worker, persisted in `chrome.storage.session`, broadcast to all surfaces | Anirudh | S1-01 | Survives service-worker restart mid-recording |
| S1-07 | **Meet adapter v0:** selectors module with fallbacks + version tags, in-call/lobby/ended detector, title and participant names, selector health report | Gaurav | S1-01 | Detection within 5 s; never in lobby |
| S1-08 | **Active-speaker and mute signals:** observe Meet's DOM, emit `speaker.active` and mute events per the contract | Gaurav | S1-07, S0-16 | Events logged with timestamps on a 4-person call |
| S1-09 | **Prompt chip prototype in Shadow DOM** (no styling polish) to test user-gesture entry points for capture and `sidePanel.open()` | Gaurav | S1-01 | Answers to §26.2 questions 1 and 7 written up |
| S1-10 | **Staging infrastructure v0** (Terraform, `asia-south1`): Cloud Run services for gateway/API/workers, Cloud SQL, Cloud Storage bucket with lifecycle rule, Secret Manager, Redis | Gaurav | ADR-0002 | `terraform apply` creates staging from scratch |
| S1-11 | **Measurements and long sessions:** CPU/memory, echo leakage on laptop speakers, 2-hour meeting through Cloud Run's 60-minute reconnect, backlog catch-up speed per provider, gateway cost per session | Anirudh | S1-05 | §26.2 questions 2, 3, 5, 6 written up; ADR-0003 decided |
| S1-12 | **DOM signal reliability and overlay performance:** active-speaker accuracy on 2/4/6-person calls; glass `backdrop-filter` cost inside Meet | Gaurav | S1-08, S1-09 | §26.2 questions 4 and 8 written up |

**Exit criteria (PRD M1):** a 60-minute Meet call recorded with no audio loss · CPU/memory measured ·
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
| S2-01 | **Database schema and migrations** (PRD §13) with row-level security keyed on workspace, data-access layer that refuses unscoped queries, cross-tenant tests | Anirudh | ADR-0002 | Migrations apply on staging; cross-tenant tests fail as expected |
| S2-02 | **Auth service** (ADR-0004): Google ID token exchange, access tokens, rotating refresh tokens with reuse detection, session-scoped stream tokens, auth middleware package | Anirudh | S2-01 | Token tests pass; middleware published for the API |
| S2-03 | **Provider layer** (ARCHITECTURE §7): STT streaming/batch, LLM, transliterator interfaces, capability descriptors, registry, enforced opt-outs, adapters for the ADR-0001 providers | Anirudh | ADR-0001 | Contract tests against each adapter |
| S2-04 | **Gateway, production version:** Redis session state, resume on any instance, per-lane STT sessions with keep-alive and rotation overlap, outage handling (degraded health, batch-later marking), glossary terms in session config | Anirudh | S1-05, S2-03 | Kill-an-instance test resumes with no loss |
| S2-05 | **Transcript assembler:** session-clock mapping, Roman transliteration, canonical spelling normalization, ULID segment IDs, echo flags, `transcript.segment` push | Anirudh | S2-04, S0-03 | Segments stored with `text` + `raw_text`; echo test flags duplicates |
| S2-06 | **Outbox, job queue, worker runtime, scheduler** (ADR-0005) with retries, backoff, dead-letter state | Anirudh | S2-01 | Crash-during-job test completes exactly once |
| S2-07 | **Usage and cost records** per meeting (STT seconds per lane, tokens, storage) | Anirudh | S2-04 | `usage_records` populated for every session |
| S2-08 | **API service scaffold:** Fastify app, error format, idempotency keys, cursor pagination, OpenAPI generated from `shared/` schemas, uses the auth middleware | Gaurav | S2-02, S0-16 | Health endpoint deployed; OpenAPI published |
| S2-09 | **Core endpoints:** `/me`, `/settings`, `/meetings` (list, detail, patch), `/meetings/{id}/notes`, `/segments`, `/consent-log`, signed audio URL, `/sessions` start/end/recover (session creation logic provided by S2-04) | Gaurav | S2-08, S2-01 | Endpoint tests pass; contract checks green |
| S2-10 | **Data lifecycle jobs:** audio retention scheduler (`delete_after`), lifecycle backstop rule, meeting deletion with 10 s grace and `:restore`, account deletion, deletion audit | Gaurav | S2-06 | Retention and deletion tests pass, including "failed processing never deletes audio" |
| S2-11 | **Observability:** OpenTelemetry setup, logging library with field allow-list, dashboards and alerts from ARCHITECTURE §20 | Gaurav | S2-08 | Dashboards live in staging; content-free logs verified |
| S2-12 | **CI/CD to staging** with smoke test: synthetic audio fixture streamed through gateway → segments visible via API | Gaurav | S2-05, S2-09 | Every merge to `main` deploys and smoke-tests staging |
| S2-13 | **Synthetic audio fixtures and recorded WebSocket sessions** for tests and UI mocks | Anirudh | S2-05 | Fixtures published in `shared/fixtures` (synthetic only) |

**Exit criteria:** recording in staging produces live transcript and stored segments · resume and
failover tests pass · tenancy tests pass · smoke test runs on every deploy.

---

## Stage 3 — Notes and summaries

**Goal:** trustworthy, cited notes within 60 seconds, with a measured quality baseline.
**Estimate:** weeks 9–14.

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S3-01 | **Summarization engine** (ARCHITECTURE §10): prompt builder with data-wrapped transcript and notes, templates stored as data, single-pass with chunked fallback, JSON schema validation and retry | Anirudh | S2-03, S2-05 | Summaries validate on the golden set |
| S3-02 | **Validation chain:** citation existence, owner restriction to participants, relative-date resolution with `due_phrase`, unverified flags, numbers/dates check (P2) | Anirudh | S3-01 | Validation unit tests pass |
| S3-03 | **Fast-path pipeline:** finalize → summarize → validate → index → notify, `processing_step` updates, SSE `GET /meetings/{id}/events` | Anirudh | S2-06, S3-02 | 60-minute meeting summary ≤ 60 s P95 on staging |
| S3-04 | **Batch path:** batch re-transcription, speaker resolution (diarization clusters aligned with `speaker.active`), segment-ID mapping, compare-and-resummarize, action-item status carry-over | Anirudh | S3-03, S1-08 | "Notes updated" flow works; citations survive |
| S3-05 | **Evaluation harness:** golden meeting set, metrics (PRD §14.6), regression gate in CI, ADR-0007 for the LLM choice | Anirudh | S3-01 | Baseline recorded; ADR-0007 accepted |
| S3-06 | **Prompt-injection tests** (ARCHITECTURE §14.3) added to the evaluation set | Anirudh | S3-05 | Tests pass; summary LLM has no tools |
| S3-07 | **Template content:** sections, emphasis rules, and wording for General, Standup, Client call, Interview, 1:1 (as data) | Gaurav | S3-01 | Templates pass the evaluation gate |
| S3-08 | **Summary endpoints:** `GET /summary`, `POST /summary:regenerate` (versioned, keep/go back), `PATCH /summary-items/{id}` (text, owner, due, status), `POST /feedback`, `GET /action-items` | Gaurav | S3-03, S2-08 | Endpoint tests pass |
| S3-09 | **Search endpoint:** Postgres full-text search over normalized text (normalizer package from S2-05) for segments, notes, summary items | Gaurav | S2-05, S2-08 | Results < 1 s on 500 meetings |
| S3-10 | **Glossary endpoint** `GET/PUT /glossary` with provider-limit validation (limits from S2-03 capability descriptors) | Gaurav | S2-03, S2-08 | Terms reach the STT session config |
| S3-11 | **Export job:** JSON + Markdown archive, notification when ready, 24 h link | Gaurav | S2-06 | Export completes and downloads |

**Exit criteria:** cited summary package ≤ 60 s P95 · evaluation baseline and regression gate in CI ·
all summary, search, glossary, export endpoints live in staging.

---

## Stage 4 — Product UI

**Goal:** every Phase 1 screen in DESIGN.md, first against mocks, then wired to real services.
**Estimate:** weeks 5–14 (parallel with S1–S3).

### Tasks
| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S4-01 | **Mock layer:** mock API from `shared/` schemas and a session-stream replayer using S2-13 fixtures (interim/final/health/speaker events) | Gaurav | S0-16 (S2-13 later) | UI runs fully offline against mocks |
| S4-02 | **Component library** (DESIGN §6) with light/dark tokens, focus states, reduced motion/transparency | Gaurav | S0-17 | Storybook-style catalogue reviewed against DESIGN §24 |
| S4-03 | **Onboarding** (DESIGN §7): welcome, Google sign-in, mic permission with denied path, preferences, consent acknowledgement | Gaurav | S4-02, S2-02 | Under 60 s; consent ack stored |
| S4-04 | **Meet overlay UI** (DESIGN §8.2–§8.4): prompt and draggable recording pill in Shadow DOM, never covering Meet controls | Gaurav | S1-09, S4-02 | Works across Meet layouts (grid, spotlight, side panels open) |
| S4-05 | **Side panel** (DESIGN §8.5–§8.7): all states, transcript list with interim replacement, notes composer with tags and typed markers, offline drafts, lane meters, jump to live, processing steps, ready, too short, failed | Gaurav | S4-01, S1-06 | All states reachable with mock streams |
| S4-06 | **Client-side interim transliteration helper** and **notes sync client** (IndexedDB drafts, debounced PUT) packages | Anirudh | S2-05 | Packages published with tests |
| S4-07 | **Consent chat notice:** DOM posting into Meet chat, failure fallback with copy, consent events to the stream | Gaurav | S1-07, S4-05 | Notice posts on a real call; failure path tested |
| S4-08 | **Failure and edge states** (DESIGN §9): reconnecting, mic lost, silent lane, transcript delayed, error, crash recovery banner, session limit, second tab, stop and delete | Gaurav | S4-05 | Each state reproducible from mock stream scripts |
| S4-09 | **Library app:** Home, Meetings (search, filters), Meeting detail (Notes with legend, anchored sections, decisions, open questions, unverified; Transcript with search, speaker rename, echo toggle; citation popover and card; audio player; rename; regenerate menu with version banner; inline edit; feedback) | Gaurav | S4-02, S3-08 | Matches DESIGN §10–§12 |
| S4-10 | **Share sheet, export, delete with undo, consent-log sheet** (DESIGN §13) | Gaurav | S4-09 | Paste tests in Slack, WhatsApp, Gmail, Notion pass |
| S4-11 | **Action items page and Home to-dos** (DESIGN §14) | Gaurav | S3-08 | Status persists; undo works |
| S4-12 | **Settings** (DESIGN §15): recording, consent mode + message, language, show-Hindi-as, retention with effect sentence, export, sub-processors, analytics opt-out, vocabulary, account delete | Gaurav | S2-09, S3-10 | All settings persist and take effect |
| S4-13 | **Badge and notifications:** toolbar badge states from the state machine, Chrome notifications for notes ready and export ready, keyboard shortcuts | Gaurav | S1-06 | Badge mirrors every state; shortcuts work |
| S4-14 | **Wire UI to real services** (replace mocks), including SSE processing progress | Gaurav | S2-12, S3-03 | Mocks removed from production build |
| S4-15 | **Product analytics events** (typed IDs/counts/enums only; opt-out honoured) | Gaurav | S4-14 | Event schema reviewed; no content fields |
| S4-16 | **Accessibility and design QA** (DESIGN §20, §24) across all screens, light and dark, 320–480 px side panel | Gaurav | S4-14 | Checklist passes |

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
| S5-04 | **UI and endpoint fixes** from dogfooding; usability notes | Gaurav | S5-01 | P0 issues in owned areas closed |
| S5-05 | **Cost per meeting-hour review** from usage records vs PRD §20 target | Anirudh | S2-07 | Report in docs; levers prioritised |
| S5-06 | **Operational dashboards review** (health, latency, selector health, retention job) | Gaurav | S2-11 | Alerts tuned; no noisy alerts |

**Exit criteria (PRD M2):** two weeks of real use · P0 bugs fixed · quality metrics baseline recorded.

---

## Stage 6 — Private beta (M3)

**Goal:** 10–30 external users with legal, security, and performance readiness.
**Estimate:** weeks 16–22.

| ID | Task and approach | Owner | Depends on | Done when |
|---|---|---|---|---|
| S6-01 | **ADR-0006** library surface; if web app: deploy the library as a web app reusing the component library, auth bootstrapping, CDN hosting | Gaurav | S5 | Library available at the chosen surface |
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
| S9-02 | **Video pipeline:** fragmented uploads, transcoding to adaptive streaming, signed playback; **clips service** | Anirudh | FEATURES K1, K2 |
| S9-03 | **Video player and clip UI** | Gaurav | DESIGN §22 |
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
| Anirudh → Gaurav | Recording state machine API (state + transitions) | S4-05, S4-13 | Mock state publisher |
| Anirudh → Gaurav | Auth middleware package | S2-08 | Stub verifying fixed test tokens |
| Anirudh → Gaurav | Synthetic fixtures + recorded session streams | S4-01, S2-12 | Hand-written mock messages |
| Anirudh → Gaurav | Normalizer package (Hinglish spelling, Roman) | S3-09 | Lowercase-only stub |
| Anirudh → Gaurav | Interim transliteration helper + notes sync client | S4-05 | Pass-through stub |
| Anirudh → Gaurav | Session creation logic for `/sessions` | S2-09 | Fake session IDs |
| Anirudh → Gaurav | Provider capability descriptors (glossary limits) | S3-10 | Fixed limit of 50 terms |
| Gaurav → Anirudh | Extension skeleton and build | S1-02, S1-06 | — |
| Gaurav → Anirudh | Meet adapter events (`speaker.active`, participants, mute, meeting ended) | S1-04, S3-04 | Fixture event script |
| Gaurav → Anirudh | Staging infrastructure (Cloud Run, Cloud SQL, Storage, Redis, secrets) | S1-05, S2-01 | Local emulators |
| Gaurav → Anirudh | API scaffold conventions (errors, idempotency, pagination) | S3-03 SSE endpoint | — |
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
