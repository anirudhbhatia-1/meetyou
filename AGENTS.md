# AGENTS.md

Shared instructions for every AI coding agent on this project. Two developers work here:
**Anirudh** (using **Claude Code**) and **Gaurav** (using **Google Antigravity**). Who builds what,
in which order, is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — work only on
tasks owned by your developer unless they say otherwise.

> **Every session:** read [HANDOFF.md](HANDOFF.md) first (shared context, decisions, open
> questions, latest session log). Before ending a session that changed anything, add a session-log
> entry there and update its "Last updated" line. Both tools read this file, so keep it as the
single source of truth for scope, architecture, and working style. If a rule here conflicts with an
agent's default behavior, this file wins.

> **Project status: Stage 0 complete (2026-11-01); Stage 1 in progress.** The pnpm workspace,
> `shared/contracts`, `shared/design-tokens`, and `tools/stt-benchmark` exist; `extension/` (S1-01..)
> and `backend/apps/gateway` (S1-05, local dev) have started. Create other product code only for
> IMPLEMENTATION_PLAN tasks your developer has started.

---

## 1. Communication

- Reply to developers in **Hinglish** (Roman-script Hindi + English technical terms) unless asked
  otherwise.
- Code, code comments, commit messages, PR descriptions, and docs in `docs/` are in **English**.
- Be direct. Say what is verified and what is assumed. Never present a guess as a fact.

---

## 2. What we are building

An AI meeting recorder and summarizer. Bot-free, privacy-first, strong at **Hinglish** and
Indian languages.

