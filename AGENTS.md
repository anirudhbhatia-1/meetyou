# AGENTS.md

Shared instructions for every AI coding agent on this project. Two developers work here:
**Anirudh** (using **Claude Code**) and **Gaurav** (using **Google Antigravity**). Who builds what,
in which order, is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — work only on
tasks owned by your developer unless they say otherwise. Both tools read this file, so keep it as the
single source of truth for scope, architecture, and working style. If a rule here conflicts with an
agent's default behavior, this file wins.

> **Project status: research & design.** No production code exists yet. Do not scaffold the
> project, install dependencies, or create source files unless a developer explicitly asks.

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
reference, not code to ship). This section is the short version.

### Phase 1 — Google Meet Chrome extension (current target)
- Chrome Manifest V3 extension, **no meeting bot**.
- **Audio only.** Two separate lanes:
  - `me` — the user's microphone
  - `them` — the Meet tab audio (remote participants)
- Live transcript in a side panel.
- Live notepad: the user's own notes act as **anchors** for the AI summary.
- Post-meeting summary, decisions, and action items, each **citing transcript segments**.
- Recording-consent notice posted in Meet chat when recording starts.
- Library with search, export, delete (with undo), and a lightweight action-items list (open/done).
- Languages: English, Hindi, Hinglish (code-switching within a sentence).

### Phase 2
Desktop app (macOS first) for Zoom/Teams native apps; cross-meeting search and chat; calendar sync
and pre-meeting briefs; sharing to Slack/Notion/email; MCP server.

### Phase 3
Video recording and clips; optional cloud bot; CRM sync and workflow automations; talk-time
analytics; team workspaces, SSO, admin controls.

### Explicitly out of scope (do not build without a decision recorded in `docs/`)
- Video capture in Phase 1
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
3. **Providers behind interfaces.** Speech-to-text and LLM vendors (Deepgram, Sarvam, Gemini,
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
audio.chunk          { sessionId, lane: "me" | "them", seq, pcm16k, capturedAt }
caption.observed     { sessionId, participantId?, text, at }   // optional naming/timing signal
session.ended        { sessionId, endedAt }
```

### Transcript segment (stored)
```
{ id, workspaceId, meetingId, lane, speakerId?, speakerName?,
  startMs, endMs, text, rawText, language, words?: [{ text, startMs, endMs }] }
// text = display text (Roman for Hindi/Hinglish, per D-01); rawText = STT provider's original output
```

---

## 5. Proposed repository layout (not created yet)

```
extension/   Chrome MV3: service worker, offscreen document, side panel, Meet adapter
backend/     API, WebSocket relay, STT/LLM providers, processing pipeline
shared/      Event schema and types shared by extension and backend
docs/        Research notes and architecture decision records (ADRs)
```

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
- Phase 1 is audio only, captured as two lanes (`me`, `them`).
- STT and LLM providers are swappable behind interfaces.
- Live streaming transcription, with an optional batch re-transcription pass after the meeting.
- **D-01 (2026-10-28):** Hindi/Hinglish transcripts display in **Roman script** by default. Always
  store the STT provider's original output (`rawText`) alongside the display text. Devanagari
  display may come later as a user setting. If benchmarked transliteration quality is poor, fall
  back to mixed script (Devanagari + Latin English words) for Phase 1.
- **D-02 (2026-10-28):** Audio retention defaults to **7 days**; users can choose "delete
  immediately" or 30 days. "Delete immediately" means after the transcript and summary are
  successfully generated, never before. Retention applies to audio only; transcripts, notes, and
  summaries stay until the user deletes them.

### Open (do not assume an answer)
- STT provider — to be chosen by benchmarking Sarvam, Deepgram Nova-3 multilingual, and Gemini
  Transcribe on our own Hinglish recordings.
- LLM for summaries (Gemini Flash is a candidate).
- Backend hosting: **Option B selected** in
  [ADR-0002](docs/adr/0002-backend-stack-and-hosting.md) — TypeScript/Node on Google Cloud Mumbai
  (Cloud Run, Cloud SQL, Cloud Storage). Verification checks (ADR §9) still pending: do not
  provision infrastructure until the ADR is Accepted.

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
- Gemini free tier: Google may train on the data and humans may review it. Use free keys **only
  with fully synthetic audio** — never real voices or personal information, even with consent.
- Gemini live transcription (`gemini-3.5-transcribe-live`): 10-minute session limit, no
  diarization, no word timestamps. Needs overlapping reconnects for long meetings.
- Sarvam trains on API content by default: turn off training in account settings before sending
  any real audio. `translit` mode gives Roman output; streaming interim results are not
  transliterated.
