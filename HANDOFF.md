# HANDOFF.md — Shared Context and Decision Log

Shared memory for **Anirudh** (Claude Code) and **Gaurav** (Google Antigravity). Read this at the
start of every session; add a log entry at the end (§9). Decisions are summarised here with a
pointer to where the full detail lives — the linked document stays the source of truth.

| Field | Value |
|---|---|
| Last updated | 2026-10-29 (Stage 0 continued) |
| Updated by | Anirudh (Claude Code) |
| Repository | [anirudhbhatia-1/meetyou](https://github.com/anirudhbhatia-1/meetyou) — branches `main`, `anirudh` |
| Current stage | **Stage 0** in progress — repo tooling, contracts, tokens, benchmark tools, ADR drafts done on `feature/stage-0`; people-dependent tasks open (§7) |

---

## 1. Project in one paragraph

A **bot-free, privacy-first, Hinglish-first AI meeting recorder**. Phase 1 is a **Google Meet
Chrome (MV3) extension** that records two separate audio lanes — `me` (microphone) and `them`
(Meet tab) — shows a live transcript, lets the user write notes that become **anchors** for the AI
summary, and produces cited notes, decisions, and action items within ~60 seconds. A
platform-agnostic core lets us add a desktop app, file upload, and an optional bot later without
rewriting anything.

---

## 2. Team and ways of working

| | Anirudh | Gaurav |
|---|---|---|
| AI tool | Claude Code | Google Antigravity |
| Owns | Capture engine, realtime gateway, provider layer, pipeline, summarization and evaluation, data platform and auth, shared contracts, security review | Meet DOM adapter, extension shell and all UI, library app, design system, REST endpoints, retention/deletion jobs, infrastructure and CI/CD, launch and legal documents |
| Task list | [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | same |

- **Communication** between people: Hinglish. **Code, comments, commits, docs:** English.
- **Every PR is reviewed by the other person** with their own agent.
- **Contracts first:** `shared/` schemas and fixtures come before the code that uses them; UI is
  built against mocks until services are ready.
- **Rules for agents:** [AGENTS.md](AGENTS.md) (both tools read it; `CLAUDE.md` imports it).
- `GAURAV_ANTIGRAVITY_SETUP.md` was removed by Anirudh, then re-added by Gaurav on `main` (2026-10-28); it is Gaurav's file.
- **Stage 0 ownership (2026-10-28):** Anirudh does all of Stage 0 (S0-01..S0-18).
- Anirudh's git rule: work on `anirudh`, push it, then fast-forward `main`; no new branches.

---

## 3. Document map

| Document | What it is for |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules every agent follows: scope, architecture rules, coding standards, git, decisions log, pitfalls |
| [docs/PRD.md](docs/PRD.md) | Requirements with IDs (`FR-…`, `NFR-…`), data model, permissions, metrics, milestones, open decisions |
| [docs/FEATURES.md](docs/FEATURES.md) | Every feature end to end: workflow, how others do it, best way for us |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design: extension, streaming protocol, gateway, providers, pipeline, data, API, security, deployment |
| [docs/DESIGN.md](docs/DESIGN.md) | Every screen, component, token, state, and string; screen → API map |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Stages S0–S9, tasks, owners, hand-offs, timeline |
| [docs/STT_BENCHMARK_PLAN.md](docs/STT_BENCHMARK_PLAN.md) | How we choose the speech-to-text provider |
| [docs/STT_PREFLIGHT.md](docs/STT_PREFLIGHT.md) | Researched facts about Sarvam, Deepgram, Gemini (terms, limits, prices) |
| [docs/adr/](docs/adr/README.md) | Architecture decision records |
| `ai_meeting_recorders_master_architecture_blueprint.md` | Early third-party research blueprint. **Reference only** — several code samples in it are wrong (see §6) |
| Design handoff (outside repo) | `~/design_handoff_minutes_app/` on Anirudh's machine: clickable prototype + original spec, now superseded by DESIGN.md |

---

## 4. Decisions made

All dated 2026-10-28 unless noted.

### 4.1 Product scope
| Decision | Detail | Where |
|---|---|---|
| Start with Google Meet only | Other platforms later through new adapters | PRD §7, AGENTS §2 |
| Chrome extension, no bot | Bot is optional in product Phase 3, and we buy (bot API vendor) before building | FEATURES C1, C7 |
| Phase 1 is audio only | No video until Phase 3 | PRD §3.3 |
| Two lanes (`me` / `them`) end to end | Never mixed before transcription | ARCHITECTURE §1 |
| Take the best ideas from competitors, not everything | Phased list; features and ideas only — no copied code, UI, or branding | FEATURES §1, appendix in PRD |
| Differentiators | Hinglish accuracy, bot-free, cited anchored notes, visible privacy, India pricing | PRD §5.3 |
| Lightweight action-items list in Phase 1 | Open/done, filter, link to meeting | PRD FR-LIB-06, DESIGN §14 |
| Delete with undo | 10-second server grace period, UI Undo for 5 s | PRD FR-SET-02, ARCHITECTURE §16.6 |

### 4.2 Numbered decisions
| ID | Decision | Where |
|---|---|---|
| **D-01** | Hindi/Hinglish transcripts display in **Roman script** by default; always store the provider's original output (`raw_text`); Devanagari display later as a setting; mixed-script fallback if transliteration benchmarks poorly | AGENTS §9, PRD ML-03/04 |
| **D-02** | Audio retention default **7 days**; user can choose "delete after notes" (only after successful processing) or 30 days; transcripts and notes stay until the user deletes them | AGENTS §9, PRD FR-SET-01 |
| **D-08** | Backend: **TypeScript/Node.js on Google Cloud Mumbai** (Cloud Run, Cloud SQL, Cloud Storage). ADR-0002 "Option B selected"; becomes Accepted after verification checks | [ADR-0002](docs/adr/0002-backend-stack-and-hosting.md) |

### 4.3 Architecture and engineering rules
- Platform-specific code only in **adapters**; the core consumes normalized events only.
- STT and LLM vendors behind **provider interfaces**; vendor choice is configuration.
- **No API keys in the extension**; short-lived tokens from our backend.
- **`workspace_id` on every row**, enforced with row-level security.
- LLM **cites segment IDs**; code maps them to timestamps; never let the LLM invent timestamps.
- Summaries: single pass by default (map-reduce only for very long meetings).
- The realtime gateway needs long-lived containers — **not serverless functions**.
- Audio is always stored temporarily until processing succeeds; retention deletes it afterwards.
- Summarization LLM has **no tools** (prompt-injection defence).
- Docs language English; monorepo with `extension/`, `backend/`, `shared/`, `docs/` (ARCHITECTURE §23).

### 4.4 Privacy and vendor rules
- **Free API tiers only with fully synthetic audio** — never real voices or personal information,
  even with consent (Gemini free-tier terms forbid personal info).
- Deepgram: `mip_opt_out=true` on every request. Sarvam: turn off training in account settings
  first. Gemini: billing-enabled Cloud project only.
- Never: training on user data, voiceprints across meetings, emotion inference from voice/video,
  auto-emailing notes to attendees, auto-recording by default.

### 4.5 Design
- The design handoff ("Minutes" working name) is adopted; DESIGN.md supersedes the handoff spec.
- Contrast fixes: interim text uses `muted` italic; new `control-line #8a8a83` token for control
  borders.
- Meet overlay in Shadow DOM; no restyling of Meet's own tiles; fonts bundled in the extension.
- Consent notice modes: One click (default) · Automatic · Off (Off needs confirmation).

### 4.6 Stage 0 engineering decisions (2026-10-28)
- pnpm workspace, Node 24, **TypeScript ~6.0** (typescript-eslint does not support TS 7 yet),
  `erasableSyntaxOnly` so Node can run `.ts` files directly; Vitest; ESLint flat config; Prettier.
- Packages: `@meetyou/contracts`, `@meetyou/design-tokens`, `@meetyou/stt-benchmark`.
- Contracts add two events to AGENTS §4: `mic.mute_changed`, `consent.notice`; `session.ended` has a
  `reason`. Binary audio frames: `lane u8 | seq u32 | captureMs u32`, little-endian, protocol v1.
- **Accepted 2026-10-29** ADR-0004: Google sign-in via `launchWebAuthFlow` + PKCE; our ES256 JWT access (15 min),
  rotating hashed refresh tokens (30 days, family revocation), single-use stream tokens.
- **Accepted 2026-10-29** ADR-0005: graphile-worker, jobs added in the same transaction (queue = outbox).
- Dependencies are pinned to releases at least ~2 weeks old (pnpm minimum release age); e.g.
  `sarvamai` pinned to 1.1.11.

### 4.7 Repository
- Repo created and pushed 2026-10-28: `main` and `anirudh` at the same commit. Work happens on
  personal/feature branches; `main` only through reviewed PRs.

---

## 5. Open decisions

| ID | Question | Status / next step | Owner of next step |
|---|---|---|---|
| D-03 | STT provider(s) | Benchmark Sarvam, Deepgram Nova-3 multilingual, Gemini Transcribe (S0-01..S0-11) → ADR-0001 | Anirudh |
| D-04 | LLM for summaries | Evaluation in S3-05 → ADR-0007; Gemini Flash is a candidate | Anirudh |
| D-05 | Consent notice default mode | Proposed One click (used in DESIGN) — confirm | Both |
| D-06 | ✅ Closed 2026-10-29: Opus 24 kbps ([ADR-0003](docs/adr/0003-audio-transport-format.md), accepted) | Re-check with chosen provider in S1-11 | Anirudh |
| D-07 | Library surface in beta: extension page vs web app | ADR-0006 before beta | Gaurav |
| D-09 | Product name | "Minutes" is a working name | Both |
| D-10 | `me` lane follows Meet mute by default | Proposed On — confirm in M1 | Both |
| D-11 | Hinglish note markers (`faisla:`, `kaam:`, `sawaal:`, `zaroori:`) | Decide by M2 | Both |
| ADR-0002 | Remaining checks: #2 pgvector version, #5 pricing calculator, #4 Cloud Shell latency run, #1 live 2-hour test in S1-11 (all Anirudh) | Checks 3, 6 done; 1, 4 partly | as listed |
| ADR-0003 / 0004 / 0005 | Accepted 2026-10-29; run their verification items in Stage 1 | Accepted | Anirudh |

---

## 6. Key research findings (and corrections)

Facts learned so far that change how we build. Full sources in STT_PREFLIGHT.md and the ADRs.

| Topic | Finding |
|---|---|
| Sarvam | `translit` mode outputs Roman script; `codemix` gives mixed script; streaming interim text is not transliterated; diarization batch only; ₹0.49/min; trains on API data by default (opt out) |
| Deepgram | Nova-3 uses `keyterm` (500-token limit); mid-stream updates via a `Configure` message; closes after ~10 s without audio (send KeepAlive); Hindi inside `multi` code-switching is unclear — test 3 configurations |
| Gemini | `gemini-3.5-transcribe-live`: 10-minute sessions, no diarization, no word timestamps; batch model has diarization (≤ 30 min with diarization); free tier may train and be human-reviewed; Gemini 3.8 Flash price doubles from 1 Jan 2027 |
| Cloud Run | WebSockets limited to 60 minutes per connection; affinity is best effort → our resume/replay protocol handles it |
| Hosting | Supabase has a Mumbai region; Railway and Render appear to have no India region |
| Chrome MV3 | Tab capture mutes the tab unless audio is played back; offscreen documents cannot prompt for mic permission |
| **Corrections** | Deepgram `Configure` message *does* exist (earlier claim was wrong); Sarvam price is ₹0.49/min, not ₹1.5/min; Gemini free tier is not usable even for consented benchmark audio |
| Early blueprint file | Swift sample uses a wrong protocol name, Deepgram sample uses wrong parameters, FFmpeg/fMP4 sections contradict, DSP pipeline over-processes audio — do not copy its code |

---

## 7. What happens next

Full status table: IMPLEMENTATION_PLAN.md → "Stage 0 status". **All of Stage 0 is Anirudh's.**

1. S0-02 provider setup (PREFLIGHT_RUNBOOK): Sarvam opt-out + top-up, Deepgram, billing-enabled
   Gemini project, keys.
2. Smoke-test the benchmark tools on one short synthetic clip per provider; fix `[Verify]` items.
3. S0-01 recordings with consent (participants still needed — 2 to 6 people per clip).
4. S0-04/S0-05 references for all 20 clips + self-consistency check.
5. S0-09 Phases A–G → S0-10 ratings → S0-11 ADR-0001.
6. ADR-0002 checks #4, #5 (ADR-0003/0004/0005 accepted 2026-10-29).
7. Give Gaurav collaborator access; Stage 1 (e.g. S1-01) can run in parallel.

## 8. Conventions for this file

- Keep it short: summaries and links, not copies of other documents.
- When a decision changes, edit §4 or §5 **and** the source document in the same PR.
- Dates as `YYYY-MM-DD`. Use names (Anirudh, Gaurav), not "I" or "you".
- Agents: read this file at the start of a session; before ending a session that changed anything,
  add a §9 entry and update "Last updated".

---

## 9. Session log

Newest first. One entry per working session (either person).

### 2026-10-29 — Anirudh (Claude Code): Stage 0 continued
**Done**
- Synthetic smoke-test data (macOS TTS voices Rishi, Lekha, Aman — no real people, safe on any API
  tier): `~/meetyou-benchmark-data/smoke` with 2 lanes, references, manifest, `runs.smoke.json`.
- CLI end-to-end tests (`score` on batch + stream outputs; data-use guard refusal). 95 tests total.
- ADR-0002 check 2 done (pgvector 0.8.5 on PostgreSQL 13+); check 5 estimated: production ≈
  $160–260/month, staging ≈ $40–80/month (higher than the first guess of $60–130).

**Blocked on Anirudh's console actions:** no vendor keys set yet (S0-02), so no live smoke run.

### 2026-10-28 (later) — Anirudh (Claude Code): Stage 0 build
**Done** (branch `feature/stage-0`)
- S0-15 workspace + CI; S0-16 `shared/contracts`; S0-17 `shared/design-tokens` (WCAG checks pass in
  light and dark); S0-06/07/08 `tools/stt-benchmark` (batch runner, streaming harness, normalizer,
  scorer, blind samples, latency probe). `pnpm check` green: 93 tests.
- S0-03 annotation guideline + canonical Hinglish list; S0-01/02/10 kits (consent form, topic cards,
  recording guide, metadata sheet, pre-flight runbook); ADR-0001 template; ADR-0004 and ADR-0005
  (proposed); ADR-0002 checks updated; S0-18 legal drafts.
- Vendor formats verified from docs: Sarvam realtime WS + batch SDK, Deepgram listen WS/REST,
  Gemini Live setup + Interactions API. Latency from India laptop: Sarvam ~70–90 ms, Gemini ~40 ms,
  Deepgram ~510–610 ms TLS.

**Not done (needs people/accounts):** recordings and consent, vendor console actions and keys,
annotation, live benchmark runs, ratings, ADR-0001 decision, pricing calculator, Cloud Shell latency.

**Notes for Gaurav**
- Start with `docs/benchmark/PREFLIGHT_RUNBOOK.md`, then `RECORDING_GUIDE.md`.
- The benchmark tools have only been unit-tested; the first live run may surface `[Verify]` issues.

### 2026-10-28 — Anirudh (Claude Code)
**Done**
- Reviewed two external research reports (market report and "master blueprint"); recorded errors.
- Agreed scope: Meet first, Chrome extension, bot-free, audio only, two lanes, extensible core.
- Researched how competitors capture Meet audio (bot, extension audio, caption scraping, desktop).
- Wrote AGENTS.md (+ CLAUDE.md import), PRD, FEATURES, ARCHITECTURE, DESIGN (from the design
  handoff), IMPLEMENTATION_PLAN, STT benchmark plan, STT pre-flight research, ADR-0002 and ADR index.
- Decided D-01 (Roman), D-02 (7 days), D-08 (Google Cloud Mumbai).
- Aligned PRD/ARCHITECTURE with DESIGN (action items, processing progress, delete grace, glossary,
  consent ack, notifications permission, M1 questions).
- Created the GitHub repo content; pushed `anirudh` and `main`.

**Open / next**
- Stage 0 tasks per §7; open decisions per §5.

**Notes for Gaurav**
- Start from AGENTS.md → this file → IMPLEMENTATION_PLAN.md §1 (your areas) and Stage 0 tasks.
- Do not provision infrastructure until ADR-0002 is Accepted.