Full product requirements, with requirement IDs to reference in code, tests, and PRs:
[docs/PRD.md](docs/PRD.md). Every feature end to end, with workflows and the recommended way to
build it: [docs/FEATURES.md](docs/FEATURES.md). Every screen, component, token, state, and string
of the UI: [docs/DESIGN.md](docs/DESIGN.md) (follow it for all UI work; the prototype HTML is a
reference, not code to ship). **UI design sources are only** DESIGN.md, the Claude Code design
artifact [Minutes app design](https://claude.ai/artifact/P9CqMCqH5VSaRBkRMSczsn), and the handoff
files it lists: no other design sources or UI kits (Anirudh, 2026-11-05). This section is the
short version.

### Phase 1 — Google Meet Chrome extension (current target)
- Chrome Manifest V3 extension, **no meeting bot**.
- **Audio in two separate lanes**, plus **video of the meeting screen** (ADR-0011):
  - `me` — the user's microphone
  - `them` — the Meet tab audio (remote participants)
  - video — the Meet tab's video track with a playback mix of both lanes; never sent to STT/LLM
- Live transcript in a side panel.
- Live notepad: the user's own notes act as **anchors** for the AI summary.
- Post-meeting summary, decisions, and action items, each **citing transcript segments**.
- Recording-consent notice posted in Meet chat when recording starts.
- Library **web app** (D-07): sign in and see your own recordings, transcripts, and summaries from
  any device; search, export, delete (with undo), and a lightweight action-items list (open/done).
- Languages: English, Hindi, Hinglish (code-switching within a sentence).

### Phase 2
Desktop app (macOS first) for Zoom/Teams native apps; cross-meeting search and chat; calendar sync
and pre-meeting briefs; sharing to Slack/Notion/email; MCP server.

### Phase 3
Clips and adaptive video streaming; optional cloud bot; CRM sync and workflow automations; talk-time
analytics; team workspaces, SSO, admin controls.

### Explicitly out of scope (do not build without a decision recorded in `docs/`)
- Clips, highlight reels, or adaptive-streaming video in Phase 1 (screen video itself is in, ADR-0011)
- Cloud meeting bots in Phase 1
- Caption-scraping as the *only* transcript source
- Voiceprint / biometric speaker identification
- Emotion or sentiment inferred from voice or video
- Auto-emailing meeting notes to attendees without the user's explicit action
- Training any model on user data

---

## 3. Architecture rules (non-negotiable)

1. **Capture adapters are separate from the core.**
   Platform-specific code (Google Meet DOM, `tabCapture`, later Zoom/Teams/desktop) lives only in
   adapter modules. The core pipeline must never import or know about a specific platform.
2. **Adapters emit normalized events.** Use the shared event schema (section 4). Adding a new
   platform must mean writing a new adapter, not changing the core.
3. **Providers behind interfaces.** Speech-to-text and LLM vendors (Google Cloud STT, Deepgram, Gemini,
   Claude, etc.) are called only from provider modules that implement a common interface. No vendor
   SDK calls anywhere else.
4. **No secrets in the extension.** The extension never contains API keys. It gets short-lived
   tokens from our backend. Never commit `.env` files, keys, or tokens.
5. **Multi-tenant from day one.** Every persisted record carries a `workspace_id`, even while only
   the developers use the product.
6. **Structured transcripts.** Store segments, not plain text (section 4).
7. **LLM output is structured and grounded.**
   - Validate every LLM response against a JSON schema.
   - The LLM cites **segment IDs** that we supplied. Code maps IDs to timestamps. Never let the
     LLM invent timestamps.
   - Reject or flag citations to segment IDs that do not exist.
   - Action-item assignees and speakers must come from the participant list, or be `"unassigned"`.
8. **Audio retention is configurable** (delete immediately / N days). Stored audio is encrypted
   at rest.
9. **Consent is built in.** Recording start triggers a visible notice and writes a consent log entry.
10. **Track cost per meeting** (STT minutes, LLM tokens) from the first working version.

---

## 4. Shared data shapes (draft — refine before implementing)

### Capture events (adapter → core)
```
session.started      { sessionId, platform, meetingTitle?, startedAt }
participant.joined   { sessionId, participantId, displayName, at }
participant.left     { sessionId, participantId, at }
speaker.active       { sessionId, participantId, at }          // e.g. from Meet DOM
mic.mute_changed     { sessionId, muted, at }                  // me-lane gating (FR-CAP-11)
caption.observed     { sessionId, participantId?, text, at }   // optional naming/timing signal
consent.notice       { sessionId, mode, outcome, text?, at }   // consent log (FR-CON-03)
video.part_started   { sessionId, partId, source, mimeType, width, height, fps, at }  // ADR-0011
video.part_stopped   { sessionId, partId, fragments, reason, at }
session.ended        { sessionId, reason, endedAt }
```
Audio travels as binary frames (`lane u8 | seq u32 | captureMs u32 | payload`, little-endian), not as
an event. **Source of truth:** `shared/contracts` (zod schemas + tests); this block is a summary.

### Transcript segment (stored)
```
{ id, workspaceId, meetingId, lane, speakerId?, speakerName?,
  startMs, endMs, text, rawText, language, words?: [{ text, startMs, endMs }] }
// text = display text (Roman for Hindi/Hinglish, per D-01); rawText = STT provider's original output
```

---

## 5. Repository layout

```
shared/contracts       ✅ zod schemas: capture events, WS protocol, REST DTOs, summary output
shared/design-tokens   ✅ colour/type/radius tokens, tokens.css, bundled fonts, contrast tests
shared/ui              (S4-02) React components + base CSS (DESIGN §6) shared by web/ and the extension pages
shared/hinglish        Hinglish canonical spelling list, Devanagari→Roman, display-text policies
shared/fixtures        (S2-13) synthetic meeting script, recorded gateway sessions + replayer, TTS audio script
tools/stt-benchmark    ✅ STT benchmark: runner, streaming harness, normalizer, scorer
extension/             (Stage 1) Chrome MV3: service worker, offscreen document, side panel (React), Meet adapter (esbuild)
web/                   (S4) library web app, React + Vite; web/server proxies /v1 to the API (mock in Vite dev)
backend/apps/gateway   (S1-05) realtime gateway, local dev
backend/packages/db    (S2-01) Postgres schema, migrations, workspace-scoped access (Kysely)
backend/packages/auth  (S2-02) Google sign-in, JWT access/stream tokens, rotating refresh tokens
backend/packages/providers (S2-03) STT/LLM/transliteration interfaces, Deepgram adapters, registry
backend/packages/queue (S2-06) graphile-worker: transactional enqueue, worker, dead letter
backend/packages/video (S2-14) video.finalize: ffmpeg join/remux/gap fill/poster, queue task
backend/packages/storage Cloud Storage: bucket interface, object layout, video store, V4 signed URLs
backend/apps/api       (S2-08, Gaurav) Fastify REST API
backend/apps/worker    (S2-06) background worker: video.finalize, meeting/account delete, retention sweep, queue depth
backend/apps/smoke     (S2-12) staging smoke job: synthetic speech through gateway → segments via API
backend/packages/log   (S2-11) content-free structured logs (field allow-list, Cloud Logging severity)
docs/                  PRD, features, architecture, design, plan, research, ADRs, benchmark kit, legal drafts,
                       STAGING_SETUP.md (step-by-step cloud setup runbook)
```

Commands (pnpm workspace, Node 24): `pnpm install`, then `pnpm check` (format, lint, typecheck,
tests) before every PR. CI runs the same.

Proposed language: **TypeScript** across extension, backend, and shared code. Confirm with the
developers before scaffolding.

The full end-to-end architecture (components, streaming protocol, pipeline, data, security,
deployment, detailed repo layout and dependency rules) is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Follow it; propose changes through an ADR.

---

## 6. How agents must work

Work like a careful senior engineer pairing with the developer.

1. **Read before editing.** Understand the surrounding code and follow its existing patterns,
   naming, and comment density.
2. **Plan first for anything non-trivial.** Give a short plan listing the files you will touch.
   For large or architectural changes, wait for approval before writing code.
3. **Small, focused changes.** One concern per change. Do not refactor unrelated code or rename
   things "while you are there".
4. **Verify external APIs against current official docs before writing integration code.** Use the
   Context7 MCP server or the vendor's docs. Never guess parameter names, message formats, or
   limits. If you could not verify something, say so in your reply and in a code comment.
5. **Run checks after every change.** Typecheck, lint, and tests. Report results honestly,
   including failures and anything you skipped.
6. **Do not claim something works unless you verified it.** "Should work" is not "done".
7. **Ask before risky or outward-facing actions:**
   - deleting or moving files
   - `git push`, force operations, rewriting history
   - adding a new dependency (explain why it is needed)
   - changing the data schema or event schema
   - calling paid APIs or anything that touches real user data
8. **No fake completeness.** No placeholder implementations presented as finished. Mark unfinished
   work with a clear `TODO(<reason>)`.
9. **Record decisions.** When an architecture decision is made, add or update an ADR in `docs/`
   and update section 9 of this file.

---

## 7. Coding standards

- TypeScript `strict` mode. Avoid `any`. Validate untrusted input at boundaries (zod or similar).
- ESLint + Prettier configs live in the repo; do not override them per file.
- Handle errors explicitly. Never swallow an error silently.
- **Logs must not contain transcript text, audio, names, emails, or tokens.** Log IDs and counts.
- Comments explain *why*, not *what*. Keep them short.
- Tests: Vitest. Unit-test core logic (event handling, segment mapping, citation validation,
  schema validation). Test the audio pipeline with small fixture audio files.

---

## 8. Git workflow

- One branch per feature or fix. Never commit directly to `main`.
- Open a pull request; the **other developer reviews it**, ideally with their own agent (Claude Code
  reviews Antigravity's work and vice versa).
- Short, imperative commit messages in English.
- **Never commit:** secrets, `.env`, recordings or transcripts of real meetings. Test fixtures must
  be synthetic or recorded with everyone's consent.

---

## 9. Decisions log

### Decided
- Google Meet first, via a Chrome MV3 extension; other platforms later via new adapters.
- Phase 1 captures audio as two lanes (`me`, `them`) plus screen video (ADR-0011, 2026-11-01).
- STT and LLM providers are swappable behind interfaces.
- Live streaming transcription, with an optional batch re-transcription pass after the meeting.
- **D-01 (2026-10-28):** Hindi/Hinglish transcripts display in **Roman script** by default. Always
  store the STT provider's original output (`rawText`) alongside the display text. Devanagari
  display may come later as a user setting. If benchmarked transliteration quality is poor, fall
  back to mixed script (Devanagari + Latin English words) for Phase 1.
- **D-02 (2026-10-28):** Audio retention defaults to **7 days**; users can choose "delete
  immediately" or 30 days. "Delete immediately" means after the transcript and summary are
  successfully generated, never before. Retention applies to recordings (audio and, since
  2026-11-01, video); transcripts, notes, and summaries stay until the user deletes them.

- **2026-10-29 — ADRs accepted** (verification items run in Stage 1):
  [ADR-0003](docs/adr/0003-audio-transport-format.md) Opus 24 kbps transport and storage (D-06;
  amended 2026-11-04: WebCodecs encoder in the extension, the gateway wraps Opus in Ogg, no decode);
  [ADR-0004](docs/adr/0004-auth-and-token-model.md) Google sign-in via `launchWebAuthFlow` + PKCE,
  own JWT access / rotating refresh / single-use stream tokens;
  [ADR-0005](docs/adr/0005-job-queue-and-outbox.md) graphile-worker with transactional job creation.

- **2026-11-01 — Stage 0 closed:**
  - [ADR-0001](docs/adr/0001-stt-provider.md) **STT (D-03):** first accepted with Google Chirp 3
    primary (gated) and Deepgram fallback — **superseded 2026-11-05, see below**. **Sarvam dropped**;
    Gemini not used for STT. Free Gemini keys only for public/synthetic benchmark data, never user
    meetings.
  - The **free Gemini key is for development and testing
    only**: synthetic audio/transcripts, public benchmark data, local and CI. Never real meetings
    (the developers' own included); staging and production refuse free keys.
  - [ADR-0002](docs/adr/0002-backend-stack-and-hosting.md) **accepted** — Google Cloud Mumbai
    (Cloud Run, Cloud SQL, Cloud Storage); live checks in S1-11.
  - [ADR-0011](docs/adr/0011-video-screen-recording.md) **video:** Meet tab video recorded with
    audio (setting on by default), fragment upload at lowest priority, MP4 playback with
    click-to-seek, same retention as audio.

- **2026-11-05 — STT is Deepgram only (Anirudh):** **Deepgram Nova-3** is the only STT provider,
  live and post-meeting. **Google Chirp 3 is dropped**; the ADR-0001 gate and S1-14 are cancelled.
  Audio is transcribed in the US (ADR-0001 §0). The provider interface stays.
- **2026-11-05 — D-07 library is a web app from alpha (Anirudh):** recordings, transcripts,
  summaries and notes live on our backend; users sign in on the web app (like Fireflies) and see
  their own meetings from any device. The extension records and links to it. Hosting in ADR-0006.

- **2026-11-06 — Web app stack (Anirudh):** the library web app is **React + Vite** (`web/`),
  built against a mock API until the real endpoints exist. Hosting stays open (ADR-0006).
- **2026-11-06 — UI look (Anirudh):** accent is **orange** (no green); **light theme by default**
  with a Dark switch (Settings → Appearance, side panel menu); the system theme is not followed.
- **2026-11-06 — S2 realtime choices (Anirudh):** gateway session state in Redis through
  **`ioredis`** (in-memory locally); `video.finalize` runs the **`ffmpeg` binary** in the worker;
  Hindi display text stays **as the STT provider returns it** for now (assembler display policy
  `as_provided`; `roman_rules` exists for D-01 and Anirudh will switch later). The free Gemini key
  is still never used on real meetings.

### Open (do not assume an answer)
- LLM for summaries (D-04, ADR-0007). Gemini Flash is a candidate — paid tier only for user data.

---

## 10. Known pitfalls from research (verify before relying on them)

**Chrome extension (MV3)**
- Get a stream ID with `chrome.tabCapture.getMediaStreamId` in the service worker. Then capture in
  an offscreen document (`USER_MEDIA` reason) via `getUserMedia` with `chromeMediaSource: "tab"`.
- Capturing a tab mutes it for the user. Route the captured audio back through an `AudioContext`
  to the speakers.
- An offscreen document cannot show a permission prompt. Request microphone permission once from
  a visible extension page (e.g. onboarding).
- Request the minimum permissions and be ready to justify each one for Chrome Web Store review.
- Keep all Meet DOM selectors in one module, with fallbacks. Expect them to break when Google
  updates Meet.

**STT and LLM vendors**
Full provider research: [docs/STT_PREFLIGHT.md](docs/STT_PREFLIGHT.md).
- Deepgram Nova-3 uses `keyterm` (not `keywords`), passed as repeated query parameters (500-token
  limit, no weights). Mid-stream updates use a `Configure` message with a `keyterms` array. Send
  `KeepAlive` every 3–5 s during silence or the connection closes after ~10 s. Add
  `mip_opt_out=true` to every request.
- Gemini free tier: Google may train on the data and humans may review it, and its terms forbid
  personal information. Use the free key **only for development and testing** with synthetic audio
  or public licensed datasets — never real meetings, even with consent (ADR-0001 §7).
- Gemini live transcription (`gemini-3.5-transcribe-live`): 10-minute session limit, no
  diarization, no word timestamps. Needs overlapping reconnects for long meetings.
- Sarvam trains on API content by default: turn off training in account settings before sending
  any real audio. `translit` mode gives Roman output; streaming interim results are not
  transliterated.
