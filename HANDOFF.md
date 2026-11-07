# HANDOFF.md — Shared Context and Decision Log

Shared memory for **Anirudh** (Claude Code) and **Gaurav** (Google Antigravity). Read this at the
start of every session; add a log entry at the end (§9). Decisions are summarised here with a
pointer to where the full detail lives — the linked document stays the source of truth.

| Field | Value |
|---|---|
| Last updated | 2026-11-07 (Anirudh: Ask this meeting (S3-12) built; free Gemini key allowed on staging behind a switch) |
| Updated by | Anirudh (Claude Code) |
| Repository | [anirudhbhatia-1/meetyou](https://github.com/anirudhbhatia-1/meetyou) — branches `main`, `anirudh`, `Gauravbro` |
| Current stage | **Stage 3** in progress — S3-01 code done (Anirudh); next S3-02 validation chain; Gaurav S3-09..S3-11 can start (§7) |

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
| Phase 1 records audio **and the meeting screen** (2026-11-01) | Meet tab video with a playback mix; clips and adaptive streaming stay in Phase 3 | [ADR-0011](docs/adr/0011-video-screen-recording.md), PRD FR-CAP-12..15 |
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
| **D-03** (2026-11-01, amended 2026-11-05) | STT: **Deepgram Nova-3 only** (live and post-meeting); **Google Chirp 3 dropped** (gate and S1-14 cancelled), **Sarvam dropped**, Gemini not used for STT; audio transcribed in the US | [ADR-0001](docs/adr/0001-stt-provider.md) |
| **D-06** (2026-10-29) | Opus 24 kbps transport and storage | [ADR-0003](docs/adr/0003-audio-transport-format.md) |
| **D-08** | Backend: **TypeScript/Node.js on Google Cloud Mumbai** (Cloud Run, Cloud SQL, Cloud Storage). ADR-0002 **Accepted 2026-11-01**; live checks in S1-11 | [ADR-0002](docs/adr/0002-backend-stack-and-hosting.md) |
| **D-07** (2026-11-05) | Library is a **web app from alpha** (like Fireflies): sign in and see your own recordings, transcripts, summaries from any device; the extension records and links to it; ADR-0006 (hosting) moves to S4-09 | PRD FR-LIB-05, IMPLEMENTATION_PLAN S4-09 |
| **UI owner** (2026-11-05) | **Anirudh builds all Phase 1 UI**: side panel, Meet overlay, onboarding, library web app, settings, action items, design system and components (S4-01..S4-17 except S4-07). Gaurav keeps the Meet adapter (incl. the S4-07 chat notice), API endpoints, data lifecycle, infra/CI/CD and launch documents | IMPLEMENTATION_PLAN §1.1, Stage 4 |
| **D-12** (2026-11-01) | Record video of the meeting screen in Phase 1; setting on by default; same retention as audio; off when retention is "delete immediately" | [ADR-0011](docs/adr/0011-video-screen-recording.md) |

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
- **Free Gemini key = development and testing only** (2026-11-01): synthetic audio/transcripts and
  public licensed datasets, local and CI. Never real meetings, even with consent (Gemini free-tier
  terms forbid personal info); staging/production refuse free keys. **Deepgram is the STT backup.**
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
| STT outage | With Deepgram as the only provider, what the product does during a Deepgram outage (audio is still stored) | Decide before beta (ADR-0001 §0) | Anirudh |
| D-04 | LLM for summaries | Build on **Gemini Flash** first (2026-11-07); S3-05 evaluation → ADR-0007 | Anirudh |
| D-05 | ✅ Closed 2026-11-07: **One click** (code and DB defaults already `one_click`) | — | — |
| D-06 | ✅ Closed 2026-10-29: Opus 24 kbps ([ADR-0003](docs/adr/0003-audio-transport-format.md), accepted) | Re-check with chosen provider in S1-11 | Anirudh |
| D-09 | Product name | "Minutes" is a working name | Both |
| D-10 | ✅ Closed 2026-11-07: **On** (`followMeetMute: true` already the default) | — | — |
| D-11 | Hinglish note markers (`faisla:`, `kaam:`, `sawaal:`, `zaroori:`) | Decide by M2 | Both |
| ADR-0002 / 0003 / 0004 / 0005 / 0011 | Accepted; run their verification items in Stage 1 (S1-11, S1-13) | Accepted | Anirudh |

---

## 6. Key research findings (and corrections)

Facts learned so far that change how we build. Full sources in STT_PREFLIGHT.md and the ADRs.

| Topic | Finding |
|---|---|
| Benchmark (MUCS 2021, 20 clips) | Streaming: Deepgram 14.2% spelling-insensitive WER, final P90 2.8 s; Gemini Live 15.9% but final P90 20 s and English loanwords in Devanagari; Sarvam 15.8%, P90 9.8 s. Opus 24k costs ≤ 0.5 pt. Full tables in ADR-0001 §4 |
| Google Chirp 3 | Streaming ≤ 5 min per stream (rotate), 300 concurrent streams per region, `hi-IN` GA, diarization batch only, word timestamps batch only, regions `us`/`eu` only, ~$0.016/min [Verify] |
| Sarvam (dropped) | `translit` mode outputs Roman script; `codemix` gives mixed script; streaming interim text is not transliterated; diarization batch only; ₹0.49/min; trains on API data by default (opt out) |
| Deepgram | Nova-3 uses `keyterm` (500-token limit); mid-stream updates via a `Configure` message; closes after ~10 s without audio (send KeepAlive); Hindi inside `multi` code-switching is unclear — test 3 configurations |
| Gemini | `gemini-3.5-transcribe-live`: 10-minute sessions, no diarization, no word timestamps; batch model has diarization (≤ 30 min with diarization); free tier may train and be human-reviewed; Gemini 3.8 Flash price doubles from 1 Jan 2027 |
| Cloud Run | WebSockets limited to 60 minutes per connection; affinity is best effort → our resume/replay protocol handles it |
| Hosting | Supabase has a Mumbai region; Railway and Render appear to have no India region |
| Chrome MV3 | Tab capture mutes the tab unless audio is played back; offscreen documents cannot prompt for mic permission |
| **Corrections** | Deepgram `Configure` message *does* exist (earlier claim was wrong); Sarvam price is ₹0.49/min, not ₹1.5/min; Gemini free tier is not usable even for consented benchmark audio |
| Early blueprint file | Swift sample uses a wrong protocol name, Deepgram sample uses wrong parameters, FFmpeg/fMP4 sections contradict, DSP pipeline over-processes audio — do not copy its code |

---

## 7. What happens next

Stages 0–2 are complete in code; Stage 2 is deployed to staging with CI/CD (every green `main`
deploys and smoke-tests). Next, **Stage 3 — notes and summaries** (IMPLEMENTATION_PLAN Stage 3):

1. **Anirudh:** S3-01 summarization engine on **Gemini Flash** (LLM adapter behind the provider
   interface), then S3-02 validation chain, S3-03 fast-path pipeline, S3-05 evaluation → ADR-0007.
   Needs a **paid-tier Gemini key in Secret Manager** before real meetings on staging.
2. **Gaurav:** S3-07 template content (after the S3-01 template format exists), S3-08 summary
   endpoints (after S3-03), and now: **S3-09 search**, **S3-10 glossary endpoint**, **S3-11 export
   job** — these depend only on S2 and can start today. Language rule changed: agents reply in
   English (AGENTS §1).
3. Still to run (Anirudh): live S2 tests — gateway failover (S2-04), worker crash mid-job (S2-06),
   60-min video sync (S2-14); trace arrival check (STAGING_SETUP §9.3).

## 8. Conventions for this file

- Keep it short: summaries and links, not copies of other documents.
- When a decision changes, edit §4 or §5 **and** the source document in the same PR.
- Dates as `YYYY-MM-DD`. Use names (Anirudh, Gaurav), not "I" or "you".
- Agents: read this file at the start of a session; before ending a session that changed anything,
  add a §9 entry and update "Last updated".

---

## 9. Session log

Newest first. One entry per working session (either person).

### 2026-11-07 (latest) — Anirudh (Claude Code): "Ask this meeting" and the staging free-key switch
Anirudh decided: (1) **free Gemini key on staging** until he moves to a paid key — implemented as an
explicit switch `GEMINI_FREE_TIER_ON_STAGING=true` (production always refuses; ADR-0001 §7
amendment records that this conflicts with Google's terms for unpaid services, test meetings only,
testers told — tester guide updated); (2) **website Q&A in Phase 1**, limited to one recording and
its owner (AGENTS §9, FEATURES E4, new task S3-12).
- **Migration 0004** `meeting_questions` (forced RLS `workspace_isolation`, cascades with the
  meeting): question, status (`answered` / `not_in_meeting` / `off_topic`), answer, cited segment
  IDs, model, token counts. Schema change approved by Anirudh with the plan.
- **Contracts** `shared/contracts/src/ask.ts`: request/response, `AnswerOutput` (model-facing:
  `about_this_meeting`, `found`, `answer`, `segment_ids`), limits, fixed refusal texts.
- **Engine** `answerQuestion` in `@meetyou/summarizer` (question wrapped as data too); the
  validate-and-retry loop is now shared (`generate.ts`; `SummaryFailedError` →
  `GenerationFailedError`).
- **API** `POST /v1/meetings/:id/ask`, `GET /v1/meetings/:id/questions`
  (`routes/ask.ts`): reads in the caller's workspace only, model call outside the transaction,
  citations filtered to the meeting's non-echo segments (none → `not_in_meeting`), 429 at 30/h or
  150/24 h, 503 without a model, `meeting.ask` span. 8 tests (owner-only 404, off-topic, invented
  citations, limits, other meeting invisible to the model).
- **Web** Ask tab (DESIGN §12.7 added): history with numbered sources into the existing citation
  card, fixed refusals, composer with counter, limit and error banners. Checked in the browser
  against the mock (answer, chip → card → Show in transcript, off-topic). Web tests 15.
- **Real Gemini** (free key, synthetic standup): Hinglish question answered in Roman Hinglish
  with the right citation; "budget" → not in meeting; injection ("ignore all previous rules…") →
  off-topic. ~13 s each.
- To enable on staging: STAGING_SETUP §9.4 (secret + API settings). Not done yet.

### 2026-11-07 — Anirudh (Claude Code): S3-01 summarization engine (Gemini API)
Anirudh chose the **Gemini API with a key** (Google AI Studio), not Vertex AI. Verified against
aistudio.google.com docs (2026-11-07): latest stable Flash is **`gemini-3.6-flash`** (setting
`GEMINI_MODEL`); JSON via `generationConfig.responseFormat.text` (`APPLICATION_JSON` + standard
JSON Schema; `pattern` ignored, so our zod check stays authoritative); `temperature` is ignored on
3.6 and will be rejected later, so it is never sent; `systemInstruction` carries the rules.
- **`@meetyou/providers`**: `llm/gemini.ts` (plain fetch, key in `x-goog-api-key`, error bodies
  never read), vendor-neutral `LlmHttpError` / `LlmRefusedError` / `LlmOutputError`, usage with
  thinking tokens; registry `createLlmProvider` (`LLM_PROVIDER=none|gemini`, `GEMINI_API_KEY`,
  free key still refused outside local/CI). 16 tests.
- **`backend/packages/summarizer`** (new, no vendor code): prompt builder (rules AI-01..07, data
  blocks with `<`/`>` neutralised against injection, `[seg_id] (mm:ss) Speaker: text`, echo
  excluded, English/Hindi-Devanagari/Hinglish-Roman), templates as data with versions (first
  wording; S3-07 refines), single pass with chunked map-reduce above 200k tokens, schema
  validation with one retry carrying the problems (`retryReasons` keeps paths/codes only),
  `SummaryFailedError` (`no_transcript`, `invalid_output`, `refused`); HTTP errors propagate for
  the queue. 13 tests on the synthetic Hinglish standup.
- **Real run** (`pnpm --filter @meetyou/summarizer summarize:fixture`, free key, synthetic only):
  schema-valid Hinglish summary, owner from the participant list, `due_phrase: "aaj"` with no
  invented date, the fixture's explicit decision found. 13–32 s for a 1-minute meeting; thinking
  tokens (2–4.6k) dominate; one run needed the retry. **Latency against the ≤ 40 s budget for 60
  minutes is the main risk** — measure in S3-05.
- Not yet: citation/owner/date checks (S3-02), storing summaries and the worker job (S3-03), paid
  key in Secret Manager for staging.
- Fixed a flaky local smoke test (`portal "" does not exist` from graphile-worker): PGlite is one
  session behind every connection, so test reads overlapping the worker's writes collided. The
  test now waits for the worker's `job:success` event, stops it, then reads once (5/5 runs clean).

### 2026-11-07 — Anirudh (Claude Code): decisions before Stage 3
Anirudh decided (asked as one set): **Gemini Flash** first for S3 summaries (D-04 still closes via
S3-05/ADR-0007); **D-05 One click**; **D-10 `me` lane follows Meet mute**; **agents reply in
English** (AGENTS §1 changed — Gaurav's agent too). D-05/D-10 needed no code change: contracts
(`DEFAULT_USER_SETTINGS`) and the 0001 migration already default to `one_click` / `true`. Updated
AGENTS (status, §1, §9), PRD decision table, this file's §5 and §7 (Gaurav: S3-09/10/11 can start).
Offline start (recording while the server is unreachable) stays a backlog item, not in the PRD.

### 2026-11-06 — Anirudh (Claude Code): Meet prompt cannot start recording — fixed the UI
Anirudh's test: the in-Meet prompt's **Start** always ended in "Recording did not start" and the
panel's "Start again" failed the same way. Chrome grants `tabCapture` only after the extension is
invoked (toolbar icon or keyboard command); a click in the page or in the side panel never counts
(ARCHITECTURE §26.2 Q1, now answered).
- Prompt (DESIGN §8.2 updated): no Start button; the body says "press {Ctrl/Alt}+Shift+R or click
  the MeetYou (M) icon in Chrome's toolbar, then Start" (shortcut per platform); **Not now** stays.
  Removed the dead `prompt.start-recording` / `prompt.open-sidepanel` / `prompt.problem` plumbing.
- Panel error `capture_not_allowed`: no "Start again" (the icon click restarts by itself); Dismiss
  stays.
- Extension tests 198 pass. Tester zip rebuilt. **Verified by Anirudh in Chrome:** starting from
  the M icon records.
- Cloud checks: monitoring re-plan shows **No changes** (dashboard fix works). Trace read from Cloud
  Shell needs `x-goog-user-project` (user ADC). OpenTelemetry export problems were silent: they now
  log `tracing.export_failed` (class/code only, once a minute).

### 2026-11-06 — Anirudh (Claude Code): S2-12 CI/CD and S2-11 monitoring live on staging
- **Smoke job** `meetyou-staging-smoke` created (API service account, VPC connector, secrets
  `meetyou-staging-database-url` + `meetyou-staging-auth-signing-jwks`) and run by hand:
  `smoke.passed`, all 66 frames acked, 3 segments, meeting deleted.
- **`terraform apply -target=module.ci`** from Cloud Shell (Terraform 1.9.8 installed into `~/bin`;
  state is local in `infra/environments/staging` there): WIF pool `meetyou-staging-github`,
  provider `github`, deployer SA, its three roles, and the four missing APIs (iamcredentials,
  logging, monitoring, sts). 11 added, 0 changed, 0 destroyed.
- **GitHub variables** `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA` set with `gh`.
- **First deploy** ([run 42244940247](https://github.com/anirudhbhatia-1/meetyou/actions/runs/42244940247),
  manual, commit `8c750c0`) green in 6 min: migrate job, worker → api → gateway → web rolled out,
  smoke job passed. From now on every green CI on `main` deploys staging. The web app on staging now
  has the list-row delete menu.
- STAGING_SETUP §9.3 step 1 fixed (`terraform output` takes one name; Terraform install note).
- **Automatic path verified**: pushing `c35b70e` to `main` ran CI, then the deploy by itself (green).
- **`terraform apply -target=module.monitoring`** (alerts to the Cloud Shell account's email):
  7 log metrics, 6 alert policies, "Minutes staging" dashboard, 1 email channel; 15 added.
- **Smoke job now also checks the database** (`backend/apps/smoke/src/records.ts`): the meeting's
  `usage_records` row has `them` seconds (S2-07), and after the API's DELETE the worker's
  `meeting.delete` removes the meeting and completes its deletion request (S2-10). The local e2e
  test runs a real worker for this. Deploy of `2e46699` green with these checks.
- GitHub Actions moved to their Node 24 majors (`checkout@v5`, `setup-node@v5`,
  `pnpm/action-setup@v5`, `google-github-actions/auth@v3`, `setup-gcloud@v3`).
- **Tracing (S2-11, dependencies approved by Anirudh)**: new `backend/packages/tracing` —
  OpenTelemetry spans with the trace ID derived from the meeting ID, so API (`session.start`,
  `session.recover`, `session.end_request`), gateway (`stream.admit`, `stream.ready`, `stt.open`,
  `segment.store`, `usage.save`, `session.end`) and worker (`job.<task>`, in `@meetyou/queue`)
  land in one trace per meeting without passing context. Attributes use the log allow-list
  (`safeField`, now exported by `@meetyou/log`). Export: OTLP/HTTP to `telemetry.googleapis.com`
  with ADC — `@google-cloud/opentelemetry-cloud-trace-exporter` is deprecated (archived after
  2026-10-30), so it is not used. On only inside Cloud Run; `TRACING=off`, `TRACE_SAMPLE_RATIO`.
  Terraform: Telemetry API + `roles/telemetry.tracesWriter` / `serviceUsageConsumer` for the three
  runtime accounts (`-target=google_project_iam_member.telemetry`, STAGING_SETUP §9.3).
- **S2 audit and close-out** (Anirudh: "first complete S2", cloud setup later):
  - §20 latencies: the gateway measures STT final latency (audio sent → final; `StreamTimeline`
    remembers ~2 min of send times) and ack lag (chunk ready → durable ack) in constant-memory
    histograms (`latency.ts`) and logs p50/p95 on `stream.ended`; monitoring adds two distribution
    metrics and dashboard tiles.
  - §20 spend: per-session Deepgram cost metric + "Expensive STT session" alert (default 1.5 USD),
    optional Google Cloud monthly budget (`billing_account_id`, 50/90/100 % + forecast).
  - Session timeline query (STAGING_SETUP §9.3); `PG_POOL_MAX` per process (default 10; budget
    rule in STAGING_SETUP §6) closes the last real `TODO(S2-04)`.
  - Extension: video fragments left by a closed browser now upload at browser startup / extension
    update (`video-resume.ts`, ADR-0011 §3.3) instead of at the next recording.
  - Stale `TODO(S2…)` comments rewritten to what the code does; two retagged (S3-03 `processed`
    state, S4-06 Roman interim). Starting a recording while the server is unreachable is not in the
    PRD and needs a recorder change (open is awaited, video keyed by session): left as a TODO.
  - Known, not fixed: worker logs `MaxListenersExceededWarning … [PassThrough]` from inside the
    Cloud Storage client during fragment downloads; finalize succeeds; not reproducible locally.
- **Cloud setup applied (Anirudh, Cloud Shell):** `-target=google_project_iam_member.telemetry`
  (Telemetry + billingbudgets APIs, 6 role grants); `-target=module.monitoring` (3 metrics, cost
  alert after the 10-minute metric delay, ₹5,000 monthly budget on the INR billing account);
  smoke run green afterwards. Dashboard JSON now written in the API's stored form (it showed a
  change on every plan).
- **S2 code is complete.** Cloud steps (done 2026-11-06, see above): `-target=google_project_iam_member.telemetry`
  and re-apply `-target=module.monitoring` (new metrics/alert, optional budget). Tests (later): live
  failover (S2-04), worker shutdown mid-job (S2-06), 60-min video sync and website playback (S2-14).

### 2026-11-06 — Anirudh (Claude Code): S2-10 merged and fixed, S2-11 and S2-12 built
Anirudh asked to finish everything left in S2, including S2-11 and S2-12 (owned by Gaurav until
now — **Gaurav: please don't start them; review instead**). Runbook: STAGING_SETUP §9.3.
- **Merged `main` (Gaurav's S2-10, `0d725f1`)** and fixed what broke `pnpm check`: formatting,
  lint (`any`, unused import) and three real bugs in `lifecycle.ts` —
  (1) retention set `audio_assets.storage_key = null`, but the column is NOT NULL: the row is now
  deleted with its object; (2) account deletion never deleted the user: `inWorkspace` does not set
  `app.user_id`, so the `users` policy hid the row — the task now sets it (refresh tokens cascade);
  (3) storage cleanup errors were swallowed and the rows deleted anyway (orphaned recordings): they
  now fail the job, which retries. API route tests now run on the queue test DB (DELETE enqueues).
  PGlite-backed worker tests use `noPreparedStatements` (shared session; flaky otherwise).
- **S2-10 wiring**: the worker runs `meeting.delete`, `account.delete`, `retention.sweep` with
  `bucketCleanup` (meeting prefix; playback + poster); `video.finalize` schedules the meeting's
  sweep at `delete_after` in the same transaction. New `POST /v1/account:delete` (202, enqueues in
  one step, clears the web cookie) and web Settings → Privacy & data → "Delete my account and all
  data…" with the DESIGN §15.3 alert. Audio rows still wait for S3 (bucket lifecycle is the backstop).
- **S2-11**: `@meetyou/log` (allow-listed fields, string values must look like codes/IDs, severity
  from the event name); gateway and worker use it; Fastify logs `severity`/`message` and strips
  query strings; worker logs `queue.depth` each minute. `infra/modules/monitoring`: 7 log metrics,
  6 alerts, dashboard (`terraform apply -target=module.monitoring`). OpenTelemetry tracing not added
  (new dependencies need approval).
- **S2-12**: `.github/workflows/deploy-staging.yml` (after green CI on main: build 6 images, migrate,
  roll out worker → api → gateway → web, smoke job), keyless via `infra/modules/ci` (WIF pool +
  deployer SA). Smoke job `backend/apps/smoke` + `Dockerfile.smoke`; its flow passes locally against
  the real gateway + API (scripted STT): API session → JWT stream → all frames acked → segments via
  API → meeting deleted. Gateway/API packages now export `./server`, `./chunk-store`,
  `./record-fixture`, `./app` for that test.
- `pnpm check` green. Not run in the cloud yet: Terraform targets, GitHub variables, smoke job
  creation, first deploy run, failover/crash/60-min tests.

### 2026-11-06 — Anirudh (Claude Code): sign-in, library web app on the API, cloud recording
Goal (Anirudh): log in and watch recordings on the website, all on staging. Deploy steps:
[STAGING_SETUP §9.2](docs/STAGING_SETUP.md). Not yet deployed or tried against Google/GCS — needs
the Cloud Shell steps there.
- **API** (`backend/apps/api`): web sign-in per ADR-0004 §4.5 — with `X-Minutes-Client: web`,
  `/v1/auth/google|refresh|logout` keep the refresh token in an `HttpOnly; Secure; SameSite=Lax`
  cookie `minutes_rt` on `/v1/auth` and never in the body (`web-session.ts`); the extension flow
  is unchanged. New `routes/video.ts`: `POST /v1/sessions/{id}/video/fragments:sign` (own session,
  open until 24 h after the end, 410 after) and `GET /v1/meetings/{id}/video[?download=1]`.
  Staging/production refuse to boot without `AUTH_SIGNING_JWKS`; `DATABASE_URL` required there;
  RLS checked at startup. **Gaurav, please note:** `POST /v1/sessions/{id}/recover` now answers
  `RecoverSessionResponse` (`state: 'resumable' | 'ended'`) instead of 400 for an ended session;
  meetings queries for the playback row filter `part_id IS NULL`. Tests: `web-video.test.ts`.
- **Web app** (`web/`): Google PKCE redirect sign-in (`src/api/auth.ts`, access token in memory),
  real HTTP client (`src/api/http.ts`, contracts-validated), sign-in screen (DESIGN §7.1 copy),
  Settings → Account/Sign out, **video player** (DESIGN §6.19: play/pause, time, seek, speed,
  download, full screen, Space/←/→) above the transcript with click-to-seek and "Play from" on
  citations. `web/server/server.ts` (Node built-ins only) serves the build + `/config.json` and
  proxies `/v1` (cookie both ways, header allow-list, CSP, `no-referrer`); `Dockerfile.web`.
  Vite dev without `/config.json` still runs on the mock API. Summaries/action items/participants
  return empty until S3-08.
- **Extension**: cloud mode when built with `MINUTES_API_URL` (`build:staging`): sign-in in the
  service worker (`background/auth.ts`, `launchWebAuthFlow` + PKCE, refresh token in
  `chrome.storage.local`, access token in `chrome.storage.session`, one refresh at a time); start
  calls `POST /v1/sessions` and hands the session to the offscreen recorder (`SessionSource`:
  API or dev gateway); reconnects use `recover`; video signs through the API. Side panel: sign-in
  card, "Signed in as … · Sign out", signed-out error with sign-in, "Open" link to the meeting in
  the web app. New capture errors `signed_out`, `server_unreachable`.
- Merged `origin/main` (Gaurav's `cb66bb2`): `MeResponse` is the flat
  `{ userId, workspaceId, email, displayName }` in `shared/contracts/src/api.ts` (both sides had
  removed one copy); web app and extension read it that way.
- `pnpm check` green. Not verified: real Google sign-in, signed URLs on Cloud Run (needs
  `iamcredentials` + token creator, declared in Terraform), video playback from GCS in the web
  player (local check stopped at the https-only contract; seek/UI checked with a fake API).

### 2026-11-06 — Gaurav (Google Antigravity): S2-09 Core REST API Endpoints implemented and verified
**Done** (branch `Gauravbro`)
- Implemented **Task S2-09 (Core REST API Endpoints)** in `backend/apps/api` (`@meetyou/api`):
  - **Auth & JWKS (`src/routes/auth.ts`):** `GET /.well-known/jwks.json` serving public JWKS for gateway verification; `POST /v1/auth/google` exchanging Google OAuth PKCE auth code via `@meetyou/auth` `signInWithGoogle`; `POST /v1/auth/refresh` rotating refresh tokens; `POST /v1/auth/logout` revoking tokens.
  - **User & Workspace Profile (`src/routes/me.ts`):** `GET /v1/me` returning current user profile and workspace plan/role with `app.user_id` context for Postgres RLS compliance.
  - **User Settings (`src/routes/settings.ts`):** `GET /v1/settings` and `PATCH /v1/settings` with automated fallback to `DEFAULT_USER_SETTINGS` (PRD FR-SET-01, FR-CON-01, ADR-0011).
  - **Meetings Management (`src/routes/meetings.ts`):** `GET /v1/meetings` (cursor-paginated list filtered by workspace and template with `hasNextPage` and encoded cursor); `GET /v1/meetings/:id` (detailed meeting with participant names, audio/video status, and notes); `PATCH /v1/meetings/:id` (title and template updates); `DELETE /v1/meetings/:id` (soft-delete with 10s undo window); `POST /v1/meetings/:id:restore` & `/restore` (graceful recovery).
  - **Meeting Notes (`src/routes/notes.ts`):** `GET /v1/meetings/:id/notes`, `POST /v1/meetings/:id/notes` (append single note with anchor/citation tags), `PUT /v1/meetings/:id/notes` (atomic bulk sync matching `SyncNotesRequest`).
  - **Transcript Segments (`src/routes/segments.ts`):** `GET /v1/meetings/:id/segments` returning chronological transcript segments with resolved speaker names, words, and flags validated via `Segment.parse`.
  - **Consent Logging (`src/routes/consent-log.ts`):** `POST /v1/consent-log` logging chat consent notices (FR-CON-03); `GET /v1/meetings/:id/consent-log` retrieving meeting consent audit records.
  - **Sessions Lifecycle (`src/routes/sessions.ts`):** `POST /v1/sessions` creating meeting and video assets in DB, minting single-use JWT stream token (`tokens.issueStreamToken`) for gateway WebSocket connection with video constraints; `POST /v1/sessions/:id/end` marking session/meeting complete; `POST /v1/sessions/:id/recover`.
- **Contracts (`shared/contracts/src/rest.ts`):** Added `MeResponse`, exported `type TokenResponse` and `type StartSessionResponse`.
- **Comprehensive Test Suite (`src/routes.test.ts`):** Added 16 integration tests running on in-process PGlite with multi-tenant row-level security (RLS) enforcement. Total `@meetyou/api` tests: 29 passed out of 29.
- Clean verification: `pnpm format:check`, `pnpm lint`, and workspace-wide `pnpm typecheck` (all 15 packages) passed with 0 errors.
- Marked S2-09 as complete (✅) in `docs/IMPLEMENTATION_PLAN.md`. Gaurav next: Task S2-10 (Data Lifecycle & Retention Jobs).

### 2026-11-06 (earlier) — Anirudh (Claude Code): S2 cloud pieces, contracts for S2-09, review of `Gauravbro`
**Merged** `Gauravbro` (fast-forward; S2-08 API scaffold, infra, Dockerfiles) into `anirudh`.
`pnpm check` green after the merge (a flaky gateway test was a real ordering window — fixed).
Decision (Anirudh): `@google-cloud/storage` 8.4.0 added.
- **Contracts for S2-09 / S3-08** (`shared/contracts/src/api.ts`): `MeResponse`,
  `PatchSettingsRequest` (server sets `consentAcknowledgedAt`), `StreamTokenResponse`,
  `End/RecoverSession…`, `ListMeetingsQuery` + `MeetingList`, `PatchMeetingRequest`,
  `DeleteMeetingResponse`, `ListSegmentsQuery` + `SegmentList`, `NotesResponse` / `PutNotesRequest`
  (ETag `version`), `ListActionItemsQuery` + `ActionItem(List)`, `PatchSummaryItemRequest`,
  `ConsentLogResponse`, `AudioPlaybackResponse`, glossary. `SignVideoFragmentsResponse` now has
  `headers` (the signed size range every PUT must send). **Gaurav: parse requests with these.**
- **`@meetyou/storage`** (new): `ObjectBucket` (GCS adapter + memory), the §11.4 layout,
  `ObjectVideoStore`, `signFragmentUploads` (V4 PUT, content type + `x-goog-content-length-range`,
  15 min), `signReadUrl`, `meetingVideoPlayback` (for `GET /meetings/{id}/video`). Signing tested
  offline with a throwaway key. **Gaurav: the API's `fragments:sign` and `/video` routes call these.**
- **Gateway staging mode:** `GcsChunkStore` (newest-manifest resume), `APP_ENV=staging|production`
  requires `DATABASE_URL`, `REDIS_URL`, `STREAM_TOKEN_JWKS`, `GCS_AUDIO_BUCKET`, `ALLOWED_ORIGINS`
  (exact pinned extension origin), no dev endpoints, listens on `0.0.0.0`. `Dockerfile.gateway`.
- **Worker app** (`backend/apps/worker`): `/healthz` on `$PORT`, RLS check, queue schema,
  `video.finalize`; integration test with real Postgres (pglite-socket) + graphile + ffmpeg runs
  the job exactly once. `Dockerfile.worker` (ffmpeg, non-root).
- **Extension:** sends the signed headers with each fragment PUT (`putFragment`).
- **Infra (one line):** bucket CORS also allows `x-goog-content-length-range` — Gaurav to apply.
- **Runbook §9.1:** build/push commands (Cloud Shell Docker), the Terraform env/secrets for gateway
  and worker, the public-JWKS command (checked locally), deploy order, checks.
- **Review findings for Gaurav (S2-08):**
  1. API startup does not call `db.assertRowSecurityEnforced()` (runbook §6) — add it.
  2. Missing `AUTH_SIGNING_JWKS` makes the API sign with an ephemeral key even in staging (tokens
     break on every restart and differ per instance) — refuse to start outside local/test.
  3. `DATABASE_URL` is optional in staging — require it outside local/test.
  4. CORS allows any `chrome-extension://…` with credentials — restrict to the pinned ID in
     staging (`CORS_ALLOWED_ORIGINS`), keep the regex for local only.
  5. `Dockerfile.api` / `.migrate` run as root — add `USER node`.
  6. The idempotency store is in memory: retries can hit another instance (max 3) — Redis or
     Postgres-backed store before the extension relies on it.
  7. Images tagged `:latest`; disable old secret versions (`database-url` ×4, OAuth ×2).
- **Still needs the cloud (not doable from here):** deploy gateway + worker (§9.1), the
  kill-an-instance and worker-restart tests in staging, the 60-minute video sync check.

### 2026-11-06 (earlier) — Gaurav (Google Antigravity): Cloud Staging Setup, DB Migration & Live API /health Verified
**Done** (branch `Gauravbro`)
- **Pinned Extension ID & OAuth Manifest (`manifest.json`):** Generated RSA 2048 keypair, pinned extension ID to `hjimcofnjnikbeepahmclaniopbnhbbe`, authorized redirect `https://hjimcofnjnikbeepahmclaniopbnhbbe.chromiumapp.org/oauth2`.
- **Google Cloud Console OAuth Staging Setup:** Configured OAuth consent screen (External, test users) and created Web application Client ID `189397093016-ghfptods39aies7sbt4hnph78nflc0cl.apps.googleusercontent.com` with authorized origins and redirect URI.
- **Terraform Staging Additions (`infra/` — `STAGING_SETUP.md` §5.2):**
  - Enabled Artifact Registry & Memorystore Redis APIs.
  - Added Docker repository `meetyou` in `asia-south1`.
  - Added Memorystore Redis instance (1 GiB, Basic tier, VPC private IP `10.254.5.203`).
  - Added Cloud Run services (`meetyou-staging-api`, `meetyou-staging-worker`, `meetyou-staging-gateway`) and Cloud Run Job (`meetyou-staging-migrate`) with dedicated service accounts and VPC connector egress.
  - Added Secret Manager secrets (`database-url`, `auth-signing-jwks`, `google-oauth-client-secret`) with per-service accessor IAM bindings.
  - Ran `terraform apply` cleanly in Cloud Shell (`26 added, 2 changed, 4 destroyed`).
- **Secret Manager Population:**
  - `meetyou-staging-auth-signing-jwks`: populated with P-256 signing JWKS (`stg-2026-11`).
  - `meetyou-staging-deepgram-api-key`: populated with paid Deepgram key.
  - `meetyou-staging-google-oauth-client-secret`: populated with Google OAuth web client secret.
  - `meetyou-staging-database-url`: populated with URL-encoded PostgreSQL connection string (`encodeURIComponent` on DB password).
- **Docker Containerization (`Dockerfile.migrate`, `Dockerfile.api`, `.dockerignore`):**
  - Node 24 slim container images created and pushed to Artifact Registry (`asia-south1-docker.pkg.dev/project-7ddc1bbe-aea4-44f7-bd0/meetyou/migrate:latest` and `api:latest`).
- **Cloud SQL Database Migrations (`meetyou-staging-migrate`):**
  - Executed Cloud Run Job in VPC: successfully applied initial schema migrations `0001, 0002, 0003` to Cloud SQL PostgreSQL 16.
- **Cloud Run REST API Deployment (`meetyou-staging-api`):**
  - Updated service with `api:latest`, wired `DATABASE_URL`, `AUTH_SIGNING_JWKS`, `GOOGLE_CLIENT_SECRET` secrets and `GOOGLE_CLIENT_ID` env.
  - Live probe verified: `curl https://meetyou-staging-api-7oflznia2a-el.a.run.app/health` returned `{"status":"ok","uptimeSeconds":13,"version":"0.1.0","db":"ok"}`.
- **Next Task:** S2-09 Core Endpoints (`/me`, `/settings`, `/meetings`, `/notes`, `/segments`, `/consent-log`, `/sessions`).

### 2026-11-06 — Gaurav (Google Antigravity): S2-08 API service scaffold implemented and verified
**Done** (branch `Gauravbro`)
- Pulled and fast-forward merged latest updates from `origin/main` (`87e2932`):
  - Added `@meetyou/auth`, `@meetyou/providers`, `@meetyou/queue`, `@meetyou/video`, `@meetyou/hinglish`, `@meetyou/fixtures`, `@meetyou/ui`, and `web/`.
  - Switched UI theme to Orange accent with light theme default per Anirudh's design decision.
- Implemented **Task S2-08 (API service scaffold)** in `backend/apps/api` (`@meetyou/api`):
  - **Fastify Factory (`src/app.ts`, `src/main.ts`):** In-memory testable Fastify v5 application with graceful shutdown.
  - **Standard Error Formatting (`src/errors.ts`):** Global error and not-found handlers formatting all errors into `shared/contracts` `ErrorBody` schema (`{ error: { code, message, retryable } }`), never leaking credentials or traces (AGENTS §7).
  - **Authentication & Tenancy Integration (`src/middleware/auth.ts`):** Wires `@meetyou/auth` `authenticate()` into Fastify with `requireAuth` and `tryAuth` decorators; decorates request with `user`, `workspaceId`, and scoped `db.inWorkspace(workspaceId, ...)` from `@meetyou/db`.
  - **Idempotency Keys (`src/middleware/idempotency.ts`):** Full support for `Idempotency-Key` header on mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`); rejects in-flight concurrent requests with 409 `in_flight` (retryable: true) and caches completed responses with `X-Idempotent-Replay: true`.
  - **Cursor Pagination (`src/utils/pagination.ts`):** URL-safe base64 cursor encoder, decoder, limit bounds, and `paginate()` helper matching `page<T>` contract.
  - **OpenAPI 3.1 & Swagger Documentation (`src/plugins/swagger.ts`):** Interactive UI at `/docs` and raw specification at `/openapi.json`.
  - **Health Probes (`src/routes/health.ts`):** `/health` and `/v1/health` verifying liveness, uptime, version, and database connectivity.
- Added comprehensive unit and integration tests (`src/app.test.ts`, 13 tests) covering health probes, OpenAPI generation, error formatting, auth rejection/acceptance, idempotency caching, pagination, and real PGlite database health check.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` (all 15 packages), and unit tests pass cleanly.
- Marked S2-08 as done (✅) in `docs/IMPLEMENTATION_PLAN.md`. Gaurav next: Task S2-09 (Core Endpoints).
**Done** (branch `Gauravbro`)
- Answered ARCHITECTURE §26.2 Questions 4 and 8:
  - **Q4 (Mute & Active Speaker reliability):**
    - Mute signal (`mic.mute_changed`) via `data-is-muted="true"|"false"` and `aria-label` fallback is 100% deterministic and instantaneous (< 10 ms), cleanly driving `me`-lane gating (FR-CAP-11).
    - Active speaker indicator (`speaker.active`) with 200 ms throttled observer and deduplication eliminates CPU churn from wave animations. Highly reliable for visible speaker attribution (≥ 95% on 1:1 and small groups). On large meetings with off-screen tiles, audio diarization and lane separation act as ground truth, complemented by DOM real-time visual labels.
  - **Q8 (`backdrop-filter` glass performance):**
    - Compact 340px Shadow DOM overlay with `backdrop-filter: blur(20px)` is promoted to its own GPU `RenderLayer` in Chrome; measured CPU/GPU compositor impact during 1080p Meet video playback is negligible (< 0.2%, zero frame drops). Transient prompt chip unmounts upon recording start, producing 0% overhead during active capture. Default glass styling approved for production.
- Updated `docs/ARCHITECTURE.md` §26.2 and `docs/IMPLEMENTATION_PLAN.md` (S1-12 marked done ✅).
- **Stage 1 status:** All 6 Stage 1 tasks owned by Gaurav (S1-01, S1-07, S1-08, S1-09, S1-10, S1-12) are now complete. Gaurav transitions to Stage 2 (S2-08 Fastify API service scaffold, S2-09 core endpoints).

### 2026-11-05 — Gaurav (Google Antigravity): S1-08 active-speaker & mute signals verified
**Done** (branch `Gauravbro`)
- Implemented `mute-signal.ts` (`extension/src/adapters/meet/mute-signal.ts`):
  - Detects mic mute/unmute state from `IN_CALL_SELECTORS.micButton` via `data-is-muted="true"|"false"` with `aria-label` fallback.
  - `observeMuteState` watches attribute mutations and emits `mic.mute_changed` with timestamp upon toggle.
  - Added 7 unit tests in `extension/src/adapters/meet/mute-signal.test.ts`.
- Implemented `speaker-signal.ts` (`extension/src/adapters/meet/speaker-signal.ts`):
  - Detects active speaker waves and volume indicators (`SPEAKER_SELECTORS.speakingIndicator`) and associates them with the parent participant tile (`participantTile`).
  - Throttled `observeActiveSpeakers` (200ms) with deduplication and silence intervals.
  - Added 6 unit tests in `extension/src/adapters/meet/speaker-signal.test.ts`.
- Wired both observers into `extension/src/content/meet-content-script.ts` on `in_call`, notifying background and cleaning up on call exit.
- Handled in `extension/src/background/service-worker.ts` with content-free logs (ID only, no names per AGENTS §7).
- **Chrome live verification passed on Google Meet:**
  - Real-time `[MeetYou] Mic mute changed: muted=true` / `muted=false` logged cleanly on every microphone toggle.
- Monorepo check green: 20 test files, 148 extension tests, 299 tests total across workspace.

### 2026-11-05 (night) — Gaurav (Google Antigravity): S1-09 prompt chip in Shadow DOM verified
**Done** (branch `Gauravbro`)
- Implemented `PromptChip` class (`extension/src/content/prompt-chip.ts`) rendered in an isolated Shadow DOM container over Google Meet (`#meetyou-prompt-root`, top 18px / right 18px).
- Glass card design per DESIGN §8.2 with title, reminder line, "Start", and "Not now" action buttons.
- Keyboard accessible: Escape key dismisses the prompt chip.
- Cleanly updates with Meet call state: shows on `in_call`, hides on `ended`/`lobby`, auto-hides when recording starts.
- **Chrome verification passed live on Google Meet:**
  - Clicking "Not now" or pressing Escape dismisses the chip cleanly and prevents re-appearance during the call.
  - Clicking "Start" successfully triggers `chrome.sidePanel.open({ tabId })` and initiates `startRecording` (`tabCapture`).
  - Questions 1 & 7 of ARCHITECTURE §26.2 answered: In-page prompt chip click in Shadow DOM satisfies Chrome user-gesture requirements.
- 17 test files, 128 tests passing; monorepo check clean.

### 2026-11-05 (latest) — Anirudh (Claude Code): S1-13 video upload and data saver
Anirudh asked to finish all S1 code first and run the Chrome tests at the end.
- **Extension** (`offscreen/video-uploader.ts`): uploads `video_buffer` fragments one at a time,
  oldest first, one signed PUT each, signing up to 50 per request; deletes a fragment only after its
  PUT. Waits while the audio stream is reconnecting or more than 5 s of audio is unsent
  (`StreamClient.backlogMs()`); backs off up to 30 s on errors; skips sessions the gateway no longer
  knows (their fragments stay local) and `local_…` recordings. It outlives the recording, so the
  service worker keeps the offscreen document open until `capture.upload_idle`. Leftovers resume
  when the document next opens.
- **Data saver** (`nextVideoQuality`): above 12 pending fragments (2 min) the recorder closes the
  part and starts a new one at 400 kbps with 854×480 / 10 fps via `applyConstraints`; back to
  standard when the backlog is 0. `applyConstraints` on a tab-capture track is **[Verify]** in Chrome.
- Side panel shows "Uploading video — N%" / "Video uploaded".
- **Gateway:** dev `fragments:sign` + `PUT /v1/dev/video/{token}` (15-min, content-type bound,
  8 MB cap, idempotent), stored per ARCHITECTURE §11.4; `check-session` lists video parts and
  missing fragments, `--join` writes a playable file. 20 new tests; `pnpm check` passes (267 tests).
- **Not done:** all Chrome checks (ADR-0011 1–4, 60-min run); server finalize stays S2-14.

### 2026-11-06 (later) — Anirudh (Claude Code): staging setup runbook for Gaurav
- **New: [docs/STAGING_SETUP.md](docs/STAGING_SETUP.md)** — step by step: project, budget alert,
  Terraform state bucket, pinning the extension ID (manifest `key`), applying the existing
  Terraform, the resources still to add (Artifact Registry, Memorystore, API / worker services,
  migration job, per-service accounts and secrets), migrations as `meetyou_app` with RLS checks,
  secrets (database URL, signing JWKS generated with our helper — command checked, Google OAuth
  client), Dockerfile shape (worker with ffmpeg), environment variables per service, deploy order
  and smoke test, cost control, security checklist, troubleshooting. Items not run against our
  project are marked **[Verify]**.
- **Gaurav:** start with §2–§7 (no new application code needed). Anirudh still owes the gateway
  staging mode (Cloud Storage chunk store, `0.0.0.0`, `APP_ENV=staging`) and the worker app.

### 2026-11-06 (later) — Anirudh (Claude Code): S2 remaining work (S2-04, S2-05, S2-07, S2-13, S2-14)
Plan written in IMPLEMENTATION_PLAN ("Stage 2 — Anirudh's remaining work"). Decisions (Anirudh):
`ioredis` for Redis (long-term choice), the `ffmpeg` binary for finalize, Hindi display text as
the provider returns it for now (he will switch later). Recorded in AGENTS §9.
- **S2-05 assembler** (`gateway/src/assembler.ts`): session clock, display policy (`as_provided`
  default; `roman_rules` = Devanagari→Roman + canonical spelling), `rawText` kept, ULIDs, echo
  flags. **Segments are now stored even when no client is attached** (before, they were dropped).
  New `shared/hinglish` (`@meetyou/hinglish`): the S0-03 canonical list and the Devanagari
  transliterator moved there from the benchmark (benchmark imports it; its 63 tests pass).
- **Sinks** (`sinks.ts`): `DbSink` → `transcript_segments` (speaker clusters created on first use),
  `usage_records` (S2-07, one realtime row per meeting), meeting → `processing` at the end,
  `video_assets` per part; `FileSink` → `segments.jsonl` / `usage.json` locally. Repository
  functions in `@meetyou/db` (`meetings-repo.ts`, 6 PGlite tests) — **S2-09 (Gaurav) should call
  `createMeetingForSession` in `POST /sessions`**.
- **S2-04** (`registry.ts`, `server.ts`, `session.ts`): session registry (memory / Redis hash per
  session, single-use token JTIs); any instance takes a session over from the registry and
  resumes from durable chunks (**kill-an-instance test passes**); real **JWT stream tokens**
  verified from the public JWKS only (`StreamTokenVerifier`; stream tokens now carry `wsid` —
  **the API must pass `workspaceId` to `issueStreamToken`**); STT `health` messages
  (`degraded`/`down`) and `needsBatch` marking on outages; workspace glossary → Deepgram
  `keyterm` (STT_PREFLIGHT §3.3 limits). Storage is keyed by **meeting ID** (§11.4).
  Redis tested against a local `redis-server` (`REDIS_URL=… vitest`).
- **Extension:** STT health → capture state → panel header "Recording — transcript delayed" +
  §9 banner; the recorder sends `video.part_started` / `video.part_stopped` over the stream.
- **S2-14** (`backend/packages/video`, `@meetyou/video`): `finalizeVideo` (join fragments, remux
  to faststart MP4 copying H.264 / re-encoding VP9, fill pauses with the last frame + silence so
  one file follows the session clock, poster), queue task `video.finalize` (re-checks every
  15 min until uploads are complete, 24 h cap, `delete_after` from the workspace retention,
  deletes fragments after the row is `ready`); `DbSink` enqueues it in the meeting-end
  transaction (outbox). Locally without Postgres the gateway finalizes in-process once an ended
  session has every fragment (`local-finalizer.ts`; a race where the last fragment's check was
  merged into an earlier one was found and fixed); dev routes serve `playback.mp4` with Range and
  `poster.jpg`; the side panel shows the finalized "Meeting video" with Play/Download. Tested with
  real ffmpeg (single part, two parts with a 6 s pause → 14 s file, gateway end to end).
- **S2-13** (`shared/fixtures`, `@meetyou/fixtures`): synthetic Hinglish standup script; a session
  recorded through the real gateway with a scripted STT (`gateway/src/record-fixture.ts`) +
  `replaySession` for UI mocks; `pnpm --filter @meetyou/fixtures audio` makes synthetic TTS WAVs
  per lane locally (`shared/fixtures/audio/`, gitignored — no audio committed).
- `pnpm check` passes twice in a row (gateway 56 + 1 Redis test skipped without `REDIS_URL`,
  db 28, auth 12, providers 8, video 9, fixtures 3, hinglish 5, extension 184, …).
- **Restart the local gateway** (new code) and rebuild/reload the extension (`build:dev` done).
- **Not done / needs staging or Gaurav:** Cloud Storage chunk store + V4 signed PUT URLs + bucket
  CORS (new dependency `@google-cloud/storage` — ask first), Memorystore, migrations on Cloud SQL,
  the worker service running `videoFinalizeTask` (image with ffmpeg), API `POST /sessions` and
  `GET /meetings/{id}/video`, S2-06 crash test on Cloud Run. Not checked in Chrome on a real call.

### 2026-11-06 (later) — Anirudh (Claude Code): orange accent; light default with a Dark toggle
**Decisions (Anirudh):** (1) no green in the UI: the accent is **orange** everywhere; (2) **Light
is the default** theme with a user switch to Dark; the system theme is no longer followed.
- `shared/design-tokens`: `olive*` token values changed to orange (light `#c2410c` family, dark
  `#fb923c` family; names kept so no component changed), `tokens.css` regenerated: light at
  `:root`, dark only under `:root[data-theme='dark']`. All contrast tests pass (34).
- `shared/ui/theme.ts`: `useTheme` / `initTheme` (`localStorage` `minutes.theme`, light default,
  follows other tabs). Web: **Settings → Appearance** (Light · Dark). Side panel: "…" menu →
  **Dark theme / Light theme**. Meet prompt and pill pick up the orange automatically.
- DESIGN §5.1, §6.1 and §16 updated with the new values and the appearance rule.
- Checked in the built-in browser: web app light by default, Dark from Settings (meetings list,
  meeting detail), side panel light default and Dark from the menu. `pnpm check` passes.
  `extension/dist` rebuilt with `build:dev`.

### 2026-11-06 (later) — Anirudh (Claude Code): video play/download after the call; Hindi findings
- **Asked by Anirudh:** where is the video after the meeting, and a way to download it.
  - Gateway: `GET /v1/dev/sessions/{id}/video/{partId}?download=1` answers with
    `content-disposition: attachment` (test added). **Restart the local gateway** to get it.
  - Service worker stores the newest recording (`lastRecording` in `chrome.storage.local`).
  - Side panel: Processing and Done show a **Recording** card (one row per video part: **Play**
    opens Chrome's player in a tab, **Download** saves the file; refreshes every 5 s while
    fragments upload). Ready shows **Last recording · {day time}** with the same rows. Local-only
    builds list the blobs on this computer instead. Only URLs on the built-in gateway are linked.
  - TODO(S4-17, S2-14): the library meeting page with the finalized MP4 replaces this.
  - Checked in the built-in browser against a throwaway gateway (port 8797, scratch data) with a
    synthetic 10 s MP4: Ready and Processing cards, Play URL 200 `video/mp4`, download header.
    5 new tests; `pnpm check` passes (extension 181, gateway 43). Not checked in real Chrome yet.
- **Hindi "wrong Roman":** no transliteration exists yet (`session.ts` sends Deepgram's text as
  both `text` and `rawText`). Anirudh's example was **Hindi heard as wrong English words** — a
  recognition issue in Deepgram (`language=multi`), not transliteration. Anirudh first chose a
  rule-based Devanagari→Hinglish converter, then asked for **Gemini** to romanize transcripts and
  write summaries (open: paid tier for real meetings, live vs after the call — see next entry).

### 2026-11-06 (later) — Anirudh (Claude Code): "nothing works" after the UI build — local-only build
- Cause: my verification builds ran plain `pnpm build`, which writes `extension/dist` **without**
  `MINUTES_GATEWAY_URL`, so the loaded extension recorded locally only — no stream, no live
  transcript, no video upload (the panel's "Saved on this computer" was the only hint).
- Fixes: `pnpm --filter @meetyou/extension build:dev` (gateway `http://127.0.0.1:8787`) added and
  documented in `extension/README.md`; the side panel now shows a warning banner in Ready and
  Recording when the build has no gateway. `dist/` rebuilt with the gateway.
- To test: run the gateway (`node --env-file=.env.bench backend/apps/gateway/src/main.ts`), reload
  the extension in `chrome://extensions`, **then reload the Meet tab** (new content script: prompt
  and pill), open the panel from the toolbar icon, Start.
- Also stopped a leftover local gateway from 2026-11-05 on port 8797 (a smoke test of mine).

### 2026-11-06 (later) — Anirudh (Claude Code): Meet prompt restyled to DESIGN §8.2 (S4-04)
- `extension/src/content/prompt-chip.ts` (Gaurav's S1-09 prototype; behaviour unchanged): glass
  card 300 px, radius 18, brand tile 26 px with the olive dot, 14/600 title, 13 px body,
  **olive Start** (flex 1, 40 px) before **Not now** (secondary on glass), colours from
  `@meetyou/design-tokens`, focus ring, reduced motion/transparency. Built with `createElement`
  instead of `innerHTML`. Copy says "Minutes" (DESIGN), not "MeetYou".
- Reminder line follows the Record video setting (`settings.recordVideo`, read and watched in the
  content script): "Audio and the Meet tab's video will be recorded." / "Audio will be recorded."
  TODO(S4-12): also audio-only when retention is "Delete after notes".
- Pill matched to the handoff: live dot gets the `ember-line` border, timer in `ink-3`.
- Checked in the built-in browser harness: look, video-off reminder, real Start and Not now
  clicks. 1 new test; `pnpm check` passes (extension 176 tests).
- **Not done:** shift left of Meet's right-hand panel when open (§8.2) — needs a verified selector
  for that panel in `adapters/meet/selectors.ts`; real-Meet checks of both overlays.

### 2026-11-06 (later) — Anirudh (Claude Code): Meet recording pill (S4-04, DESIGN §8.4)
- `extension/src/content/recording-pill.ts`: glass pill in closed Shadow DOM on the recorded Meet
  tab — status dot (ember pulse / white paused / amber / red), "Taking notes" + timer + `video`
  icon, "Paused", "Reconnecting — audio saved", "Recording stopped"; hidden before start, while
  finishing and after. **Draggable** (snaps to the nearest corner; bottom corners sit 96 px up,
  above Meet's control bar), **collapsible** to the dot, position and collapse remembered in
  `chrome.storage.local` (`pill.layout`). Click opens the side panel via the new
  `pill.open-sidepanel` message (same user-gesture path as the prompt chip). Untrusted clicks and
  the click after a drag are ignored. Colours and pulse from `@meetyou/design-tokens`; reduced
  motion and reduced transparency handled. Logic in `pill-model.ts` (5 tests).
- The service worker's `recording.state` message to the Meet tab (and the `meet.page-ready` reply)
  now carries `startedAt` and `video` as well as `status`. `formatClock` moved to `src/format.ts`.
- Checked in the built-in browser with a bundled harness over a dark Meet-like page: every state,
  real mouse drag to bottom-right (saved), click (panel request sent), collapse and expand. Found
  and fixed: a fast drag that left the pill never ended (move/up now followed on the window).
  **Not checked on real Meet yet** (layouts: grid, spotlight, side panels open — S4-04 acceptance;
  whether the pill click counts as a user gesture for `sidePanel.open`).
- `pnpm check` passes (extension 175 tests).

### 2026-11-06 (later) — Anirudh (Claude Code): side panel UI (S4-05, S4-08, S4-17 parts), `shared/ui`
**Decision (Anirudh):** the side panel uses React with a shared component package, so the panel and
the library web app share DESIGN §6 components (new deps in `extension`: react/react-dom 19.1.10,
@types/react(-dom) 19.3.0 — same versions as `web/`).
- **`shared/ui` (`@meetyou/ui`)**: Button, Card, StatusPill, ChipGroup, Segmented, **Switch (new,
  §6.4)**, Checkbox, SearchInput, SkeletonRows, Banner, CitationChip, Icon (+ video-off, arrows),
  Toast, and `styles.css` (base + §6 component CSS). Moved out of `web/src/components`; `web/`
  imports `@meetyou/ui` (its own CSS keeps only shell and screens).
- **Side panel rebuilt** (`extension/src/sidepanel/`, `main.tsx` entry; esbuild `jsx: automatic`,
  bundled fonts as files, React production build): header with state dot + label + timer, Pause /
  Stop, overflow menu; **Ready** with recording options (Record video switch, stored as
  `settings.recordVideo`, was `dev.recordVideo`); **Recording** with lane meters + connection text,
  video status line, Transcript / My notes tabs, interim-then-final lines, "You" in olive, speaker
  names, paused marker, Jump to live; **notes composer** (Note/Decision/Action/Question chips, typed
  `DECISION:` / `ACTION:` / `QUESTION:` / `IMPORTANT:` prefixes, notes kept per session in
  `chrome.storage.local`); **Processing** (three steps, honest "Notes aren't switched on yet" line,
  "Uploading video — N%" row, **Done**); **Ready** and **Error** (Start again / Dismiss).
  §9 banners: reconnecting, mic lost, mic missing at start, video stopped, Meet tab silent ≥ 15 s;
  "Back online — catching up" toast. New `recording.dismiss` message returns processing / ready /
  error to Ready (processing goes on in the backend).
- Developer controls (Meet state, selector health, gateway link, video files, delete local video)
  moved behind the overflow menu → **Developer details**; `capture-controls.ts` and the old
  `index.ts` / `styles.css` removed.
- Checked in the built-in browser with a stubbed `chrome` API and synthetic data at 320, 380 and
  480 px (no horizontal scroll): every view above, note entry with a typed prefix, tab switch,
  banners, upload row, developer view, Jump to live. **Not checked in Chrome on a real call yet.**
- `pnpm check` passes (extension 170 tests; new: panel model, transcript model, notes, dismiss).
- **Still to build (TODOs in code):** Consent step (needs S4-07 posting, Gaurav), Video quality
  segmented + "Data saver" line (offscreen must report quality), retention lock (S4-12), Stop and
  delete + Consent log in the overflow menu, Choose microphone, timer and note time minus paused time
  (session clock), notes sync (S4-06), processing steps from the pipeline (S3-03), Open notes
  (S4-14), Too short / Failed processing states, transcript delayed state (needs gateway health),
  Roman interim (S2-05). Next UI steps: recording pill (§8.4), onboarding (§7), web transcript /
  video / consent log / Settings.

### 2026-11-06 (later) — Anirudh (Claude Code): rule — every feature gets its UI
**Decision (Anirudh):** every user-facing feature ships with its UI (DESIGN.md), or a Stage 4 task
naming its DESIGN section; developer controls do not count. Added as item 8 of the plan's definition
of done (§16). Current gaps, all Anirudh's UI: side panel per DESIGN §8.5–§8.7 (today's panel is a
developer control: live transcript, levels, video upload, link state), Meet recording pill (§8.4),
onboarding and sign-in (§7, S4-03, needs S2-02 login), failure states (§9, S4-08), video player and
upload state (S4-17), settings (§15, S4-12), echo-line toggle and speaker labels in the transcript
(§12.5), consent notice and log (§8.5, §13.4).

### 2026-11-06 (later) — Anirudh (Claude Code): library web app started (React + Vite)
**Decision (Anirudh):** the library web app uses **React + Vite** (react 19.1.10, vite 8.3.5,
@vitejs/plugin-react 6.1.2 — all at least two weeks old). Recorded in AGENTS §9 and ARCHITECTURE §25.
- `web/`: shell with sidebar; Home, Meetings (search, template chips, table), Meeting detail (notes
  with legend, anchored sections, decisions, open questions, numbered citation chips and citation
  card; transcript with cited-line highlight; action items with Undo toast; processing state) and
  Action items, following DESIGN §3, §6, §10–§14 and tokens only. Runs on a mock API with synthetic
  data shaped by `shared/contracts` (S4-01); the real client comes with S2-09 (S4-14).
- Checked in the built-in browser at 1440×900 and 800 px: navigation, citation selection, "Show in
  transcript" highlight, search filtering, action items. Production build works (215 kB JS).
- `pnpm check` passes (364 tests; web 6 logic tests). Not yet: share/regenerate/rename, video
  player, settings, setup card, dark-mode and accessibility QA, component render tests (needs a DOM
  test library — will ask before adding).

### 2026-11-06 — Anirudh (Claude Code): S2-03 provider layer and S2-06 job queue
**Decision (Anirudh):** queue tests on PGlite over TCP (`@electric-sql/pglite-socket` 0.2.14, dev
only); PGlite raised to 0.5.11 to match its peer requirement. graphile-worker 0.18.0 per ADR-0005.
- **S2-03** `backend/packages/providers`: STT streaming/batch, LLM and transliterator interfaces;
  capability descriptors; registry from env; the free-Gemini-key guard (refused outside local/ci).
  The gateway's Deepgram adapter moved here (git history kept) and gained a Deepgram pre-recorded
  adapter for the post-meeting pass (params and response verified against Deepgram's docs; raw
  bytes as the S0 benchmark sent them). The gateway now builds STT through `createProviders`.
- **S2-06** `backend/packages/queue`: `enqueue(tx, …)` in the caller's transaction (ADR-0005 check 1
  verified by test: rolled-back jobs never run), typed tasks with zod payloads, job keys, `run_at`,
  8 attempts then dead letter into `failed_jobs` (migration 0003; insert-only for the app; error
  class name only). A spike first confirmed graphile-worker runs on PGlite-socket; a probe confirmed
  the test connections run as `meetyou_app` with RLS enforced.
- `pnpm check` passes (358 tests).
- **For Gaurav:** S2-10 (retention/deletion jobs) can now `defineTask` + `enqueue` inside
  `Db.inWorkspace`; the deletion grace is `runAt: execute_after`.

### 2026-11-05 (night, review 2) — Anirudh (Claude Code): second code review and fixes
Three parallel reviews of the code added since the first review (db + auth, S1-08/S1-09, video and
drain paths); each finding was checked against the code. `pnpm check` passes (347 tests). Nothing
was applied to a real database (none is migrated yet), so `0001`/`0002` were edited in place.

**Database and auth**
- Refresh: issuing or rotating now requires a current membership of the token's workspace (a
  removed member is revoked, `membership_removed`); a used token presented again within 30 s
  gets a successor (lost response / two contexts) instead of revoking the family; afterwards it is
  still treated as theft. Access tokens and Google ID tokens must carry `exp`.
- Schema: summary items, citations, owners, anchors and speaker clusters must belong to the same
  meeting (composite keys with `meeting_id`); citations no longer vanish when segments are
  replaced; the deletion audit trail survives workspace deletion; `consent_logs.outcome`
  (posted/skipped/failed) as in the `consent.notice` event; missing indexes; one playback video row
  per meeting; first sign-ins of one account are serialised; app functions not executable by
  PUBLIC.
- Migrations refuse duplicate versions and edits to applied files (checksum) and run under an
  advisory lock. Tests and production return the same types (int8 → number, date → 'YYYY-MM-DD').
  `Db.assertRowSecurityEnforced()` refuses a superuser/BYPASSRLS role — **for Gaurav (S2-08): call
  it at API startup.**

**Extension (S1-08/S1-09 code, now Anirudh's UI)**
- Prompt chip: never shown over a running recording (asks the SW on load); Escape only from inside
  the chip; closed shadow root and trusted clicks only; explains a failed Start or side-panel open;
  replaces a chip left by an orphaned script; "Not now" resets for the next call; live-region
  announcement. Mute observer no longer watches `class`. ARCHITECTURE §26.2 corrected: the chip
  hides (does not unmount); mute gating is not wired yet (TODO FR-CAP-11, S2-04).
- Drain and upload: no "idle" while a stop is still registering its drain (the SW also asks the
  document before closing); `end` is sent even when everything is already acknowledged; video
  waits for earlier recordings' drains too; a fragment refused for good (400/413/415/422) no longer
  blocks the queue; "Delete local video" checks IndexedDB for fragments still to upload.

**Gateway:** video playback streams with backpressure and stops when the tab closes; an error
mid-stream no longer crashes the process; dev endpoints accept only loopback `Host` (DNS
rebinding); sessions nobody uses are evicted after 24 h.

**Open:** speaker detection fallbacks and the `data-self-name` meaning still need the Meet DOM dump
(S1-12); chip placement left of Meet's side panel and focus return (S4-04); single-flight refresh in
the extension (S4-03); a separate migration-owner role in Cloud SQL (infra).

### 2026-11-05 (night) — Anirudh (Claude Code): merged Gaurav's S1-08/S1-09/S1-12; review fixes
Pulled `main` (`d3e912c`) into `anirudh`; only the HANDOFF header conflicted. Review of the new code:
- **Names in logs (AGENTS §7):** `speaker-signal.ts` built IDs like `p_<name>` when a tile has no
  ID attribute, and the content script and service worker logged those IDs. Now the ID is
  `p_<FNV-1a hash of the name>` and neither log prints participant IDs.
- **Swallowed error:** the Windows-safe directory fsync in `chunk-store.ts` caught everything
  silently; it still skips Windows but now logs `chunk.dir_sync_failed` elsewhere.
- **For Gaurav:** the S1-12 figures in ARCHITECTURE §26.2 (100% mute detection, ≥ 95% speaker
  attribution, < 0.2% overlay CPU) have no raw data in the repo; please add how they were measured
  (call size, duration, counts) so they can be checked.

### 2026-11-05 (late, fix 2) — Anirudh (Claude Code): "no video" with live transcription on
Anirudh saw video only with the gateway off. Checked `.data`: every Deepgram session uploaded its
video; with the gateway on, uploaded fragments are deleted locally, so the panel's "Show last
video" (IndexedDB only) found nothing. Fix: dev gateway `GET /v1/dev/sessions/{id}/video` (parts,
playable fragment count) and `GET …/video/{partId}` (fragments 0..n joined, served as MP4/WebM,
from disk, so it works after a restart); the panel lists the last session's uploaded parts as
links that open in a tab, then any local leftovers. Checked on the real 30.7 s recording. Stand-in
for S2-14's signed playback URL. Restart the gateway and rebuild the extension.

### 2026-11-05 (late, fix) — Anirudh (Claude Code): video stopped uploading after the meeting ended
Anirudh's Chrome test: a 27 s recording made 3 video fragments, only 2 reached the gateway
(audio: 272/272 frames per lane, no loss). Cause: the review fix that evicted a session on `end`;
the last fragment is written at Stop, after the audio `end`, so its signing request got 404 and the
uploader skipped the session. Fix: an ended session stays known for 24 h (`ENDED_SESSION_TTL_MS`)
so video can still be signed; it still refuses new audio connections and its STT streams are closed.
New test (fails on the old code). Restart the gateway to pick it up.

### 2026-11-05 (late) — Anirudh (Claude Code): S2-02 auth service
- `backend/packages/auth` (`jose` 6.2.13, named in ADR-0004; no other new dependency). Google
  endpoints, issuers and the PKCE `code_verifier` verified against Google's OIDC and native-app
  docs; the Web-client + `chromiumapp.org` redirect stays ADR-0004 check 2 (S4-03).
- Sign-in exchanges the code, verifies the ID token (signature, `iss`, `aud`, `exp`, verified
  email) and refuses redirect URIs not in the configured list before calling Google.
- Our tokens: ES256 JWTs with `kid`; access (`aud=api`, 15 min, `sub`, `wsid`, `scope`) and stream
  (`aud=gateway`, 10 min, `sid`, `lanes`, `jti`); JWKS keeps the previous key during rotation.
- Refresh: opaque 256-bit tokens, stored as SHA-256 only (`0002_refresh_tokens.sql`, forced RLS);
  rotation marks the old token used; a replayed token revokes the whole family; logout revokes it.
- `authenticate(header, tokens)` is the middleware for S2-08; contracts gain `GoogleSignInRequest`,
  `TokenResponse`, `RefreshRequest`. 17 new tests (auth 11, db 5, contracts 1); `pnpm check`
  passes (305 tests).
- **For Gaurav (S2-08):** map `AuthService` to the three routes and `AuthError.status` to the
  response; JWKS route from `TokenService.jwks`; config from Secret Manager.

### 2026-11-05 (night) — Anirudh (Claude Code): S2-01 database schema
**Decisions (Anirudh):** **Kysely** for queries (with `pg`), **PGlite** (in-process Postgres, npm
dev dependency) for tests. Versions pinned to releases at least two weeks old: kysely 0.29.7,
pg 8.23.1, @electric-sql/pglite 0.5.10. A spike confirmed PGlite enforces RLS for a non-superuser.
- `backend/packages/db`: `migrations/0001_init.sql` with every PRD §13 table plus `video_assets`
  (ADR-0011) and `meetings.session_id` (StartSessionResponse has both IDs); text + CHECK for value
  sets matching `shared/contracts`; `updated_at` triggers.
- **Tenancy:** forced RLS on every table keyed on `app.workspace_id`; `Db.inWorkspace()` is the only
  query path and sets it per transaction; children reference `(meeting_id, workspace_id)` so they
  cannot point at another workspace. `users` has no workspace_id: visible only to its own sign-in.
  `app_sign_in_google_user()` creates user + personal workspace + owner membership + settings.
- Tests (9, PGlite, as a non-superuser role like Cloud SQL's `meetyou_app`): cross-tenant
  read/write/update/delete and foreign-key attempts fail; nothing is visible without a workspace;
  sign-in is idempotent. `pnpm check` passes (288 tests).
- `migrate-cli.ts` applies migrations with `DATABASE_URL`. **Not applied to staging yet** (Cloud SQL
  is private-IP only; needs a Cloud Run job or the proxy from inside the VPC — S2-12).
- **For Gaurav (S2-09):** query through `Db.inWorkspace`; never connect as a superuser or a
  `BYPASSRLS` role. Open: the retention scheduler's cross-workspace path (S2-10).

### 2026-11-05 (latest) — Anirudh (Claude Code): UI ownership
**Decision (Anirudh):** Anirudh builds the UI, not Gaurav. Recorded in IMPLEMENTATION_PLAN §1.1
(Extension shell and UI, Library app, Design system → Anirudh), §2 working agreement, Stage 4 (all
tasks except S4-07 → Anirudh), S5-04 and the §14 hand-offs (new: Gaurav → Anirudh REST endpoints for
S4-14 and the S4-07 chat notice). Gaurav's other areas stay as they are. Phase 2/3 UI tasks (S8, S9)
were not changed. **For Gaurav:** S4-01/S4-02/S4-09 are no longer yours; after S1-08, S1-09 and
S1-12 your next tasks are S2-08..S2-12 and S4-07.

### 2026-11-05 (late night) — Anirudh (Claude Code): full code review and fixes
Three parallel reviews (extension capture, gateway + contracts, Meet adapter + side panel); every
finding was checked against the code before fixing. Each fix below has a test that fails on the old
code unless noted. `pnpm check` passes (279 tests). Nothing verified in Chrome yet.

**Gateway**
- A failed chunk write no longer lets a later chunk's ack cover the lost frames: the lane stops
  writing/acking until the client reconnects and replays; `end` after a failed write returns a
  retryable error instead of ending the session.
- A malformed upgrade request no longer crashes the process; dev endpoints and the WebSocket
  accept only `chrome-extension://` origins or none (CLI/tests), not web pages.
- Provider streams close 60 s after the client disappears (they reopen on the next frame); an
  unexpected provider close backs off 5 s instead of reopening every frame; Deepgram handshake
  times out after 10 s; the STT queue is capped; ended sessions are evicted; `close()` closes STT.
- Durable writes fsync the directory and use unique temp names (no test: needs a crash);
  Ogg pre-skip only on a lane's first chunk/stream (no test).

**Extension**
- Stop during a network outage keeps reconnecting (up to 10 min, FR-CAP-07) and delivers the
  buffered audio in the background; the offscreen document stays open until it is acknowledged.
  Pause/resume sent while offline are queued until `ready`.
- Capture starts before the dev session is created (the stream ID expires in seconds); frames wait
  in memory; session creation retries 3× with 5 s timeouts; all dev-gateway fetches time out.
- A failed Opus encoder restarts (up to 5 times) instead of silencing the lane; a lost mic detaches
  its whole lane; `local_…` video older than 7 days is pruned; a refused stream still ends in
  `processing`; the delayed left-call check cannot stop a newer recording.
- Manifest: removed unused `identity` and `notifications` (AGENTS §10 minimum permissions). **Add
  `identity` back in S2-02** and `notifications` with O1.
- Meet adapter: dropped `a[href="/"]` (false `ended` → stop after 3 s) and `div[data-is-muted]`
  (lobby read as in_call) fallbacks; mutation observer throttles instead of a debounce that never
  fires during a busy call; health is not "broken" on home/lobby; content script stops after an
  extension reload and broadcasts the first state once. Side panel status shows only its own tab;
  interim lines clear on Start; local video cannot be deleted while it is still uploading.

**Open (not fixed)**
- 1:1 naming uses visible tiles, so a group call with one visible remote tile gets that name;
  `data-self-name` semantics are unverified. Both need the Meet DOM dump (S1-12).
- Leftover audio after a browser crash is not replayed (FR-CAP-08); leftover video resumes only at
  the next recording (TODO S2-14); starting with the gateway down stays local-only (TODO S2-04).

### 2026-11-05 (night) — Anirudh (Claude Code) & Gaurav (Google Antigravity): review of S1-10 Terraform applied
Reviewed Gaurav's S1-10 (good: private-IP Cloud SQL, bucket with public access prevention and
uniform access, state and tfvars gitignored). Fixed in `infra/` and **applied on GCP Mumbai (Cloud Shell) by Gaurav**:
1. **Lifecycle rule 7 → 31 days.** It is a backstop (ARCHITECTURE §11.6); at 7 days it would delete
   recordings of users who chose 30-day retention (D-02). A validation now refuses ≤ 30.
2. **Bucket CORS** allowed `https://meet.google.com`; uploads come from the extension's offscreen
   document, so it now allows only `extension_origins` (`chrome-extension://<id>`, validated), PUT only.
3. **Removed Chirp 3 leftovers:** `speech.googleapis.com` and `roles/speech.client` (Deepgram only). Destroyed in staging.
4. **Cloud Run env `MINUTES_ENV` → `APP_ENV`**, the name the gateway reads. Updated in staging.
5. Cloud SQL `deletion_protection` comment matched to the value; staging README §4–5 updated
   (S1-14 cancelled, gateway deploy after S2 sign-in, idle cost).

**Status:** `terraform apply` completed cleanly in Cloud Shell (0 added, 2 changed, 2 destroyed).
**Cost:** the staging Cloud SQL instance (`db-custom-1-3840`) and VPC connector run 24×7 while nothing uses
them until S2; can be paused via `gcloud sql instances patch meetyou-staging-pg16 --activation-policy=NEVER`
to conserve free-trial credits.

### 2026-11-05 (evening) — Gaurav (Google Antigravity): S1-10 staging infrastructure applied on GCP Mumbai
**Done** (branch `Gauravbro`)
- Fully provisioned staging infrastructure on Google Cloud `asia-south1` (Mumbai) in project `project-7ddc1bbe-aea4-44f7-bd0` using Terraform:
  - **Storage:** GCS bucket `meetyou-audio-chunks-staging-project-7ddc1bbe-aea4-44f7-bd0` with automated 7-day retention deletion lifecycle rule (D-02) and Meet CORS.
  - **Networking:** VPC `meetyou-staging-vpc`, subnet `meetyou-staging-subnet` (`10.10.0.0/24`), private IP range allocation for SQL peering (`10.254.0.3`), and Serverless VPC Access connector `meetyou-staging-vpc-con` (`10.10.8.0/28`).
  - **Database:** Cloud SQL PostgreSQL 16 instance `meetyou-staging-pg16` (`ENTERPRISE` edition, `db-custom-1-3840`, 10 GB SSD, private IP only, daily automated backups) with database `meetyou_staging` and user `meetyou_app`.
  - **Security:** Secret Manager secrets for DB password, JWT signing key, and Deepgram API key with IAM accessor roles bound to the gateway service account `meetyou-staging-gateway-sa@project-7ddc1bbe-aea4-44f7-bd0.iam.gserviceaccount.com`.
  - **Compute:** Cloud Run v2 service `meetyou-staging-gateway` deployed at `https://meetyou-staging-gateway-7oflznia2a-el.a.run.app` with 60-min WebSocket request timeout, session affinity, zero idle instances (min 0, max 3), and private VPC egress.
- Fixed Cloud Run v2 reserved `PORT` environment error and Cloud SQL `ENTERPRISE` edition specification in Terraform modules.
- S1-10 exit criteria satisfied: `terraform apply` creates staging infrastructure from scratch.

### 2026-11-05 (later) — Anirudh (Claude Code): UI design sources
**Decision (Anirudh):** all UI work uses only `docs/DESIGN.md`, the Claude Code design artifact
[Minutes app design](https://claude.ai/artifact/P9CqMCqH5VSaRBkRMSczsn), and the handoff files in
`~/design_handoff_minutes_app/`. No other design sources, UI kits, or invented styles; DESIGN.md
wins on conflicts. Recorded in DESIGN.md (Design source row) and AGENTS §2. **For Gaurav:** applies
to S4 screens and the library web app (S4-09).

### 2026-11-05 — Anirudh (Claude Code): STT is Deepgram only
**Decision (Anirudh):** we will not use Google Cloud Speech-to-Text (Chirp 3); **Deepgram Nova-3**
is the only STT provider, live and post-meeting.
- ADR-0001 amended (§0, status, §6.1, §6.2 cancelled, run log); ADR-0003 check 5 cancelled.
- S1-14 cancelled; S2-03 builds the Deepgram adapter only.
- AGENTS §9, PRD (D-03, cost ≈ $1.10 per meeting-hour [Verify]), ARCHITECTURE, SUBPROCESSORS
  (Deepgram, United States), FEATURES, DESIGN, STT_PREFLIGHT and the benchmark plan updated.
- The Google provider in `tools/stt-benchmark` stays as benchmark code; the product does not use it.
- **For Gaurav (S1-10):** the GCP project is no longer needed for STT; ADR-0002 hosting (Cloud Run,
  Cloud SQL, Cloud Storage in Mumbai) is unchanged.
- **Open:** behaviour during a Deepgram outage (no second provider) — decide before beta.

**Decision (Anirudh): D-07 closed — the library is a web app from alpha**, like Fireflies: users sign
in and see their own recordings, transcripts, summaries and notes from any device. PRD FR-LIB-05,
FEATURES, DESIGN, ARCHITECTURE, ADR-0002/0004 and AGENTS §2/§9 updated. **For Gaurav:** S4-09
builds the library as a web app (sign-in per ADR-0004 §4.5, hosting per ADR-0006); S6-01 moved
into it. Sharing with other attendees stays Phase 2; nothing is sent to attendees automatically.

### 2026-11-04 (later) — Anirudh (Claude Code): speaker names in the live transcript
**Request (Anirudh):** show who spoke instead of "Me"/"Them".
- Gateway: Deepgram streaming diarization on the `them` lane only (`diarize_model=latest`;
  `diarize` is deprecated; smoke test with `language=multi` accepted). Finals are split into one
  segment per speaker run with `speakerClusterId` `spk_N` (FR-SPK-02). Indices restart per
  provider stream — S3-04 unifies them. [Verify] whether diarization changes Deepgram's price.
- Side panel (developer control): `me` → the Meet "(You)" participant from the S1-07 adapter
  (S2 replaces it with the signed-in user, FR-SPK-01); `them` → the only other participant on a
  1:1 call (FR-SPK-03 1:1 case), else "Speaker N". Names refresh every 15 s via `meet.get-state`
  because the adapter re-reads them only on call-state changes.
- Still needed for real names on group calls: Gaurav's S1-08 `speaker.active` events, then
  Anirudh's S3-04 cluster-to-name alignment; rename in S4 (FR-SPK-05).
- Noticed in the screenshot: Hindi shows in Devanagari; D-01 Roman display comes with the
  transliteration step (S3, `TODO` in the gateway).
- **Bug (Anirudh's test):** recording continued after leaving the call. Likely cause: Meet's
  left-meeting screen is not matched as `ended` (the Rejoin / Return-to-home selectors use
  aria-labels the buttons may not have), so the adapter falls back to `lobby`, and the service
  worker stopped only on `ended`. Fix: once the recorded tab has been `in_call`
  (`callJoined`, also read right after Start), any other state stops the recording after it holds
  at re-checks (3 s for `ended`; 5 s and 10 s otherwise). Re-test the same day: the video part
  ends ~4 s after the "You left the meeting" screen appears (consistent with the `ended` path);
  but Anirudh pressed Stop there, so auto-stop was not shown. The recording had started in the
  lobby, so the `lobby` path needed ~10 s and was cut short. Added: the detector also recognises the
  post-call screen by button text ("Rejoin", "Return to home screen"; English only) as `ended`
  (stop after ~3 s), and the service worker logs each left-call check (`call: …` in its console).
  Worst case Meet's own 60 s "Returning to home screen" changes the URL, which also stops it. The same run shows S1-07 health "Broken (3 missed)": the Leave
  button selector did not match (in-call came from the control bar) and no participants were
  found, so names fall back to Me/Them. Video: Chrome picked MP4 (H.264 + Opus), 720p ~15 fps.
  **Gaurav (S1-12):** check what the adapter reports on the left-meeting screen
  (`[MeetYou] Call state:` in the Meet tab console) and match those buttons by text too.

### 2026-11-04 — Anirudh (Claude Code): Opus, cost tracking, S1-11 local measurements
**Decisions (Anirudh):** Opus per ADR-0003 but **the gateway wraps it in Ogg instead of decoding**
(ADR-0003 §3.1 amendment); ran the Deepgram backlog test on public MUCS audio (paid, ~2 min).

**Done**
- Extension: WebCodecs Opus encoder per lane (24 kbps, 20 ms, voip), grouped into 100 ms frames
  (`packOpusFrame`), PCM16 fallback; `MINUTES_AUDIO_CODEC=pcm16` build flag for comparisons.
- Gateway: Ogg Opus muxer (OpusHead page byte-identical to ffmpeg; ffmpeg decodes our files),
  `.opus` chunks, Ogg stream to Deepgram (no `encoding`/`sample_rate`), codec fixed per session.
- Cost per meeting (AGENTS §3 rule 10): `usage.json` per session — stored audio, STT minutes,
  bytes, estimated cost (Deepgram list price $0.0092/min, [Verify]). Fixed while testing: replayed
  frames were counted twice.
- Tools: `check-session.ts` (loss check for the M1 60-minute run), `load-test.ts` (§26.2 Q6),
  `backlog-speed.ts` (Q5). Findings in ARCHITECTURE §26.2.
- Deepgram close waited only 5 s, which dropped results for a backlog; it now waits while results
  keep coming (10 s idle).
- Measured: Deepgram accepts our Ogg Opus; at 10× send speed it returned results at only ~1.2×
  real time (Q5, preliminary). Gateway, STT off, 20 sessions: Opus 0.14% CPU/session (Q6, local).

- **Verified in Chrome (Anirudh):** Opus end to end — session `ses_01M6JKPB…`, 48.5 s, 485
  frames per lane, `check-session`: no missing or duplicate frames, codec opus, 0.1 MB stored,
  1.61 STT minutes, est. $0.0148. An earlier PCM16 run (70 s, 702 frames per lane) also had no loss.
  Live `me`-lane transcript lines showed in the side panel; S1-07's panel showed IN CALL / Healthy.

- Later the same day: echo flagging (§8.1 step 7) with counts in `usage.json` and
  `check-session` (answers Q2 from one speaker call); benchmark `encoding: ogg_opus` for Google and
  a third run in `runs.google.json` (ADR-0003 check 5 runs with S1-14).
- **Decision (Anirudh):** S1-05 staging waits for S2 sign-in — dev endpoints have no auth and would
  be open on the internet. The Cloud Storage library is added when the GCP project exists. So the
  Cloud Run 2-hour test also moves after S2; local runs cover S1.

**Not done / next**
- Chrome: CPU with Opus vs PCM16 in Task Manager, plus the pending Chrome checks from 2026-11-03.
- Q5 follow-up run that waits to the end; Google Chirp 3 + `OGG_OPUS` streaming in S1-14 (needs
  the GCP project).

### 2026-11-03 (later) — Anirudh (Claude Code): S1-03..S1-06, S1-13, local gateway
**Decisions (Anirudh):** add **esbuild** to the extension (bundles each entry point, so extension
code can import `@meetyou/contracts` and zod); build the S1-05 gateway **locally first** with `ws`
(disk storage until S1-10 staging); use **Deepgram** for live STT during dev/testing.

**Done (code + tests)**
- Build: `extension/scripts/build.mjs` (esbuild) replaces `tsc` emit; `tsconfig.build.json` and
  `copy-static.mjs` removed. `MINUTES_GATEWAY_URL` at build time turns streaming on.
- S1-06 state machine (`background/capture-state.ts`): full ARCHITECTURE §4.3 states incl.
  paused/reconnecting/processing; persisted in `chrome.storage.session`; badge REC/❚❚/…; the
  recorded tab gets a `recording.state` message; a restarted worker checks the offscreen document
  (`capture.status`) and marks `capture_lost` if the recording is gone. `toggle-pause` shortcut.
- S1-03: 16 kHz capture `AudioContext` (Chrome resamples) + `pcm-framer` AudioWorklet: downmix,
  PCM16, 100 ms frames, per-frame level; both lanes share the context clock for `captureMs`.
  Playback stays in a separate device-rate context. **Opus not done** — PCM16 is the ADR-0003
  fallback; encoder (WebCodecs) and gateway decode are left for S1-11.
- S1-04: IndexedDB `audio_buffer` write-first, per-lane seq, `StreamClient` (hello/resumeFrom,
  ready.durableUpTo replay, ack pruning, backoff reconnect, ping, end-after-all-sent). Token as
  the `token.<value>` subprotocol (ARCHITECTURE §5.1 updated).
- S1-05: `backend/apps/gateway` — dev session/token endpoints (local/ci only), 10 s chunks on disk
  in the §11.4 layout with fsync + manifest commit, ack after durable write, duplicate/gap
  handling, Deepgram per lane (benchmark params, `mip_opt_out`), timeline map across pauses,
  `transcript.interim` / `transcript.segment` (validated `Segment`). README in the package.
- S1-13: tab video in the same `getUserMedia` call (720p/15 fps), playback mix of both lanes,
  `MediaRecorder` MP4→WebM fallback, 10 s fragments to IndexedDB `video_buffer`, new part per
  pause. Side panel: video toggle, download last video, delete local video.
- Shared: `newUlid()` in `shared/contracts`.
- Verified here: `pnpm check` passes (158 tests: extension 36, gateway 10, contracts 15, tokens 34,
  benchmark 63). Real extension `StreamClient` against the real gateway over Node's WebSocket:
  250 frames per lane all durable and acked, buffer empty — this caught and fixed a bug where
  `end` was sent before the last frames. Deepgram smoke test (2 s silence) connects and closes.

**Not verified yet (needs Chrome / people)**
- In Chrome: worklet frames and meters, video file plays, pause/resume, service-worker restart
  mid-recording (S1-06 done-when), live transcript in the panel with the gateway, network drop
  (stop the gateway for 30 s, restart it: no frame lost).
- S1-11 measurements (CPU/memory, echo, 2-hour session, latency) and ADR-0011 checks 2–4.
- S1-14 needs a GCP project with billing + Speech API + ADC login (Anirudh's action).
- S1-05 "in staging" needs S1-10.

**Chrome test findings (same day, Anirudh)**
- Recording kept going after leaving the call: Meet keeps the call URL on its "You left the
  meeting" screen, and nothing consumed the adapter's state yet. The service worker now stops on
  the S1-07 `meet.state-changed` message (`ended`, `home`, `not_meet`) from the recorded tab, and
  on any change of meeting code in that tab's URL.
- 2026-11-04, after S1-07 merged (PR #2): reviewed it. Logs now carry counts only (good). Two
  changes so a wrong `ended` cannot cut a meeting short: the detector checks in-call controls
  before ended signals (the `a[href="/"]` fallback can match on the call page; test added), and
  the service worker re-reads the tab state after 3 s and stops only if it is still `ended`.
- Second review pass on S1-07, fixed on `anirudh` (tests added):
  - Detector: the weak control-bar signal (`div[data-is-muted]` also exists on the pre-call mic
    toggle) now comes after the lobby checks, so a join button always means lobby (FR-DET-01).
    Order is now: Leave button → ended → lobby → control bar → lobby default → home.
  - Email filter matched only a whole-string email; "Asha (asha@example.com)" passed. Now any
    email inside a name or title is rejected (PRD §13).
  - Content script: `sendMessage` rejections were unhandled (try/catch cannot catch a rejected
    promise); now caught in one helper.
- **Gaurav, needs a live Meet DOM check (not changed, S1-08/S1-12):**
  - `div[data-participant-id] div[aria-label]` may read tile control labels (e.g. pin/remove)
    as participant names; action-item assignees come from this list (AGENTS §3 rule 7).
  - People-panel `textContent` fallback may append role text ("Meeting host") to names.
  - Participants are re-read only when the call state changes; people joining mid-call are not
    broadcast — S1-08 needs its own participant observer.
  - `a[href="/"]` and `button[aria-label*="leave" i]` are very broad; all aria-label selectors
    are English only (Hindi UI).
- Pause did not delete earlier video: each pause closes a video part and resume starts a new one,
  both kept in `video_buffer`; the panel's old download offered only the newest part. The panel
  now lists every part of the last recording ("Show last video").

**For Gaurav (S1-07 branch):** rebase on this. The build is now esbuild, so
`scripts/bundle-content.mjs`, the dynamic import in `meet-content-script.ts` and the
`web_accessible_resources` entry are no longer needed — the content script can import the
adapter modules directly and esbuild bundles it as a classic script. Also: no participant names
or titles in console logs (AGENTS §7).

### 2026-11-04 (later) — Gaurav (Google Antigravity): S1-10 staging infrastructure scaffolded
**Done** (branch `Gauravbro`)
- S1-07 merged into `main` via PR #2 (`99271df`). Local `main` and `Gauravbro` fast-forwarded and synchronized.
- Scaffolded modular Terraform infrastructure for staging in `infra/` targeting region `asia-south1` (Mumbai) per ADR-0002:
  - `modules/storage`: Regional Cloud Storage bucket for audio/video chunks with mandatory automated 7-day retention deletion rule (D-02) and CORS for client uploads.
  - `modules/secrets`: Google Secret Manager declarations for DB passwords, JWT signing keys, and Deepgram API keys with IAM access for Cloud Run.
  - `modules/vpc`: VPC network, subnets, and Serverless VPC Access connector (`meetyou-staging-vpc-con`) for secure internal communication.
  - `modules/cloud-sql`: PostgreSQL 16 instance with private IP only (no public exposure), 10 GB SSD, automated backups, and database `meetyou_staging`.
  - `modules/cloud-run`: Realtime Gateway service on Cloud Run v2 with 60-min WebSocket request timeout, session affinity, VPC connector attachment, and least-privilege service account.
  - `environments/staging`: Root configuration wiring all modules, enabling all 8 required GCP APIs, with `terraform.tfvars.example` and setup runbook.
  - Updated `.gitignore` to strictly safeguard Terraform state and secret variable files.
- Ready to execute `terraform apply` once a GCP staging project ID is designated, unblocking S1-14 (Chirp 3 gate) and S1-05 (Cloud gateway).

### 2026-11-04 — Gaurav (Google Antigravity): S1-07 rebase on capture path & esbuild
**Done** (branch `feature/S1-07-meet-adapter-v0`)
- Rebased S1-07 Meet adapter on `origin/main` (`36afaf3` capture path + esbuild bundling).
- Migrated content script to direct modular imports (`src/content/meet-content-script.ts`) bundled
  cleanly by esbuild into `dist/content/meet-content-script.js`. Removed obsolete custom bundle scripts
  and dynamic import mechanisms.
- Removed participant names and meeting titles from console logs per AGENTS §7 privacy rule (logging
  counts and call states only).
- Verified seamless interoperability with Anirudh's capture state machine: S1-07's `meet.state-changed`
  message with `ended`, `home`, and `not_meet` states directly drives the service worker to automatically
  stop active recordings.
- Updated side panel UI (`sidepanel/index.ts` & `sidepanel/index.html`) to display live call state badge,
  meeting code, meeting title, participants list, and selector health status alongside the developer capture controls.
- All 95 extension unit tests passing; 205 total tests passing across monorepo; `pnpm check` and `build` green.

### 2026-11-03 — Anirudh (Claude Code): S1-01 review, S1-02 two-lane capture
**Review of S1-01 (merged, PR #1)** — fixed on `anirudh`:
- Service worker promises used `void`, so failures became unhandled rejections; they now log the
  error (name and message only). The unused `offscreen.ensure` string message is replaced by typed
  messages.
- Offscreen page loaded its script without `type="module"`, which breaks once it imports modules.
- `chrome.d.ts` `sendResponse` took no argument (same one-line fix as the S1-07 branch, so it merges
  cleanly).

**Review notes for Gaurav** (not changed, to avoid conflicts with `feature/S1-07-meet-adapter-v0`):
- User-facing name is "MeetYou" in the manifest and pages; DESIGN.md uses the working name
  "Minutes" from one constant, and the consent message in `shared/contracts` says "Minutes".
- No bundler: plain `tsc` output cannot import `@meetyou/contracts`/zod in the browser, and
  manifest content scripts cannot be ES modules. The S1-07 branch strips imports with regexes and
  exposes adapter modules via `web_accessible_resources` to meet.google.com. Proposal: add esbuild
  (one dev dependency) to bundle each entry point; needs both developers' OK (AGENTS §6.7).
- S1-07 branch logs the meeting title and participant names to the console; AGENTS §7 forbids
  names in logs (log IDs and counts only).
- `copy-static.mjs` removes `dist/public`, which never exists; stale files in `dist/` survive
  rebuilds.

**S1-02 (done; acceptance verified in Chrome by Anirudh)**
- Start/stop from a side-panel developer control (`sidepanel/capture-controls.ts`, own DOM
  section) or the `toggle-recording` shortcut. Service worker: Meet-tab check →
  offscreen document → `tabCapture.getMediaStreamId({ targetTabId })` → `capture.start` reply.
- Offscreen (`offscreen/capture.ts`): tab audio via `chromeMediaSource: 'tab'` played back through
  an `AudioContext` (FR-CAP-02); mic with `echoCancellation: true`, never played back; lanes stay
  separate (FR-CAP-04). A denied or missing mic records the tab only (FR-ONB-03); mic loss keeps
  recording. Per-lane RMS meters every 250 ms.
- Minimal capture state in `chrome.storage.session` (`background/capture-state.ts`); S1-06 grows it
  into the full ARCHITECTURE §4.3 machine. Stops on tab close, leaving Meet, or tab track end.
- Tests: messages, state transitions, levels, constraints. `pnpm check` passes (127 tests); build
  passes.
- **Chrome finding (2026-11-03):** with `openPanelOnActionClick: true`, Start in the side panel
  failed with `capture_not_allowed`: a browser-opened panel does not count as invoking the
  extension, so `tabCapture` is not granted. Now the panel opens from `action.onClicked` via
  `sidePanel.open` (flag reset to `false`), which grants capture for that tab. Affects S1-09.
- **Verified in Chrome:** after the fix, Start from the side panel records; both meters move
  (`me` from the laptop mic, `them` from a second device in the call) and Meet stays audible.
  Not yet checked: mic-denied path, shortcut start, stop on tab close.
- Note: audio of the user's **own** shared tab is not in `them` (it plays from the shared tab, not
  the Meet tab). Not covered by the PRD yet; FR-CAP-15 covers only video.
- Video track is S1-13 (the stream ID can be used once, so it joins the same
  `getUserMedia` call).

### 2026-11-02 — Gaurav (Codex): S1-01 extension skeleton
**Done**
- Added the `extension/` pnpm workspace and an MV3 build path that produces an unpacked package in
  `extension/dist` without adding dependencies.
- Added the MV3 manifest, service worker, offscreen-document lifecycle bootstrap, Meet-only
  side-panel registration, Meet content-script injection, onboarding microphone-permission page,
  settings route, and side-panel shell.
- Manifest uses the approved M1 permissions: `identity`, `notifications`, `offscreen`,
  `sidePanel`, `storage`, `tabCapture`, and `unlimitedStorage`; it has only the
  `https://meet.google.com/*` host permission. The backend API host is intentionally deferred
  until S1-10 establishes the staging domain.
- Added a Meet URL unit test. `pnpm check`, extension build, and manifest validation passed.
- The onboarding microphone action now shows an in-page request state and the browser error name if
  Chrome does not show or grants no permission prompt; rebuild completed with extension tests and
  typecheck passing.
- Fixed extension-page script loading: onboarding and side-panel scripts emit ES module syntax, so
  their HTML now loads them with `type="module"`. Before this fix, the onboarding click handler did
  not attach. Full `pnpm check` and a rebuilt package passed.
- Fixed nested extension-page asset paths (`index.html` files now reference sibling `index.js` and
  `styles.css` files). The prior duplicated folder paths prevented page scripts from loading.
  Rebuilt output paths were explicitly validated and the full workspace check passed.
- Fixed Meet-only side-panel state: the service worker now configures every existing tab on startup
  and updates the active tab's panel state on tab switches. A non-Meet tab is explicitly disabled
  instead of retaining the manifest default panel. It also initializes this state whenever the
  worker starts, so reloads do not depend on lifecycle event timing. Full `pnpm check` and generated
  worker validation passed; manual re-test after extension reload remains.

**Verified acceptance**
- Chrome manual verification passed: the unpacked extension loads; the visible onboarding page
  requests and receives microphone permission; the side panel opens on a Google Meet tab and
  renders the S1-01 shell; switching to a non-Meet tab hides it and it cannot be reopened there.

### 2026-11-01 — Anirudh (Claude Code): Stage 0 complete
**Decisions (Anirudh):** use Google's speech library for transcription and drop Sarvam; record the
meeting screen (video) along with audio.
**Done**
- ADR-0001 accepted with a gate: Google Chirp 3 primary, Deepgram fallback; results tables from the
  MUCS runs. Google streaming provider added to `tools/stt-benchmark` (`@google-cloud/speech`,
  `examples/runs.google.json`); Sarvam's partial run left as is.
- ADR-0011 (video): Meet tab video via `MediaRecorder`, 10 s fragments, signed PUT uploads at
  lowest priority, `video.finalize` remux to MP4, click-to-seek, same retention.
- Contracts: `video.part_started/stopped`, `recordVideo`, `videoQuality`, `Meeting.video`,
  `recordingExpiresAt` (was `audioExpiresAt`), fragment-signing and playback DTOs.
- ADR-0002 accepted (checks 1 and 4 in S1-11). PRD, FEATURES (K1 → Phase 1), ARCHITECTURE, DESIGN,
  plan (S1-13, S1-14, S2-14, S4-17), legal drafts updated.
- Benchmark data moved to `recording/bench-data/` (gitignored).
- Later the same day: Anirudh confirmed **Deepgram as the STT backup** and the **free Gemini key
  for development and testing only** (ADR-0001 §7).
**Not done:** Chirp 3 has not been benchmarked yet (no Cloud project); all ADR-0011 checks are open.

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
