# Feature Catalogue — End-to-End

| Field | Value |
|---|---|
| Purpose | Every feature the complete product needs, how it works end to end, how other products do it, and the best way for us to build it |
| Status | Design reference — not an implementation plan |
| Last updated | 2026-10-28 |
| Related | [PRD.md](PRD.md) (requirements and IDs) · [AGENTS.md](../AGENTS.md) (rules) · [STT_PREFLIGHT.md](STT_PREFLIGHT.md) · [STT_BENCHMARK_PLAN.md](STT_BENCHMARK_PLAN.md) |

> **How to read this.** Each feature has: *What*, *Workflow*, *How others do it*, *Best way for us*,
> and *Pitfalls*. **Phase** follows the PRD (1 = Meet extension, 2 = breadth and memory,
> 3 = business). Where a PRD requirement exists, its ID is listed. "How others do it" describes
> **publicly visible product behavior**; vendors do not document their internals, so anything about
> internals is labelled *reported* or *likely*. Ideas only — we do not copy code, UI, or branding.

---

## Contents

0. [The product end to end](#0-the-product-end-to-end)
1. [Feature index](#1-feature-index)
2. [A. Foundation](#a-foundation)
3. [B. Before the meeting](#b-before-the-meeting)
4. [C. Capture](#c-capture)
5. [D. Transcription](#d-transcription)
6. [E. During the meeting](#e-during-the-meeting)
7. [F. After the meeting — notes and summary](#f-after-the-meeting--notes-and-summary)
8. [G. Sharing and collaboration](#g-sharing-and-collaboration)
9. [H. Memory and search](#h-memory-and-search)
10. [I. Integrations and automation](#i-integrations-and-automation)
11. [J. Conversation intelligence](#j-conversation-intelligence)
12. [K. Video](#k-video)
13. [L. Privacy, security, and compliance features](#l-privacy-security-and-compliance-features)
14. [M. Teams, admin, and enterprise](#m-teams-admin-and-enterprise)
15. [N. Plans, billing, and usage](#n-plans-billing-and-usage)
16. [O. Platform and operations](#o-platform-and-operations)
17. [Build order and dependencies](#build-order-and-dependencies)
18. [Definition of "complete"](#definition-of-complete)

---

## 0. The product end to end

```
 BEFORE                 DURING                         AFTER                         LATER
 ──────                 ──────                         ─────                         ─────
 Sign-in & settings     Detect meeting                 Finalize transcript           Library & search
 Calendar sync (P2)  →  Start recording (user)      →  Batch re-pass (optional)   →  Cross-meeting chat (P2)
 Pre-meeting brief(P2)  Consent notice                 Speaker naming                Action-item tracker (P2)
                        Two-lane capture (me/them)     Summary + citations           Integrations (P2/P3)
                        Live transcript                Templates, edit, regenerate   MCP server (P2)
                        Live notepad (anchors)         Copy / export / share         Analytics (P3)
                        Highlights (P2)                Follow-up draft (P2)          Retention & deletion
                        Live Q&A (P2)                  Notifications                 Admin & billing (P3)
```

Every arrow passes through the same **platform-agnostic core**. Capture is the only part that
changes per platform (Meet extension, desktop app, bot, file upload).

---

## 1. Feature index

| ID | Feature | Phase | PRD refs |
|---|---|---|---|
| **A. Foundation** ||||
| A1 | Sign-in and accounts | 1 | FR-ONB-02 |
| A2 | Workspaces and multi-tenancy | 1 (data) / 3 (teams) | FR-ONB-05 |
| A3 | Onboarding and permissions | 1 | FR-ONB-01..06 |
| A4 | Settings and preferences | 1 | FR-SET-05 |
| **B. Before the meeting** ||||
| B1 | Meeting detection | 1 | FR-DET-01..05 |
| B2 | Calendar sync | 2 | — |
| B3 | Recording rules (auto-prompt / auto-start) | 2 | — |
| B4 | Pre-meeting brief | 2 | — |
| **C. Capture** ||||
| C1 | Google Meet extension capture (two lanes) | 1 | FR-CAP-01..11 |
| C2 | Recording controls and indicator | 1 | FR-REC-01..08 |
| C3 | Consent notice and consent log | 1 | FR-CON-01..04 |
| C4 | Resilience: buffering, reconnect, crash recovery | 1 | FR-CAP-07/08, NFR-REL |
| C5 | File upload / import | 2 | — |
| C6 | Desktop app capture (macOS, Windows) | 2 | — |
| C7 | Cloud meeting bot | 3 | — |
| C8 | Mobile and in-person recording | 3+ | — |
| **D. Transcription** ||||
| D1 | Live streaming transcription | 1 | FR-LIV-01..07 |
| D2 | Post-meeting batch re-transcription | 1 (P1) | FR-PROC-02 |
| D3 | Multilingual, code-switching, Roman display | 1 | ML-01..08 |
| D4 | Vocabulary boosting | 1 (P1) | ML-06, STT-05 |
| D5 | Speaker attribution and diarization | 1 | FR-SPK-01..06 |
| D6 | Transcript viewer and editor | 1 / 2 | FR-LIB-02 |
| **E. During the meeting** ||||
| E1 | Live transcript panel | 1 | FR-LIV |
| E2 | Live notepad with anchors | 1 | FR-NOTE-01..06 |
| E3 | Highlights / bookmarks | 2 | — |
| E4 | Live AI Q&A and "catch me up" | 2 | — |
| **F. After the meeting** ||||
| F1 | Summary generation pipeline | 1 | FR-PROC, FR-SUM |
| F2 | Anchored notes (user notes + AI detail) | 1 | FR-NOTE-04, AI-01 |
| F3 | Decisions, action items, open questions | 1 | FR-SUM-01..03 |
| F4 | Citations and verification | 1 | FR-CIT-01..04 |
| F5 | Templates | 1 (P1) | FR-SUM-06 |
| F6 | Edit, regenerate, feedback | 1 (P1) | FR-SUM-07..09 |
| F7 | Output language | 1 | FR-SUM-05 |
| F8 | Follow-up email / message draft | 2 | — |
| F9 | Chapters and topic timeline | 2 | — |
| F10 | Audio playback synced to transcript | 1 (P1) | FR-CIT-03 |
| **G. Sharing and collaboration** ||||
| G1 | Copy and export | 1 | FR-EXP-01..04 |
| G2 | Share links and permissions | 2 | — |
| G3 | Comments and reactions | 3 | — |
| G4 | Team workspaces and shared folders | 3 | — |
| **H. Memory and search** ||||
| H1 | Meeting library | 1 | FR-LIB-01..05 |
| H2 | Keyword search | 1 (P1) | FR-LIB-03 |
| H3 | Cross-meeting AI chat (RAG) | 2 | — |
| H4 | Action-item tracker across meetings | 1 (list, open/done) / 2 (suggestions, digest) | FR-LIB-06 |
| H5 | People and company pages | 3 | — |
| **I. Integrations and automation** ||||
| I1 | Slack, Notion, Google Docs, email delivery | 2 | — |
| I2 | MCP server | 2 | — |
| I3 | Public API and webhooks | 2 / 3 | — |
| I4 | CRM / ATS / project-tool sync | 3 | — |
| I5 | Workflow automations (rules engine) | 3 | — |
| **J. Conversation intelligence** ||||
| J1 | Talk-time and meeting analytics | 3 | — |
| J2 | Topic and keyword trackers | 3 | — |
| **K. Video** ||||
| K1 | Video recording, storage, playback | 3 | — |
| K2 | Clips and soundbites | 3 | — |
| **L. Privacy and security** ||||
| L1 | Retention controls | 1 | FR-SET-01 |
| L2 | Deletion and data export | 1 | FR-SET-02..04 |
| L3 | No-training guarantee and sub-processor transparency | 1 | PRV-01, FR-SET-06 |
| L4 | PII redaction | 3 | — |
| L5 | Encryption and access control | 1 | SEC-01..10 |
| **M. Teams and enterprise** ||||
| M1 | Roles and permissions | 3 | — |
| M2 | SSO and SCIM | 3 | — |
| M3 | Org policies (recording, retention, consent) | 3 | — |
| M4 | Audit logs | 3 | SEC-09 |
| M5 | Data residency | 3 | — |
| **N. Plans and billing** ||||
| N1 | Plans, limits, and usage metering | 2 | — |
| N2 | Payments and invoicing | 2 | — |
| **O. Platform and operations** ||||
| O1 | Notifications | 1 / 2 | — |
| O2 | Observability and health | 1 | NFR-OBS |
| O3 | Cost tracking | 1 | FR-PROC-06 |
| O4 | Quality evaluation loop | 1 | §14.6 |
| O5 | Product analytics | 1 | §19.6 |
| O6 | Meet DOM health monitoring | 1 | §11.7 |
| O7 | Support and diagnostics | 2 | — |

---

## A. Foundation

### A1. Sign-in and accounts
**Phase 1** · PRD FR-ONB-02

**What.** The user signs in so meetings are stored in their account and available across devices.

**Workflow.**
1. User clicks "Sign in with Google" on the onboarding page.
2. Google returns an identity token (email, name, profile).
3. Backend creates or finds the user and their personal workspace and issues our own session.
4. The extension stores a short-lived access token and a refresh mechanism.

**How others do it.** Almost every tool (Fireflies, Otter, Granola, Fathom) offers Google and
Microsoft sign-in. Calendar access is often requested at sign-in to enable auto-join.

**Best way for us.**
- Phase 1: Google sign-in with **only `openid email profile`**. Do not request Calendar at sign-in;
  ask later when the user turns on calendar features (B2). Smaller scope = faster Google
  verification and more trust.
- Add Microsoft sign-in in Phase 2 together with the desktop app (Teams users).
- Our backend issues its own short-lived tokens; never rely on the Google token for API access.

**Pitfalls.** Requesting sensitive scopes early triggers OAuth verification delays and scares users.

---

### A2. Workspaces and multi-tenancy
**Phase 1 (data model) / Phase 3 (team features)** · PRD FR-ONB-05

**What.** Every piece of data belongs to a workspace. Phase 1 has one personal workspace per user;
later, teams share a workspace.

**Workflow.** Sign-up creates `workspace` + `membership(owner)`. Every query is scoped by
`workspace_id`.

**How others do it.** Team tools (Fireflies, Otter Business, Circleback) have team workspaces with
shared libraries. Products that start single-user often struggle to add teams later.

**Best way for us.** Put `workspace_id` on every row from day one and enforce it in the data layer
(e.g. database row-level security or a mandatory repository filter), not in each endpoint.

**Pitfalls.** Retrofitting tenancy later is one of the most expensive migrations there is.

---

### A3. Onboarding and permissions
**Phase 1** · PRD FR-ONB-01..06

**What.** First-run flow that explains what is recorded, gets microphone permission, and collects
preferences.

**Workflow.**
1. Extension installed → onboarding page opens.
2. Plain-language explanation: mic + Meet tab audio, where it is processed, retention.
3. Google sign-in.
4. **Microphone permission prompt on this visible page** (the hidden offscreen document cannot ask).
5. Preferences: transcript language mode, summary language, retention (default 7 days), consent
   notice mode.
6. Consent responsibility acknowledgment.
7. "Record your first meeting" guide.

**How others do it.** Bluedot/Scribbl-style extensions walk users through mic and tab permissions.
Granola's desktop onboarding asks for system-audio/screen permissions with explainer screens.

**Best way for us.** Keep it under 60 seconds. Make the privacy explanation short and visual. Allow
skipping preferences (defaults apply). If mic permission is denied, still allow `them`-only
recording and explain how to fix it.

**Pitfalls.** If mic permission is not granted on a visible page first, recording fails later with
no prompt shown.

---

### A4. Settings and preferences
**Phase 1** · PRD FR-SET-05

**What.** One place for language, templates, retention, consent mode, "follow Meet mute", privacy
actions, and connected apps.

**Best way for us.** Group into *Recording*, *Language*, *Notes*, *Privacy & data*, *Connected apps*
(Phase 2). Every privacy setting shows its effect in plain words ("Audio is deleted 7 days after
the meeting").

---

## B. Before the meeting

### B1. Meeting detection
**Phase 1** · PRD FR-DET-01..05

**What.** Know when the user is in a Meet call so we can offer to record.

**Workflow.**
1. Content script runs on `meet.google.com`.
2. It checks the URL pattern (`xxx-xxxx-xxx`) and in-call UI state (not the lobby).
3. On joining, it shows a small "Start recording" chip.
4. It watches for leave/end and tab close to end the session.

**How others do it.**
- Extensions (Tactiq, Bluedot, Scribbl) detect the Meet page and in-call DOM state.
- Granola (desktop) reportedly notifies about one minute before calendar events and also detects
  meetings when the microphone becomes active.
- Bots rely on the calendar instead of detection.

**Best way for us.** DOM-based detection in one adapter module with multiple fallback signals
(URL + presence of in-call controls + leave button). Never auto-start in Phase 1. In Phase 2,
combine with calendar events (B2) so the prompt can include the event title.

**Pitfalls.** Meet UI changes break selectors — monitor them (O6). Do not trigger in the lobby or on
the Meet home page.

---

### B2. Calendar sync
**Phase 2**

**What.** Read the user's calendar to know upcoming meetings, titles, attendees, and links.

**Workflow.**
1. User connects Google Calendar (separate consent from sign-in).
2. Backend does an initial sync, then registers a push notification channel.
3. On change notifications, backend fetches deltas using a sync token.
4. Events with a Meet link and 2+ attendees become "upcoming meetings".
5. Scheduled jobs run shortly before each start time (Calendar has no "event started" webhook).

**How others do it.** Fireflies, Otter, Fathom, Circleback, and Granola all sync Google and
Microsoft calendars. Bot tools use it to schedule bots; Granola uses it for notifications and
attendee names.

**Best way for us.**
- Request the narrowest scope (read-only events). Calendar scopes are "sensitive" in Google's
  OAuth review — budget time for verification.
- Use push channels + incremental sync tokens; renew channels before they expire; run a periodic
  full resync as a safety net.
- Attendee names and emails feed speaker naming (D5) and vocabulary boosting (D4).
- Add Microsoft Graph calendar with the desktop app.

**Pitfalls.** Channels expire silently; recurring events and time zones cause most bugs.

---

### B3. Recording rules (auto-prompt / auto-start)
**Phase 2**

**What.** User-defined rules such as "prompt for all meetings with external attendees" or
"auto-start for my standups".

**How others do it.** Fireflies offers auto-join rules (all meetings, only meetings I host, etc.)
and incentivizes auto-join. This drives growth but also consent complaints.

**Best way for us.** Default remains *prompt, never auto-start*. Offer auto-start only for meetings
the user owns and only with the consent notice on. Rules evaluate calendar attributes (organizer,
internal/external domains, title keywords).

**Pitfalls.** Auto-recording external meetings by default is a legal and trust risk.

---

### B4. Pre-meeting brief
**Phase 2**

**What.** A short brief before a meeting: who is attending, what was discussed last time with them,
open action items, and open questions.

**Workflow.**
1. A job runs ~10–15 minutes before an event with known attendees.
2. It retrieves past meetings with the same attendees or company domain (H3 retrieval).
3. It collects open action items involving them (H4).
4. LLM writes a brief with citations to past meetings.
5. Delivered as a notification or in the side panel when the meeting starts.

**How others do it.** Granola ("Brief") and Fireflies ("Meeting Prep") generate briefs from past
meetings and attendee context.

**Best way for us.** Only from the user's own workspace data in Phase 2 (no web scraping of people).
Every line cites a past meeting. Skip the brief when there is no history.

---

## C. Capture

### C1. Google Meet extension capture (two lanes)
**Phase 1** · PRD FR-CAP-01..11

**What.** Record the meeting without a bot by capturing two separate audio lanes inside Chrome.

**Workflow.**
1. User clicks Start (user gesture).
2. Service worker gets a tab-capture stream ID for the Meet tab.
3. An offscreen document opens the tab audio (`them`) and the microphone (`me`, echo cancellation on).
4. Tab audio is routed back to the speakers so the user still hears the meeting.
5. An AudioWorklet converts each lane to 16 kHz mono PCM.
6. Chunks go to (a) the backend over an authenticated WebSocket and (b) a local IndexedDB buffer.
7. If retention is on, each lane is also encoded to Opus and uploaded for storage.

**How others do it.**
- **Bluedot, Scribbl:** Chrome extensions capturing tab audio (and video) plus mic; speaker names
  from the Meet page.
- **Tactiq:** does not capture audio; reads Meet's live captions from the page.
- **Granola:** desktop app capturing system audio + mic on separate channels ("me" / "them").
- **Bot tools:** a headless browser joins as a participant and records what it hears.

**Best way for us.** Exactly the two-lane extension approach above, with the capture logic in the
Meet adapter and everything else platform-agnostic. Use captions only as an optional naming signal,
never as the transcript.

**Pitfalls.**
- Capturing a tab mutes it for the user unless audio is played back.
- Offscreen documents cannot prompt for mic permission.
- Laptop speakers leak remote voices into the mic → rely on echo cancellation and de-duplicate
  overlapping text across lanes.
- Which UI clicks count as the user gesture for tab capture must be verified (M1 spike).

---

### C2. Recording controls and indicator
**Phase 1** · PRD FR-REC-01..08

**What.** Start, pause, resume, stop, and an always-visible state.

**Workflow.** States: `idle → recording ⇄ paused → stopping → processing → ready` plus
`reconnecting` and `error`. The toolbar badge and side panel always show the state in color and text.

**How others do it.** Extensions show a badge and a floating control; bots show up in the
participant list as the indicator.

**Best way for us.** One state machine shared by the badge, side panel, and in-page chip. Paused
means *nothing* is sent or stored. One active recording at a time. Session cap (e.g. 4 h) with a
warning.

---

### C3. Consent notice and consent log
**Phase 1** · PRD FR-CON-01..04

**What.** Tell participants the meeting is being transcribed, and keep a record that we did.

**Workflow.**
1. Recording starts.
2. Depending on mode: one-click send (default), automatic, or off (needs extra confirmation).
3. The adapter types the notice into Meet chat and sends it.
4. A consent-log entry stores time, mode, and text.
5. "Stop and delete" is always one click away if someone objects.

**How others do it.** Bot tools are visible in the participant list and can post chat messages or
send pre-meeting emails. Bot-free tools mostly leave disclosure to the user, which has drawn
criticism.

**Best way for us.** Make disclosure the easy default without being spammy: editable text in English
and Hinglish, one click to send. Show the consent log on the meeting page. This is a real
differentiator for business buyers.

**Pitfalls.** Posting in Meet chat relies on DOM automation — keep it in the adapter with fallbacks;
if posting fails, tell the user and show the text to paste.

---

### C4. Resilience: buffering, reconnect, crash recovery
**Phase 1** · PRD FR-CAP-07/08, NFR-REL-01..05

**What.** Never lose audio because of Wi-Fi drops, provider outages, or crashes.

**Workflow.**
1. Every chunk is written to IndexedDB with a sequence number before sending.
2. The backend acknowledges chunks; acknowledged chunks are pruned locally.
3. On disconnect, capture continues; the UI shows "Reconnecting — audio saved locally".
4. On reconnect, unacknowledged chunks are replayed in order.
5. After a crash, the next launch finds unfinished sessions and offers recovery.
6. Backend side: STT provider sessions are reconnected with overlap (e.g. Gemini's 10-minute limit,
   Deepgram's 10-second idle timeout handled with keep-alives).

**How others do it.** Desktop recorders write to disk continuously; bot platforms write fragmented
media files to cloud storage so a crash does not corrupt the recording.

**Best way for us.** Sequence numbers + acknowledgements end to end (extension → relay → storage).
Idempotent processing so replays never duplicate segments. If STT is down, keep recording and
transcribe later from stored audio.

---

### C5. File upload / import
**Phase 2**

**What.** Upload an existing recording (MP3, M4A, WAV, MP4, WhatsApp voice notes) and get the same
transcript and notes.

**Workflow.** Upload → virus/format check → convert to 16 kHz mono → batch STT with diarization →
same summary pipeline → appears in the library.

**How others do it.** Fireflies, Otter, and others accept uploads (often with size/length limits).

**Best way for us.** Cheap to build because the batch path (D2) already exists. It immediately covers
in-person meetings, phone calls, and other platforms before the desktop app ships. Single-lane
input means diarization is required; ask the user for participant names to label speakers.

---

### C6. Desktop app capture (macOS, Windows)
**Phase 2**

**What.** Record Zoom, Teams, Webex, Slack Huddles, Meet in any browser, and in-person meetings.

**Workflow.**
1. App detects a meeting (microphone in use by a meeting app, plus calendar events).
2. Prompts to record.
3. Captures **system audio** (preferably only the meeting app's audio) as `them` and the **mic** as `me`.
4. Same normalized events and streaming as the extension.

**How others do it.**
- **Granola:** native desktop capture of system audio + mic; transcript only, audio not kept.
- **Otter / Fireflies desktop:** bot-free desktop modes.
- **Recall.ai Desktop SDK:** a commercial SDK that detects meeting windows and records them.

**Best way for us.**
- **macOS:** Core Audio process taps (macOS 14.2+) to capture only the meeting app's audio, with a
  permission scoped to audio rather than screen recording. Capture the mic through Core Audio directly,
  **preferring the built-in mic** so Bluetooth headsets are not forced into low-quality call mode.
  Apply echo cancellation using the system lane as the reference.
- **Windows:** WASAPI loopback, preferably **process-specific loopback** for the meeting app, plus a
  separate mic capture.
- Decide native app vs cross-platform shell with a native audio module in an ADR; buy (SDK) vs build
  is also an ADR.

**Pitfalls.** AirPods switching to call-quality mode, virtual audio devices, device hot-swaps,
sleep/wake mid-meeting, and system notification sounds leaking into the recording.

---

### C7. Cloud meeting bot
**Phase 3 (optional)**

**What.** A bot joins the call as a participant and records audio/video — for users who want video,
want to record meetings they do not attend, or cannot install software.

**Workflow.** Calendar event → shortly before start, launch an isolated headless browser → join with
a bot name → wait in lobby (timeout) → record → post consent notice → leave when the call ends →
upload media → same pipeline.

**How others do it.** Fireflies, Otter, Fathom, Read AI, Circleback run bots, often via headless
Chromium in containers; many companies use **Recall.ai** instead of running their own fleet.

**Best way for us.** **Buy first** (bot API provider) — running bot fleets means fighting platform
UI changes, login blocks, and container costs. Revisit building only at scale. Bot is opt-in per
meeting, branded clearly, and always posts a consent notice.

**Pitfalls.** Platform terms (e.g. Zoom's rules for SDK bots joining external meetings) change —
check before building.

---

### C8. Mobile and in-person recording
**Phase 3+**

**What.** Record in-person meetings and calls from a phone.

**How others do it.** Otter, Fireflies, Bluedot, and Circleback have mobile apps; Plaud sells a
hardware recorder.

**Best way for us.** Start with file upload (C5) and the desktop app for in-person. A mobile app
comes later, reusing the batch pipeline; background recording limits on iOS/Android need care.

---

## D. Transcription

### D1. Live streaming transcription
**Phase 1** · PRD FR-LIV-01..07

**What.** Transcribe both lanes in real time and show the text in the side panel.

**Workflow.**
1. Relay opens one STT session per lane with the configured provider.
2. Audio chunks are forwarded; interim and final results come back.
3. Transcript assembler turns finals into segments with IDs, lane, timestamps, language.
4. Segments stream to the side panel; interim text is shown lighter and replaced in place.

**How others do it.** Otter and Tactiq show live transcripts; Granola transcribes live but shows it
on demand; bots stream to STT providers.

**Best way for us.** Provider-swappable STT interface; choice decided by the benchmark (D-03).
Handle provider limits in the relay (keep-alives, 10-minute reconnects with overlap). Show
connection health in the UI.

---

### D2. Post-meeting batch re-transcription
**Phase 1 (P1)** · PRD FR-PROC-02

**What.** After the meeting, re-transcribe stored audio with a batch model for higher accuracy and
better diarization.

**Workflow.** Session ends → summary generated from the live transcript (fast) → batch job runs on
stored audio → if the batch transcript differs materially, segments are replaced and the summary is
quietly regenerated → user is told.

**How others do it.** Tools that keep audio can reprocess; Granola deletes audio, so it cannot.

**Best way for us.** Only possible because of the 7-day retention default (D-02). Keep segment IDs
stable where text overlaps so citations survive. Batch provider can differ from the streaming
provider (hybrid).

---

### D3. Multilingual, code-switching, Roman display
**Phase 1** · PRD ML-01..08, decision D-01

**What.** Handle English, Hindi, and Hinglish — including language switches within a sentence — and
show Hindi/Hinglish in Roman script by default.

**Workflow.**
1. Language mode: auto (default) or fixed.
2. STT returns text (possibly Devanagari).
3. Pipeline produces **display text in Roman** and keeps the provider's **original output** (`raw_text`).
4. Summaries are generated in the user's chosen language, independent of transcript language.

**How others do it.** Most global tools focus on English; Fireflies and Circleback claim 100+
languages but code-switched Hinglish quality varies. Indian-language providers (e.g. Sarvam) offer
native Roman (`translit`) and mixed-script (`codemix`) output modes.

**Best way for us.** Prefer a provider that outputs Roman natively for finals; transliterate interim
text ourselves if needed. Maintain a **canonical Hinglish spelling list** (from the benchmark) to
normalize variants. Make search script-insensitive later (H2/H3).

---

### D4. Vocabulary boosting
**Phase 1 (P1)** · PRD ML-06, STT-05

**What.** Improve spelling of names and domain terms.

**Workflow.** Collect terms (participant names from Meet, calendar attendees in Phase 2, workspace
glossary, user-typed note words) → pass to the provider's boosting parameter at session start →
update mid-session where supported.

**How others do it.** Providers expose this differently (Deepgram `keyterm`, Sarvam `keyterms`,
Gemini `custom_vocabulary`); meeting tools feed calendar attendees and CRM names.

**Best way for us.** A per-workspace **glossary** the user can edit, plus automatic terms per
meeting. Keep within each provider's limits (e.g. Deepgram's token budget). Measure the effect in the
benchmark before relying on it.

---

### D5. Speaker attribution and diarization
**Phase 1** · PRD FR-SPK-01..06

**What.** Know who said what.

**Workflow.**
1. `me` lane → the signed-in user (always correct by construction).
2. `them` lane → provider diarization gives clusters (Speaker 1, 2…), batch if streaming lacks it.
3. Adapter emits `speaker.active` events from Meet's active-speaker indicator.
4. Speaker resolver aligns clusters with active-speaker timestamps → names.
5. User can rename a speaker; it applies to the whole meeting.

**How others do it.**
- Bots read active-speaker info directly from the meeting UI or SDK → accurate names.
- Tactiq takes names from Meet captions.
- Desktop tools combine diarization with calendar attendees and, reportedly, window/accessibility
  signals.

**Best way for us.** Two lanes + DOM active-speaker signal + batch diarization. Optional caption
observation as an extra signal. **No voiceprints** across meetings (privacy and biometric law).

**Pitfalls.** Overlapping speech and people who speak while someone else's tile is highlighted;
measure accuracy on the benchmark's multi-person clips.

---

### D6. Transcript viewer and editor
**Phase 1 (view) / Phase 2 (edit)** · PRD FR-LIB-02

**What.** Read the full transcript with speakers and times; later, correct mistakes.

**How others do it.** Otter and Fireflies have searchable transcripts with click-to-play; Otter
allows editing.

**Best way for us.** Phase 1: read-only, searchable, click a line to play audio (if retained).
Phase 2: inline editing that keeps segment IDs (so citations survive) and feeds corrections into the
glossary.

---

## E. During the meeting

### E1. Live transcript panel
**Phase 1** · PRD FR-LIV

**What.** Side panel tab showing the live transcript.

**Best way for us.** Auto-scroll with "jump to live", speaker labels, lighter interim text, health
indicator, and pause marker. Must not slow down Meet.

---

### E2. Live notepad with anchors
**Phase 1** · PRD FR-NOTE-01..06

**What.** A notepad where the user writes short notes; after the meeting, each note becomes an anchor
the AI expands with detail from the transcript.

**Workflow.**
1. User types notes during the call (`DECISION: launch 15 Nov`, `ACTION: Rahul pricing sheet`).
2. Each line is timestamped with the session time and autosaved locally and remotely.
3. Markers (`DECISION:`, `ACTION:`, `QUESTION:`, `IMPORTANT:`) are recognized.
4. After the meeting, notes + transcript go to the summary pipeline (F2).

**How others do it.** **Granola** pioneered this: the user's notes stay as written (darker text) and
AI-added detail appears under them (lighter text), each traceable to the transcript.

**Best way for us.** Same idea, plus note timestamps to locate the relevant transcript window, and
Hinglish marker aliases (e.g. "faisla:", "kaam:") — to be decided. User text is never rewritten.

---

### E3. Highlights / bookmarks
**Phase 2**

**What.** One click (or shortcut) to mark "this moment matters".

**How others do it.** Fathom and Otter let users highlight moments during the call; highlights
appear in the summary and become clips (with video).

**Best way for us.** A highlight is just a timestamped note with an `important` marker, so it reuses
E2 and F2 — no new pipeline.

---

### E4. Live AI Q&A and "catch me up"
**Phase 2**

**What.** Ask questions during the meeting ("What did they say about pricing?") or get a 3-line
recap when joining late.

**How others do it.** Fireflies ("Talk to Fireflies") and Otter offer in-meeting AI chat.

**Best way for us.** Retrieve from the live transcript so far (segments with IDs) and answer with
citations. Rate-limit to control cost. Answers are private to the user.

---

## F. After the meeting — notes and summary

### F1. Summary generation pipeline
**Phase 1** · PRD FR-PROC-01..06, FR-SUM-01

**What.** Turn transcript + notes into structured notes within ~60 seconds.

**Workflow.**
1. Session ends → finalize transcript.
2. Build the prompt: metadata, participants with IDs, notes with IDs/timestamps, segments formatted
   as `[seg_id] (mm:ss) Speaker: text`, template, output language.
3. Single-pass LLM call for typical meetings; chunked processing only above a token threshold.
4. Validate JSON against the schema; retry once on failure.
5. Validate citations and owners (F4, F3).
6. Store a new summary version; notify the user (O1).

**How others do it.** First-generation tools summarized the whole transcript generically. Newer
tools (Granola, Circleback) produce structured, cited notes; many use templates per meeting type.

**Best way for us.** Structured JSON output with segment-ID citations, schema validation, and
provider-swappable LLMs. Modern context windows fit an hour-long meeting in one pass — avoid
map-reduce by default because it loses cross-section context.

---

### F2. Anchored notes (user notes + AI detail)
**Phase 1** · PRD FR-NOTE-04, AI-01

**What.** User notes appear verbatim as headings/bullets; AI adds supporting detail beneath.

**Workflow.** For each note, the model looks at the transcript around the note's timestamp and
across the meeting, then adds cited detail. Notes with no supporting transcript stay as-is with a
"no discussion found" hint.

**Best way for us.** Distinct styling for user vs AI text everywhere (UI-01). Without notes, fall
back to topic-based sections.

---

### F3. Decisions, action items, open questions
**Phase 1** · PRD FR-SUM-01..03

**What.** Extract what was decided, who does what by when, and what is still open.

**How others do it.** Circleback is known for precise action items with owners; Fireflies and Fathom
list action items and push them to tools.

**Best way for us.**
- Owners only from the participant list, else `unassigned`.
- Only explicit agreement counts as a decision (not proposals).
- Due dates only when stated; resolve relative dates ("next Monday") using the meeting date.
- Each item cites segments; uncited items are dropped or flagged.

---

### F4. Citations and verification
**Phase 1** · PRD FR-CIT-01..04

**What.** Every AI-generated point links to the exact transcript lines it came from.

**Workflow.** LLM returns segment IDs → code checks they exist → UI shows a marker → hover shows the
quote, speaker, and time → click jumps to transcript/audio.

**How others do it.** Granola and Circleback show the source quote behind AI notes.

**Best way for us.** Never let the LLM produce timestamps; map IDs to times in code. Later (P2),
flag numbers/dates/names in AI text that do not appear in the cited segments.

---

### F5. Templates
**Phase 1 (P1)** · PRD FR-SUM-06

**What.** Shape the notes for the meeting type: General, Standup, Client/Sales, Interview, 1:1.
Later: custom templates.

**How others do it.** Granola "Recipes" (slash commands), Fireflies "AI Skills" (200+ prompt
pipelines), Fathom templates.

**Best way for us.** A template = sections + emphasis rules + output schema extensions, stored as data
(not code). Start with 5 built-in templates; custom templates in Phase 2 with a preview before saving.

---

### F6. Edit, regenerate, feedback
**Phase 1 (P1)** · PRD FR-SUM-07..09

**What.** Edit any text inline, regenerate with another template or language, and rate quality.

**Best way for us.** Summaries are versioned. Edited items are marked `user_edited` and preserved on
regeneration where possible. Thumbs up/down on the summary and on each action item feed quality
metrics (O4) — never third-party training.

---

### F7. Output language
**Phase 1** · PRD FR-SUM-05

**What.** Summary in English, Hindi, or Hinglish regardless of the transcript language.

**Best way for us.** User default plus per-meeting override; regenerate in another language on demand.

---

### F8. Follow-up email / message draft
**Phase 2**

**What.** One click to draft a recap email or Slack/WhatsApp message.

**How others do it.** Many tools draft follow-ups; Fireflies emails recaps to attendees
automatically (good for growth, bad for consent).

**Best way for us.** Draft only. The user copies it or opens it in their own email client (Gmail
compose link / `mailto:`). **Never auto-send.**

---

### F9. Chapters and topic timeline
**Phase 2**

**What.** The meeting split into titled sections with time ranges.

**How others do it.** tl;dv, Fathom, and Otter show topic outlines or chapters.

**Best way for us.** Generated in the same LLM call as the summary (segment-ID ranges), shown as a
clickable timeline above the transcript.

---

### F10. Audio playback synced to transcript
**Phase 1 (P1)** · PRD FR-CIT-03

**What.** Play audio from any line or citation; highlight the current line while playing.

**Best way for us.** Signed, expiring URLs; per-lane audio mixed in the player (or a mixed rendition
created after the meeting). Only available within the retention window — UI shows when audio expires.

---

## G. Sharing and collaboration

### G1. Copy and export
**Phase 1** · PRD FR-EXP-01..04

**What.** Copy as Markdown or plain text; export `.md` / `.txt`.

**Best way for us.** Formatting tested in Slack, WhatsApp, Gmail, and Notion. Optional "include
citations/timestamps" toggle. Nothing is sent automatically.

---

### G2. Share links and permissions
**Phase 2**

**What.** Share a meeting's notes via link with chosen access.

**How others do it.** Most tools share by link with workspace/anyone options; some allow sharing
only the summary, not the transcript.

**Best way for us.** Share options: *summary only* (default) or *summary + transcript*; audience:
*specific people* (default) or *anyone with link*. Links can be revoked and can expire. Audio is
never shared publicly by default.

---

### G3. Comments and reactions
**Phase 3**

**How others do it.** Otter allows comments and highlights on transcripts.

**Best way for us.** Comments on summary items and transcript lines, visible to people with access.

---

### G4. Team workspaces and shared folders
**Phase 3**

**What.** Teams share a library, organized by folders/channels (e.g. "Sales", "Hiring").

**Best way for us.** Builds on A2. Meetings are private to the recorder by default; sharing to a
folder is explicit. Folder-level permissions.

---

## H. Memory and search

### H1. Meeting library
**Phase 1** · PRD FR-LIB-01..05

**What.** List of all meetings with status; meeting detail page (summary, transcript, notes, audio,
consent log).

**Best way for us.** Extension full-page view in alpha; web app in beta (decision D-07). Filters by
date, participant, template.

---

### H2. Keyword search
**Phase 1 (P1)** · PRD FR-LIB-03

**What.** Search across titles, notes, summaries, and transcripts.

**Best way for us.** Database full-text search in Phase 1. Normalize Hinglish spellings and make
search script-insensitive (Roman ↔ Devanagari) using the canonical spelling list.

---

### H3. Cross-meeting AI chat (RAG)
**Phase 2**

**What.** Ask questions across all meetings: "What did we decide about pricing last month?"

**Workflow.**
1. After each meeting, chunk segments and summaries with metadata (meeting, date, participants,
   workspace, permissions).
2. Index in a vector index and a keyword index.
3. Query → permission filter → time filter → hybrid retrieval → rerank → LLM answer with citations
   to meetings and segments.

**How others do it.** Fireflies (AskFred), Granola Chat, Otter Chat, Circleback search, Bluedot chat.

**Best way for us.** Hybrid search (keyword + vector) with **multilingual embeddings** so English
questions find Hinglish content. Access control applied *before* retrieval. Every answer cites
meetings. Say "not found" rather than guess.

---

### H4. Action-item tracker across meetings
**Phase 1 (lightweight list: open/done, filter, link to meeting — PRD FR-LIB-06, DESIGN §14) ·
Phase 2 (auto-close suggestions, daily digest)**

**What.** One list of all action items assigned to me or by me, with status and due dates.

**How others do it.** Circleback and Fellow-style tools track action items across meetings.

**Best way for us.** Action items from F3 become trackable tasks (open/done). Detect when a later
meeting mentions an item as done and suggest closing it (user confirms). Optional daily digest (O1).

---

### H5. People and company pages
**Phase 3**

**What.** All meetings, decisions, and open items with a person or company.

**Best way for us.** Built from participants and calendar attendee domains within the workspace.
No external enrichment of people without explicit product and legal review.

---

## I. Integrations and automation

### I1. Slack, Notion, Google Docs, email delivery
**Phase 2**

**What.** Send notes to where the team works.

**Workflow.** User connects an app (OAuth) → picks a destination (channel, page, folder) → after a
meeting, user clicks "Send to…" (or enables a per-destination rule) → formatted post with link back.

**How others do it.** Nearly all tools post to Slack and Notion; Gemini in Meet writes notes to a
Google Doc.

**Best way for us.** User-triggered by default; automatic only via explicit rules (I5). Send summary
only, never audio. Store minimal tokens with least-privilege scopes.

---

### I2. MCP server
**Phase 2**

**What.** Let AI assistants (Claude, ChatGPT, Cursor, IDE agents) read meeting memory.

**Workflow.** User authorizes an MCP client (OAuth) → client calls tools such as `list_meetings`,
`get_meeting`, `search_meetings`, `get_action_items` → server enforces workspace permissions and
returns cited results.

**How others do it.** Granola provides an MCP server used from Claude, ChatGPT, Cursor, and others.

**Best way for us.** Remote MCP server with OAuth, **read-only** first, scoped per workspace, rate
limited, and audited (M4). Tools return segment citations and links.

---

### I3. Public API and webhooks
**Phase 2 / 3**

**What.** Developers fetch meetings and receive events (`meeting.processed`, `action_item.created`).

**Best way for us.** Versioned REST API with scoped API keys. Webhooks signed (HMAC), retried with
backoff, with idempotency keys and a delivery log. Zapier/Make connectors can be built on top.

---

### I4. CRM / ATS / project-tool sync
**Phase 3**

**What.** Push notes and fields to HubSpot/Salesforce, Greenhouse/Lever, Linear/Jira/Asana.

**How others do it.** Fireflies, Fathom, Bluedot, Scribbl, and Circleback sync to CRMs and project
tools; sales-focused tools fill CRM fields automatically.

**Best way for us.** Start with one CRM popular with our users (likely HubSpot for SMBs) and one task
tool. **Review before push**: user sees the proposed field updates and approves. Map fields per
workspace.

---

### I5. Workflow automations (rules engine)
**Phase 3**

**What.** "When a meeting with external attendees ends and uses the Sales template, post to #sales
and create HubSpot notes."

**How others do it.** Circleback workflows with conditions; Fireflies integrations and AI Skills.

**Best way for us.** Trigger (meeting processed) + conditions (attendees, template, title, calendar
tags) + actions (I1/I3/I4). Every run is logged and can be replayed. Users can preview what a rule
would do on a past meeting.

---

## J. Conversation intelligence

### J1. Talk-time and meeting analytics
**Phase 3**

**What.** Talk share per speaker, speaking pace, longest monologue, interruptions, questions asked.

**How others do it.** Gong and Fireflies provide coaching metrics (talk-to-listen ratio, monologues,
filler words, sentiment).

**Best way for us.** Compute from segments. **Talk share = speaker's speaking time ÷ total speaking
time** (not meeting length). Text-based metrics only — **no emotion inference from voice or video.**
Show metrics as coaching aids, not performance scores, by default.

---

### J2. Topic and keyword trackers
**Phase 3**

**What.** Track mentions of competitors, pricing, objections, or product names across meetings.

**How others do it.** Fireflies and Gong offer trackers configured by admins.

**Best way for us.** Workspace-defined keyword sets (with Hinglish variants) matched on normalized
transcripts; dashboards of mentions over time with links to segments.

---

## K. Video

### K1. Video recording, storage, playback
**Phase 3**

**What.** Record the meeting video (grid and screen share) for replay.

**How others do it.** Bots and some extensions (Scribbl, Bluedot) record video; files are stored as
MP4/WebM and streamed for playback.

**Best way for us.** Opt-in per meeting. Record in fragments uploaded continuously so crashes do not
corrupt files; transcode to adaptive streaming for playback; signed URLs; same retention rules as
audio. Budget for ~0.5–1 GB per hour at 720p.

---

### K2. Clips and soundbites
**Phase 3**

**What.** Share a 15–60 second audio/video clip with captions.

**How others do it.** Fireflies (Soundbites), Grain, tl;dv, Fathom.

**Best way for us.** Select transcript range → server cuts media between timestamps → burn-in or
attach captions from segments → share link with permissions (G2). Audio-only clips are possible
earlier from retained audio.

---

## L. Privacy, security, and compliance features

### L1. Retention controls
**Phase 1** · PRD FR-SET-01, decision D-02

**What.** Audio deleted after 7 days by default; user can pick immediate (after successful
processing) or 30 days.

**Best way for us.** Every audio asset has `delete_after`; a scheduled job deletes and logs. The UI
shows remaining time on each meeting. Org-level overrides in Phase 3 (M3).

---

### L2. Deletion and data export
**Phase 1** · PRD FR-SET-02..04

**What.** Delete a meeting, delete the account, export everything.

**Best way for us.** Immediate removal from primary storage; backups within 30 days; deletion
requests logged. Export as JSON + Markdown archive.

---

### L3. No-training guarantee and sub-processor transparency
**Phase 1** · PRD PRV-01, FR-SET-06

**What.** Users' data never trains our or vendors' models; users can see which vendors process data.

**Best way for us.** Paid vendor tiers only for real data; per-request opt-outs where vendors require
them (e.g. Deepgram `mip_opt_out`, Sarvam account opt-out — see STT_PREFLIGHT.md). A public
sub-processor list linked from Settings.

---

### L4. PII redaction
**Phase 3**

**What.** Optionally mask sensitive data (phone numbers, emails, card numbers, Aadhaar, PAN, bank
details) in transcripts and before sending text to the LLM.

**How others do it.** Enterprise tiers of some tools offer redaction.

**Best way for us.** Rule-based detectors for Indian identifiers plus a named-entity model; redact in
stored display text and LLM input, keep originals only if the org policy allows.

---

### L5. Encryption and access control
**Phase 1** · PRD SEC-01..10

**What.** TLS everywhere, encryption at rest, workspace isolation, signed URLs, secrets management,
least-privilege extension permissions.

**Best way for us.** Implement as platform defaults (not per feature) and test isolation with
automated tests that try cross-workspace access.

---

## M. Teams, admin, and enterprise

### M1. Roles and permissions
**Phase 3** — Owner, Admin, Member, Guest; folder-level access (G4).

### M2. SSO and SCIM
**Phase 3** — SAML/OIDC single sign-on and automated user provisioning, likely via an identity
provider service rather than built from scratch.

### M3. Org policies
**Phase 3** — Admin-set rules: who may record, whether external meetings may be recorded,
mandatory consent notice, org retention limits, allowed integrations.

### M4. Audit logs
**Phase 3** (basic deletion/export audit in Phase 1) — Who viewed, shared, exported, deleted; MCP and
API access; exportable for security teams.

### M5. Data residency
**Phase 3** — Option to keep data in an India region for enterprise customers; requires vendors with
matching regions (STT/LLM) or contractual coverage.

**How others do it.** Enterprise plans of Fireflies, Otter, and Granola offer SSO, admin controls,
retention policies, and compliance reports (e.g. SOC 2).

**Best way for us.** Design the data model and logs for these from Phase 1 (A2, L5); build the
features when the first business customers need them.

---

## N. Plans, billing, and usage

### N1. Plans, limits, and usage metering
**Phase 2**

**What.** Free and paid plans with limits (recorded hours per month, history length, features).

**How others do it.** Fireflies limits free usage unless auto-join is on; Granola and Circleback lock
history older than ~30 days on free plans; Otter meters minutes.

**Best way for us.** Meter recorded minutes per workspace from usage records (O3). Free plan limits
hours per month and history length, not core features — users must experience the full quality.
Pricing in INR for India.

### N2. Payments and invoicing
**Phase 2**

**Best way for us.** An India-friendly payment provider supporting subscriptions and UPI (e.g.
Razorpay) plus a global provider for international users; GST-compliant invoices. Verify current
provider availability and fees at the time.

---

## O. Platform and operations

### O1. Notifications
**Phase 1 / 2** — "Notes ready" Chrome notification (Phase 1). Phase 2: daily action-item digest
(opt-in email), pre-meeting brief alerts, failure alerts.

### O2. Observability and health
**Phase 1** — Structured logs, metrics, traces for relay, STT, and jobs; per-session timeline;
**no transcript text, names, or tokens in logs.**

### O3. Cost tracking
**Phase 1** — Per meeting: STT minutes per lane and provider, LLM tokens, storage bytes, estimated
cost. Feeds pricing (N1) and provider decisions.

### O4. Quality evaluation loop
**Phase 1** — Golden meeting set, metrics (action-item precision/recall, owner accuracy, citation
support, hallucination rate), regression gate on every prompt/model change, user feedback signals
from F6. Re-run the STT benchmark when providers release new models.

### O5. Product analytics
**Phase 1** — IDs, counts, durations, and enums only; opt-out available.

### O6. Meet DOM health monitoring
**Phase 1** — The adapter reports which selectors worked per session (no content). A spike in
failures alerts us that Google changed Meet's UI.

### O7. Support and diagnostics
**Phase 2** — User-triggered "send diagnostics" bundle (session timeline, versions, errors — no
content unless the user explicitly attaches a meeting).

---

## Build order and dependencies

```
Foundation (A1–A4) ──► Capture C1–C4 ──► Live STT D1 ──► Transcript D3/D5 ──► Summary F1–F4, F7
                                              │                                   │
                                              ▼                                   ▼
                                        Batch D2 (needs L1 retention)       Library H1, Export G1
                                                                                  │
Phase 1 complete ◄────────────────────────────────────────────────────────────────┘

Phase 2: C5 upload (reuses D2) → C6 desktop (new adapter) → B2 calendar → B4 brief (needs H3, H4)
         H3 RAG chat → I2 MCP (reuses H3) → I1 delivery → N1/N2 billing → E3/E4/F8/F9/G2

Phase 3: A2 teams → M1–M5 enterprise → I3–I5 integrations/automations → J1–J2 analytics
         K1–K2 video → C7 bot (buy first) → L4 redaction → C8 mobile
```

**Key dependency rules**
- Nothing in Phase 2/3 changes the core contracts (event schema, segment model, summary schema)
  without an ADR.
- Every new capture source (C5–C8) is just a new adapter emitting the same events.
- H3 (retrieval) is the base for B4, E4, H4 suggestions, and I2 — build it once, well.

---

## Definition of "complete"

The product is **complete** when a user can, end to end:

1. **Set up** in under a minute with clear privacy choices (A1–A4).
2. **Record** any meeting — Meet, Zoom, Teams, in-person, or an uploaded file — without a bot by
   default (C1, C5, C6), with an optional bot for video (C7).
3. **See** an accurate live transcript in English, Hindi, or Hinglish with correct speakers (D1–D5).
4. **Steer** the notes with their own live notes and highlights (E2, E3).
5. **Get** structured, cited notes, decisions, and owned action items within a minute, in their
   chosen language and template (F1–F7).
6. **Verify** any point in one click (F4, F10).
7. **Share** notes where their team works, under their control (G1, G2, I1).
8. **Remember**: search and ask questions across all past meetings, track action items, and get
   briefs before the next meeting (H1–H4, B4).
9. **Connect** meeting memory to AI assistants and business tools (I2–I5).
10. **Trust** the product: retention, deletion, consent, no training, enterprise controls (L1–L5, M1–M5).
11. **Pay** a fair price for their market, with usage that is metered and transparent (N1, N2).

And we, as the team, can **operate** it: we see health, cost, and quality per meeting, and we know
immediately when a platform change breaks capture (O1–O7).
