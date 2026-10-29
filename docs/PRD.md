# Product Requirements Document — AI Meeting Recorder & Summarizer

| Field | Value |
|---|---|
| Document | Product Requirements Document (PRD) |
| Product | AI Meeting Recorder & Summarizer (working name — final name TBD) |
| Version | 0.1 (Draft) |
| Status | Research & design — not approved for implementation |
| Last updated | 2026-10-28 |
| Owners | Core team (2 developers) |
| Related | [AGENTS.md](../AGENTS.md) (agent rules, architecture rules, decisions log) · [FEATURES.md](FEATURES.md) (every feature end to end, workflows, how others do it) · [ARCHITECTURE.md](ARCHITECTURE.md) (end-to-end system architecture) · [DESIGN.md](DESIGN.md) (end-to-end UI specification) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (stages, tasks, owners) |

> **How to read this document.** Requirements use IDs (e.g. `FR-CAP-03`) so code, tests, and PRs
> can reference them. Priorities: **P0** = required for the phase to ship, **P1** = expected,
> **P2** = nice to have. Anything marked **[Hypothesis]** or **[Verify]** is an assumption that must
> be confirmed before we depend on it. Open decisions are collected in section 22.

---

## Table of contents

1. Executive summary
2. Problem statement
3. Goals and non-goals
4. Target users and personas
5. Market context and positioning
6. Product principles
7. Scope by phase
8. Key user journeys
9. Functional requirements — Phase 1
10. User interface requirements
11. Non-functional requirements
12. System architecture
13. Data model
14. AI and summarization requirements
15. Speech-to-text requirements and benchmark plan
16. Multilingual requirements
17. Privacy, security, and compliance
18. Chrome extension permissions
19. Success metrics and analytics
20. Cost model and pricing hypotheses
21. Release plan and milestones
22. Open questions and decisions
23. Risks and mitigations
24. Out of scope
25. Glossary
26. Appendix — competitive feature mapping

---

## 1. Executive summary

We are building a **bot-free, privacy-first AI meeting assistant** that records, transcribes, and
summarizes meetings, with first-class support for **Hinglish** (Hindi–English code-switching) and
Indian languages.

**Phase 1** is a **Google Meet Chrome extension**. It captures meeting audio as two separate lanes —
the user's microphone (`me`) and the Meet tab audio (`them`) — without adding a bot participant to
the call. It shows a live transcript, gives the user a live notepad whose notes act as **anchors**
for the AI summary, and produces a structured summary, decisions, and action items within about a
minute of the meeting ending. Every AI-generated point **cites the exact transcript segments** it
came from, so the user can verify it.

The architecture separates **capture adapters** (platform-specific) from a **platform-agnostic
core** (transcription, summarization, storage, search). Later phases add a desktop app (Zoom, Teams,
in-person), cross-meeting search, integrations, and optionally video and cloud bots — without
rewriting the core.

**Why we can win:**
1. **Hinglish-first.** Most competitors optimize for English. Indian teams speak Hinglish.
2. **No bot.** Nothing joins the call; conversations stay natural.
3. **Trustworthy summaries.** Notes the user wrote steer the summary; every point links to its source.
4. **Privacy by default.** Configurable audio retention, no training on user data, consent built in.
5. **India-friendly pricing** (hypothesis — see section 20).

---

## 2. Problem statement

### 2.1 The user problem
Knowledge workers spend many hours a week in meetings. During a meeting they must choose between
**participating** and **taking notes**. After the meeting, decisions and action items are lost,
misremembered, or attributed to the wrong person. Writing and sharing a recap takes extra time that
usually does not happen.

### 2.2 Why existing tools fall short for our users
| Gap | Detail |
|---|---|
| **Language** | Indian meetings routinely mix Hindi and English inside one sentence. Mainstream tools transcribe this poorly, which corrupts the summary downstream. |
| **Visible bots** | Bot-based tools (a "Notetaker" participant) make clients, candidates, and colleagues less candid, need host admission, and are sometimes blocked by organizations. |
| **Untrustworthy summaries** | Generic summaries weight every minute equally, bury decisions in small talk, and hallucinate details with no way to verify. |
| **Privacy concerns** | Users and companies worry about where audio goes, how long it stays, and whether it trains AI models. |
| **Price** | USD $10–$19 per user per month is expensive for many Indian individuals and small teams. |
| **Native option is gated** | Google's own Meet note-taking requires paid Google Workspace plans. |

### 2.3 Problem statement (one line)
*Indian teams using Google Meet need accurate, trustworthy, private meeting notes for Hinglish
conversations, without a bot in the call and without paying US-level prices.*

---

## 3. Goals and non-goals

### 3.1 Product goals (Phase 1)
| ID | Goal |
|---|---|
| G1 | A user can record a Google Meet call with one click, with no bot joining. |
| G2 | The transcript is accurate enough on English, Hindi, and Hinglish that summaries are trustworthy (targets in section 15). |
| G3 | A structured summary with decisions and owned action items is ready within 60 seconds (P95) of the meeting ending. |
| G4 | Every AI-generated point is traceable to transcript segments in one click. |
| G5 | Users control their data: retention, deletion, export. |
| G6 | The core is platform-agnostic, so a second platform can be added by writing only an adapter. |

### 3.2 Business goals
| ID | Goal |
|---|---|
| B1 | Validate that Hinglish-first, bot-free notes is a compelling wedge (measured by retention, section 19). |
| B2 | Keep the cost per recorded meeting-hour low enough to support a free tier (target in section 20). |
| B3 | Be ready for business customers later: multi-tenant data, consent logs, security basics from day one. |

### 3.3 Non-goals (Phase 1)
- Video recording, screen recording, or clips.
- Cloud meeting bots.
- Zoom, Teams, Webex, Slack Huddles, or in-person recording.
- CRM, ATS, or project-management integrations.
- Conversation analytics (talk ratios, coaching scores).
- Team workspaces, SSO, admin consoles.
- Mobile apps.
- Voiceprint-based speaker identification.

See section 24 for the full out-of-scope list.

---

## 4. Target users and personas

### 4.1 Primary persona — "Startup operator" (Phase 1 focus)
- **Who:** founder, product manager, engineering lead, or consultant at an Indian startup or SMB.
- **Meetings:** 4–8 per day on Google Meet; internal standups, client calls, vendor calls,
  interviews. Language: mostly Hinglish, sometimes pure English or Hindi.
- **Pain:** cannot take notes while leading the discussion; follow-ups slip; recaps never get sent.
- **Wants:** one-click recording, accurate Hinglish transcript, crisp action items with owners,
  a recap they can paste into Slack/WhatsApp/email.
- **Constraints:** price-sensitive; uncomfortable with bots joining client calls.

### 4.2 Secondary persona — "Client-facing professional" (Phase 1–2)
- Sales, recruiting, customer success, agency account managers.
- Needs notes per client or candidate, reusable templates (sales call, interview), and later CRM/ATS sync.
- Very sensitive to bots changing how clients behave.

### 4.3 Secondary persona — "Engineer / builder" (Phase 2)
- Wants meeting decisions available inside AI coding tools (Claude, Cursor) through MCP.

### 4.4 Internal users (Phase 1 alpha)
- The two developers dogfood the product on their own meetings before anyone else uses it.

### 4.5 Anti-personas (not designing for in Phase 1)
- Large enterprises needing SSO, admin controls, and procurement reviews.
- Users who need video replay.
- Regulated clinical or legal workflows (HIPAA-style requirements).

---

## 5. Market context and positioning

### 5.1 Market structure
| Approach | Examples | Strength | Weakness |
|---|---|---|---|
| Cloud bot joins the call | Fireflies, Otter, Fathom, Read AI, tl;dv, Circleback | Exact speaker names, video, viral exposure | Visible bot, host must admit it, infra cost, platform blocking |
| Chrome extension, audio capture | Bluedot, Scribbl | No bot, low cost, natural on Meet | Browser-only; Meet DOM can break |
| Chrome extension, caption scraping | Tactiq | Near-zero cost, names included | Quality depends on Google captions; no audio |
| Desktop app, system audio | Granola, Otter/Fireflies desktop | Works across all platforms | Hardest to build |
| Native platform feature | Gemini "Take notes for me" in Meet | Zero setup | Paid Workspace only; limited control |

### 5.2 Positioning statement
For Indian teams who run their meetings on Google Meet, **[product]** is a bot-free meeting
assistant that turns Hinglish conversations into trustworthy notes and action items. Unlike
bot-based notetakers, nothing joins your call, and every summary point links back to exactly what
was said.

### 5.3 Differentiators (ranked)
1. Hinglish and Indian-language accuracy, validated on our own benchmark.
2. Bot-free capture.
3. Anchored, citation-backed summaries.
4. Privacy controls (retention, deletion, no training) visible in the product, not only in policy.
5. Price for the Indian market.

---

## 6. Product principles

1. **The user stays in control.** Nothing records without a clear user action. Nothing is sent to
   other people without the user's explicit action.
2. **Trust over polish.** A shorter summary that is correct and cited beats a long one that might
   be wrong.
3. **Human notes steer AI.** What the user wrote during the meeting decides what matters.
4. **Privacy is a feature.** Retention, deletion, and consent are visible in the UI.
5. **Platform-agnostic core.** Meet is the first adapter, not the architecture.
6. **Measure, don't assume.** Vendor choices are made by benchmarking on our own data.
7. **Fail safe.** When capture or transcription fails, the user is told immediately and no data is
   silently lost.

---

## 7. Scope by phase

### Phase 1 — Google Meet Chrome extension (this PRD's main focus)
| Area | Included |
|---|---|
| Platform | Google Meet in desktop Chrome |
| Capture | Two-lane audio (`me` mic, `them` tab), no bot, no video |
| Live | Live transcript, live notepad with anchors, recording indicator |
| Post-meeting | Summary, decisions, action items, open questions, all with citations; templates; output language choice |
| Library | List of past meetings, open, search, delete (with undo), export; lightweight action-items list across meetings (open/done) |
| Privacy | Consent notice, retention settings, delete/export, no training |
| Languages | English, Hindi, Hinglish |
| Accounts | Single user, Google sign-in; data model multi-tenant |

### Phase 2 — Breadth and memory
- Desktop app (macOS first, then Windows) for Zoom/Teams native apps, Meet in other browsers, and in-person meetings.
- Cross-meeting search and chat ("What did we decide about pricing last month?").
- Google Calendar sync and pre-meeting briefs.
- Share to Slack, Notion, email.
- MCP server exposing meeting memory to AI assistants.
- More Indian languages (decided by demand and benchmark).

### Phase 3 — Business features
- Video recording, playback, clips.
- Optional cloud bot (own or via a bot API) for users who want it.
- CRM/ATS/project-tool integrations and workflow automations.
- Conversation analytics.
- Team workspaces, sharing permissions, SSO, admin controls, audit logs, SOC 2 readiness.

---

## 8. Key user journeys

### J1 — First-time setup
1. User installs the extension from the Chrome Web Store.
2. Onboarding page opens: short explanation of how it works and what is recorded.
3. User signs in with Google.
4. User grants microphone permission (on this visible page — required because the background
   capture document cannot prompt).
5. User picks: transcript language mode (auto / English / Hindi / Hinglish), summary output
   language, audio retention.
6. User sees a 3-step "how to record your first meeting" guide and a note about recording consent.

### J2 — Recording a meeting
1. User joins a Google Meet call.
2. Extension detects an active Meet call and shows a subtle "Start recording" prompt.
3. User clicks **Start recording** (user gesture required for tab capture).
4. Recording indicator appears; side panel opens with live transcript and notepad.
5. Consent notice is sent to Meet chat (one-click or automatic, per setting).
6. User types rough notes, e.g. `DECISION: launch on 15 Nov`, `ACTION: Rahul — pricing sheet`.
7. User can pause/resume at any time.

### J3 — Ending a meeting
1. User clicks **Stop**, leaves the call, or closes the tab.
2. Extension flushes remaining audio, closes the session, and shows "Generating notes…".
3. Within ~60 seconds the summary appears in the side panel and in the meeting library.

### J4 — Reviewing and verifying notes
1. User reads the summary: their own notes as headings, AI details beneath, decisions, action items.
2. User hovers a citation marker and sees the exact transcript quote and time.
3. User clicks a citation to jump to that point in the transcript (and audio, if retained).
4. User edits text, reassigns an action item owner, or regenerates with a different template.

### J5 — Sharing
1. User clicks **Copy** (Markdown / plain text) or **Export** (.md / .txt).
2. User pastes into Slack, WhatsApp, email, or docs. The product never sends anything by itself in Phase 1.

### J6 — Managing data
1. User opens Settings → Privacy.
2. User changes retention, deletes a meeting, deletes all data, or exports everything.
3. Deletion is confirmed and completed within the stated time (section 17).

### J7 — Failure during a meeting
1. Network drops: indicator turns amber "Reconnecting — audio is being saved locally". Audio is
   buffered and uploaded when the connection returns.
2. Microphone disconnects (e.g. headphones unplugged): user is notified; `them` lane continues.
3. Browser or extension crashes: on restart, the user is offered to recover and process the
   buffered audio.

---

## 9. Functional requirements — Phase 1

### 9.1 Onboarding and account (`ONB`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-ONB-01 | Show an onboarding page on first install explaining what is captured (mic + Meet tab audio), where it is processed, and retention. | P0 | Page opens automatically on install; content approved; link to privacy policy. |
| FR-ONB-02 | Sign in with Google (OpenID: `openid email profile` only). | P0 | No other Google scopes requested in Phase 1. |
| FR-ONB-03 | Request microphone permission from the visible onboarding page. | P0 | After onboarding, recording works without further mic prompts. If denied, the UI explains how to enable it and allows `them`-only recording. |
| FR-ONB-04 | Collect preferences: transcript language mode, summary language, retention, consent-notice mode. | P0 | Defaults applied if skipped; changeable later in Settings. |
| FR-ONB-05 | Every user belongs to a personal workspace created at sign-up. | P0 | All records carry `workspace_id`. |
| FR-ONB-06 | Explain recording-consent responsibility in plain language. | P0 | User must acknowledge once before first recording; stored as `consent_acknowledged_at` in `user_settings`; recording is blocked until it is set. |

### 9.2 Meeting detection (`DET`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-DET-01 | Detect when the user is in an active Google Meet call (URL pattern `meet.google.com/xxx-xxxx-xxx` and in-call UI state, not lobby). | P0 | Prompt appears within 5 s of joining; never in the lobby or on the Meet home page. |
| FR-DET-02 | Show a non-intrusive "Start recording" prompt. | P0 | Dismissible; does not cover Meet controls. |
| FR-DET-03 | Never start recording automatically in Phase 1. | P0 | Recording starts only from an explicit user action. |
| FR-DET-04 | Read the meeting title and participant display names from the Meet UI where available. | P1 | Title and names stored as metadata; failure does not block recording. |
| FR-DET-05 | Detect meeting end (user left, call ended, tab closed). | P0 | Session closes and processing starts within 10 s. |

### 9.3 Recording control (`REC`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-REC-01 | Start recording with one click from the prompt, the toolbar icon, or the side panel. | P0 | Capture begins within 2 s. **[Verify]** which entry points count as the user gesture `tabCapture` requires. |
| FR-REC-02 | Show a persistent recording indicator (badge on icon + indicator in side panel). | P0 | Visible at all times while recording; distinct paused state. |
| FR-REC-03 | Pause and resume. | P0 | No audio is sent or stored while paused; transcript shows a "paused" marker. |
| FR-REC-04 | Stop recording. | P0 | Final audio flushed; processing starts. |
| FR-REC-05 | Keep recording when the user switches to another tab or window. | P0 | Capture continues; indicator remains on the icon. |
| FR-REC-06 | Handle Meet tab close or navigation away as meeting end. | P0 | No orphaned capture; session finalized. |
| FR-REC-07 | Allow only one active recording at a time. | P0 | Starting in a second Meet tab asks the user to stop the first. |
| FR-REC-08 | Maximum session length guard (e.g. 4 hours). | P1 | User warned at 3h45m; session closes cleanly at limit. |

### 9.4 Audio capture (`CAP`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-CAP-01 | Capture Meet tab audio as the `them` lane via `chrome.tabCapture` (stream ID in the service worker, capture in an offscreen document). | P0 | Remote participants' speech present in `them` lane. |
| FR-CAP-02 | Route captured tab audio back to the user's speakers. | P0 | The user hears the meeting normally while recording. |
| FR-CAP-03 | Capture the microphone as the `me` lane via `getUserMedia` with echo cancellation enabled. | P0 | User's speech present in `me` lane. **[Verify]** remote voices from laptop speakers do not leak significantly into `me`. |
| FR-CAP-04 | Keep the two lanes separate end to end. Never mix them before transcription. | P0 | Stored and transcribed independently, timestamps aligned to one session clock. |
| FR-CAP-05 | Convert each lane to 16 kHz mono 16-bit PCM for streaming. | P0 | Format verified in tests. |
| FR-CAP-06 | Stream audio chunks to the backend over an authenticated WebSocket using short-lived tokens. | P0 | No vendor API keys in the extension; token expiry handled with refresh. |
| FR-CAP-07 | Buffer audio locally (IndexedDB) and retry when the connection drops. | P0 | Network loss up to 10 minutes causes no audio loss; upload resumes automatically. |
| FR-CAP-08 | Persist buffered audio across extension/browser crashes and offer recovery. | P1 | After a crash, user is offered "Recover meeting" on next launch. |
| FR-CAP-09 | If retention is enabled, also record each lane as compressed audio (Opus) for storage. | P0 | ~15 MB per lane-hour or less; uploaded in chunks. |
| FR-CAP-10 | Detect silent or failed lanes (e.g. mic muted at OS level, all-zero buffers). | P1 | User notified within 15 s if a lane produces no signal while the other does. |
| FR-CAP-11 | Respect Meet's own mute: when the user is muted in Meet, `me` lane may still capture side comments. Provide a setting "Follow Meet mute" (default on). | P1 | With setting on, `me` lane pauses when Meet mic is muted. **[Verify]** reliable mute-state detection from the Meet DOM. |

### 9.5 Consent (`CON`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-CON-01 | When recording starts, offer to post a consent notice in Meet chat. | P0 | Modes: *one-click send* (default), *automatic*, *off* (off requires an extra confirmation). |
| FR-CON-02 | Notice text is editable, with a sensible default in English and Hinglish. | P1 | Default e.g. "This meeting is being transcribed by [product] for notes." |
| FR-CON-03 | Write a consent log entry per session: time, mode, whether notice was sent, text sent. | P0 | Visible to the user on the meeting page; exportable. |
| FR-CON-04 | Provide a quick "Stop and delete this recording" action for when a participant objects. | P0 | Stops capture and deletes all session data (audio, transcript, notes) after confirmation. |

### 9.6 Live transcription (`LIV`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-LIV-01 | Show a live transcript in the side panel. | P0 | Interim text appears within 1.5 s (P90) of speech; final text within 3 s (P90). |
| FR-LIV-02 | Distinguish interim (changing) text from final text visually. | P1 | Interim text styled lighter; replaced in place when final. |
| FR-LIV-03 | Label each line with speaker: user's name for `me`; participant name or "Speaker N" for `them`. | P0 | See 9.7. |
| FR-LIV-04 | Auto-scroll with a "jump to live" control when the user scrolls up. | P1 | — |
| FR-LIV-05 | Language mode applied per user setting (auto-detect or fixed). | P0 | See section 16. |
| FR-LIV-06 | Live transcript is a preview; the stored transcript may be improved by a post-meeting pass. | P1 | UI states when the final transcript has replaced the live one. |
| FR-LIV-07 | Show connection/transcription health (green/amber/red). | P0 | Amber within 5 s of an STT stall; red with message on failure. |

### 9.7 Speaker attribution (`SPK`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SPK-01 | All `me` lane speech is attributed to the signed-in user. | P0 | 100% by construction. |
| FR-SPK-02 | `them` lane speech is diarized into speaker clusters (provider diarization). | P0 | Clusters labelled "Speaker 1..N" when names are unknown. |
| FR-SPK-03 | Map clusters to participant names using Meet active-speaker signals (DOM) aligned by timestamp. | P1 | On a 1:1 call, the remote speaker is named correctly ≥ 95% of the time. On group calls, target ≥ 80% (to be measured). |
| FR-SPK-04 | Optionally use Meet live captions (if the user has them on) as an extra naming/timing signal. Captions are never the only transcript source. | P2 | — |
| FR-SPK-05 | User can rename a speaker; the change applies across the whole meeting. | P0 | Summary and action items update on regeneration. |
| FR-SPK-06 | Never create or store voiceprints that identify people across meetings. | P0 | Diarization embeddings, if any, are per-session and discarded. |

### 9.8 Live notepad and anchors (`NOTE`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-NOTE-01 | Provide a notepad in the side panel during recording. | P0 | Plain text with bullet support; autosaves every 2 s. |
| FR-NOTE-02 | Timestamp each note line with the session time it was written. | P0 | Stored with the note; used to locate related transcript. |
| FR-NOTE-03 | Recognize markers: `DECISION:`, `ACTION:`, `QUESTION:`, `IMPORTANT:` (case-insensitive; Hinglish aliases TBD). | P1 | Markers shape the summary sections. |
| FR-NOTE-04 | Notes are user-owned anchors: the summary keeps them verbatim as headings or bullets and adds AI details beneath. | P0 | User text is never rewritten by AI; visually distinct from AI text. |
| FR-NOTE-05 | Notepad works offline and during reconnects. | P0 | No note is lost on network drop. |
| FR-NOTE-06 | Notes can be added or edited after the meeting and the summary regenerated. | P1 | — |

### 9.9 Post-meeting processing (`PROC`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-PROC-01 | On session end, finalize the transcript from streamed results. | P0 | — |
| FR-PROC-02 | Optional batch re-transcription of stored audio for higher accuracy. | P1 | Only when audio retention is on. Summary is generated first from the live transcript, then silently updated if the batch transcript differs materially; user is told. |
| FR-PROC-03 | Generate the summary package (section 9.10) within 60 s P95 for meetings up to 60 minutes. | P0 | Measured from session end to summary visible. |
| FR-PROC-04 | Processing is idempotent and resumable. | P0 | Retrying a failed job never duplicates items. |
| FR-PROC-05 | Very short sessions (< 2 min or < 50 words) skip summarization and show the transcript only. | P1 | — |
| FR-PROC-06 | Record cost per meeting: STT minutes per lane, LLM input/output tokens, storage bytes. | P0 | Stored in `usage_records`. |
| FR-PROC-07 | Expose processing progress on the meeting (`processing_step`: `finalizing` → `summarizing` → `validating` → `done`) so the side panel and library can show the three steps in DESIGN §8.7. | P1 | Step updates visible to the client within 2 s of each job finishing. |

### 9.10 Summary output (`SUM`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SUM-01 | Summary package contains: title, 2–4 sentence overview, anchored sections (one per user note), decisions, action items, open questions, and key topics. | P0 | Validates against the JSON schema in section 14. |
| FR-SUM-02 | Each decision, action item, and AI bullet cites ≥ 1 transcript segment ID. | P0 | Items without valid citations are dropped or flagged "unverified". |
| FR-SUM-03 | Action items have: task, owner (participant or "unassigned"), due date if stated, citation. | P0 | Owner must be in the participant list. |
| FR-SUM-04 | Without user notes, the summary falls back to a topic-based structure. | P0 | — |
| FR-SUM-05 | Summary language follows the user's setting (English, Hindi, Hinglish), independent of the transcript language. | P0 | — |
| FR-SUM-06 | Templates: General (default), Standup, Client/Sales call, Interview, 1:1. | P1 | Each template defines sections and emphasis; user picks per meeting or sets a default. |
| FR-SUM-07 | Regenerate with a different template or language. | P1 | Previous version kept until the user accepts the new one. |
| FR-SUM-08 | User can edit any summary text inline. Edited items are marked as user-edited and preserved on regeneration where possible. | P1 | — |
| FR-SUM-09 | Thumbs up/down feedback on the whole summary and on individual action items. | P1 | Stored for quality metrics; never used to train third-party models. |

### 9.11 Citation verification (`CIT`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-CIT-01 | Every AI-generated item shows a citation marker. | P0 | — |
| FR-CIT-02 | Hover/tap a marker to show the cited transcript text, speaker, and time. | P0 | Popover appears within 200 ms. |
| FR-CIT-03 | Click a marker to jump to that point in the full transcript, and play audio from there if retained. | P1 | — |
| FR-CIT-04 | Numbers, dates, and names in AI text that do not appear in the cited segments are flagged. | P2 | Simple string/number match check; flagged items show a warning icon. |

### 9.12 Meeting library (`LIB`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-LIB-01 | List past meetings: title, date, duration, participants, status (processing/ready/failed). | P0 | Newest first; paginated. |
| FR-LIB-02 | Meeting page: summary, full transcript, notes, audio player (if retained), consent log. | P0 | — |
| FR-LIB-03 | Keyword search across titles, notes, summaries, and transcripts. | P1 | Results within 1 s for a library of 500 meetings. |
| FR-LIB-04 | Rename a meeting. | P1 | — |
| FR-LIB-05 | Library is accessible as a full-page view (extension page in alpha; web app in beta — decision D-07). | P0 | — |
| FR-LIB-06 | Action items page: every action item from the user's meetings, filter Open / Done / All, mark done or not done with undo, link to the source meeting. Home shows the user's own open items. Lightweight version of FEATURES H4, pulled into Phase 1 (DESIGN §14). | P1 | Status persists across devices; count in the sidebar matches open items. |

### 9.13 Sharing and export (`EXP`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-EXP-01 | Copy summary as Markdown or plain text. | P0 | Formatting survives paste into Slack, WhatsApp, Gmail, Notion. |
| FR-EXP-02 | Export a meeting as `.md` and `.txt` (summary + transcript). | P0 | — |
| FR-EXP-03 | Optional "include citations/timestamps" toggle on copy/export. | P1 | — |
| FR-EXP-04 | No automatic sending of notes to anyone in Phase 1. | P0 | — |

### 9.14 Settings and data management (`SET`)
| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SET-01 | Audio retention: delete immediately / 7 days / 30 days. **Default: 7 days** (D-02). "Delete immediately" runs only after the transcript and summary are successfully generated. Applies to audio only. | P0 | Enforced by a scheduled job; verified by tests, including that a failed processing job never triggers immediate deletion. |
| FR-SET-02 | Delete a single meeting (audio, transcript, notes, summary). | P0 | Hidden immediately; restorable during a 10-second grace period (Undo); after the grace period, removed from primary storage, and from backups within 30 days. |
| FR-SET-03 | Delete account and all data. | P0 | Same timelines as FR-SET-02; confirmation email/notice. |
| FR-SET-04 | Export all data (JSON + Markdown archive). | P1 | Delivered as a download within 24 h. |
| FR-SET-05 | Language, template, consent-notice, and "follow Meet mute" settings. | P0 | — |
| FR-SET-06 | Show which sub-processors handle data (STT, LLM, hosting). | P1 | Linked from Settings → Privacy. |
| FR-SET-07 | Workspace vocabulary (glossary): user-editable list of names and terms used to improve transcription spelling (FEATURES D4, DESIGN §15.5). | P1 | Terms are passed to the STT provider within its limits; user is warned near the limit. |

---

## 10. User interface requirements

### 10.1 Surfaces
| Surface | Purpose |
|---|---|
| **Toolbar icon + badge** | Start/stop; recording state badge. |
| **In-page prompt (Meet tab)** | Small "Start recording" chip when a call is detected. Must not overlap Meet controls. |
| **Side panel** (Chrome side panel API) | Tabs: *Live* (transcript), *Notes* (notepad), *Summary* (after the meeting). |
| **Full-page view** | Meeting library and meeting detail. |
| **Onboarding page** | First-run setup. |
| **Settings page** | Preferences and privacy controls. |

### 10.2 UI requirements
| ID | Requirement | Priority |
|---|---|---|
| UI-01 | User-written text and AI-written text are visually distinct everywhere (e.g. dark vs muted color), with a legend on first use. | P0 |
| UI-02 | Recording state (recording / paused / reconnecting / error) is always visible and uses both color and text (not color alone). | P0 |
| UI-03 | Supports light and dark themes, following system preference. | P1 |
| UI-04 | Keyboard accessible: start/stop/pause shortcuts; all controls reachable by keyboard. | P1 |
| UI-05 | Meets WCAG 2.2 AA contrast for text and controls. | P1 |
| UI-06 | Devanagari and Roman text render correctly, including mixed lines. | P0 |
| UI-07 | Empty, loading, and error states designed for every view. | P0 |
| UI-08 | Microcopy available in English; Hinglish UI copy P2. | P1 |

---

## 11. Non-functional requirements

### 11.1 Performance
| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-01 | Live transcript interim latency | ≤ 1.5 s P90 |
| NFR-PERF-02 | Live transcript final latency | ≤ 3 s P90 |
| NFR-PERF-03 | Summary ready after meeting end (≤ 60-min meeting) | ≤ 60 s P95 |
| NFR-PERF-04 | Extension CPU overhead while recording | ≤ 10% of one core on a mid-range laptop [Hypothesis — measure in M1] |
| NFR-PERF-05 | Extension memory while recording | ≤ 300 MB |
| NFR-PERF-06 | Upload bandwidth | ≤ 100 kbps sustained (two PCM lanes ≈ 512 kbps raw — evaluate compressed streaming in M1) [Verify] |
| NFR-PERF-07 | Meet call quality | No measurable degradation in the user's Meet audio/video while recording |

### 11.2 Reliability
| ID | Requirement | Target |
|---|---|---|
| NFR-REL-01 | Audio loss on network drop ≤ 10 min | Zero |
| NFR-REL-02 | Successful capture sessions | ≥ 99% of started sessions produce a transcript |
| NFR-REL-03 | Processing success | ≥ 99% of sessions produce a summary within 5 min, including retries |
| NFR-REL-04 | Crash recovery | Buffered audio recoverable after browser crash |
| NFR-REL-05 | Graceful degradation | If STT is down, keep recording and process later; if LLM is down, show transcript and retry summary |
| NFR-REL-06 | Meet UI changes | DOM-dependent features (names, mute state) degrade gracefully; capture itself does not depend on DOM selectors |

### 11.3 Quality
| ID | Requirement | Target |
|---|---|---|
| NFR-QUAL-01 | Transcript accuracy | Section 15.4 targets on our benchmark |
| NFR-QUAL-02 | Citation validity | 100% of displayed citations point to existing segments; ≥ 90% judged supportive in evaluation |
| NFR-QUAL-03 | Action item precision | ≥ 85% of extracted action items judged real by the meeting owner |
| NFR-QUAL-04 | Action item owner accuracy | ≥ 90% correct when the owner is stated in the meeting |

### 11.4 Scalability
- Phase 1 targets up to **1,000 users** and **200 concurrent recording sessions** without
  architectural changes.
- Streaming relay is horizontally scalable and stateless per session (session state in a shared store).
- Processing runs as background jobs with a queue, so spikes after the hour (many meetings ending
  together) are absorbed.

### 11.5 Compatibility
| Item | Support |
|---|---|
| Browser | Google Chrome stable, latest two major versions (P0). Microsoft Edge (Chromium) P2. |
| OS | macOS, Windows, ChromeOS, Linux via Chrome |
| Meet | Google Meet web, personal Gmail and Google Workspace accounts |
| Audio devices | Built-in, USB, Bluetooth headsets (AirPods etc.) |

### 11.6 Observability
- Structured logs, metrics, and traces for relay, STT provider calls, and processing jobs.
- Per-session timeline (capture start, chunks sent, reconnects, STT latency, job durations).
- **Logs never contain transcript text, audio, names, emails, or tokens** — only IDs and counts.
- Error reporting from the extension with PII scrubbing.

### 11.7 Maintainability
- All platform-specific code inside the Meet adapter.
- All vendor calls inside provider modules behind interfaces.
- Meet DOM selectors in one module with fallbacks and a self-test that reports breakage.

---

## 12. System architecture

### 12.1 High-level diagram
```
┌──────────────────────────── Chrome (user's machine) ─────────────────────────────┐
│                                                                                  │
│  Meet tab ──(content script: meeting state, title, participants, active speaker) │
│     │                                                                            │
│  Service worker ──(tabCapture stream ID, session control, auth tokens)           │
│     │                                                                            │
│  Offscreen document                                                              │
│     ├─ them lane: tab audio ─┐   ┌─ playback to speakers                         │
│     ├─ me lane: microphone ──┼───┤                                               │
│     ├─ AudioWorklet → 16 kHz PCM per lane                                        │
│     ├─ IndexedDB buffer (resilience)                                             │
│     └─ WebSocket client (short-lived token)                                      │
│                                                                                  │
│  Side panel UI (live transcript, notes, summary)  ·  Full-page library/settings  │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ normalized events + audio chunks
                                       ▼
┌──────────────────────────────────── Backend ─────────────────────────────────────┐
│  API gateway / auth  ──  Session & streaming relay  ──  STT provider interface   │
│                                   │                       (Deepgram / Sarvam /   │
│                                   │                        Gemini / …)           │
│                                   ▼                                              │
│                        Transcript assembler (segments, lanes, speakers)          │
│                                   │                                              │
│                         Job queue ─┴─ Post-meeting pipeline                      │
│                                      ├─ optional batch re-transcription          │
│                                      ├─ speaker naming (DOM signals + clusters)  │
│                                      ├─ LLM provider interface (summary JSON)    │
│                                      └─ citation validation                      │
│                                                                                  │
│  Storage: relational DB (metadata, segments, summaries) · object storage (audio, │
│  encrypted) · search index (keyword; vector later)                               │
│  Scheduled jobs: retention enforcement, deletion, usage aggregation              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Components
| Component | Responsibility | Platform-specific? |
|---|---|---|
| Meet adapter (content script + capture) | Detect call, read metadata and active speaker, capture two lanes, emit normalized events | Yes |
| Extension shell | Auth, settings, side panel, library pages, buffering, WebSocket client | No (reusable for other web adapters) |
| Streaming relay | Authenticate, receive lanes, forward to STT provider, return live transcript | No |
| STT provider interface | Uniform API for streaming and batch transcription | No |
| Transcript assembler | Build segments with IDs, lanes, timestamps, language | No |
| Speaker resolver | Map `them` clusters to names using adapter signals | No (consumes generic `speaker.active` events) |
| Summary pipeline | Build prompt, call LLM, validate JSON, validate citations | No |
| LLM provider interface | Uniform API across LLM vendors | No |
| Storage and search | Persist and query all data | No |
| Retention & deletion jobs | Enforce settings and requests | No |

### 12.3 Normalized capture events
Defined in [AGENTS.md section 4](../AGENTS.md). Adapters emit only these events; the core consumes
only these events. Any new field requires an update to that schema and an ADR.

### 12.4 Proposed technology (to confirm — decision D-08)
| Layer | Proposal |
|---|---|
| Extension | TypeScript, Chrome MV3, a lightweight UI framework for side panel/pages |
| Backend | TypeScript (Node.js) for relay, API, and jobs |
| Database | PostgreSQL |
| Object storage | S3-compatible, server-side encryption |
| Queue | Postgres-backed queue or Redis-based queue |
| Search | Postgres full-text search in Phase 1; vector index in Phase 2 |
| Hosting | TBD (region choice affects DPDP/GDPR posture) |

---

## 13. Data model

All tables include `id`, `workspace_id`, `created_at`, `updated_at` unless noted.

| Entity | Key fields | Notes |
|---|---|---|
| `workspaces` | name, plan | Personal workspace per user in Phase 1 |
| `users` | email, display_name, google_sub | — |
| `memberships` | user_id, workspace_id, role | Phase 1: single owner |
| `user_settings` | transcript_language_mode, summary_language, retention_policy, consent_mode, consent_message, consent_acknowledged_at, follow_meet_mute, default_template, analytics_opt_out | — |
| `meetings` | platform (`google_meet`), external_meeting_code, title, started_at, ended_at, status (`recording`, `processing`, `ready`, `updated`, `failed`, `too_short`), processing_step (`finalizing`, `summarizing`, `validating`, `done`), deleted_at | One per recorded session in Phase 1; `deleted_at` set during the undo grace period |
| `participants` | meeting_id, display_name, is_self, source (`dom`, `user_edit`) | No emails scraped in Phase 1 |
| `speaker_clusters` | meeting_id, lane, provider_label, participant_id? | Per meeting only; no cross-meeting identity |
| `audio_assets` | meeting_id, lane, storage_key, codec, bytes, duration_ms, delete_after | Encrypted; deleted by retention job |
| `transcript_segments` | meeting_id, lane, speaker_cluster_id?, start_ms, end_ms, text, raw_text, language, source (`live`, `batch`), words (JSON, optional) | `text` = display text (Roman for Hindi/Hinglish); `raw_text` = provider original. Segment IDs are what the LLM cites |
| `notes` | meeting_id, text, session_ms, marker (`decision`, `action`, `question`, `important`, null), order | User-owned |
| `summaries` | meeting_id, version, template, language, model, status, overview, accepted | Versioned |
| `summary_items` | summary_id, kind (`anchor_detail`, `decision`, `action_item`, `question`, `topic`), text, anchor_note_id?, owner_participant_id?, due_date?, due_phrase?, status (`open`, `done` — action items only), completed_at?, user_edited, flagged | `due_phrase` keeps vague wording ("this week"); status survives regeneration by matching items |
| `glossary_terms` | term, created_by | Workspace vocabulary (FR-SET-07) |
| `citations` | summary_item_id, segment_id | Many-to-many |
| `consent_logs` | meeting_id, mode, notice_sent, notice_text, sent_at | — |
| `feedback` | target_type, target_id, rating, comment | Internal quality only |
| `usage_records` | meeting_id, stt_provider, stt_seconds_by_lane, llm_model, input_tokens, output_tokens, storage_bytes, estimated_cost | — |
| `deletion_requests` | scope (`meeting`, `account`), target_id, requested_at, execute_after, cancelled_at?, completed_at? | Audit trail; `execute_after` = requested_at + 10 s grace for meetings |

---

## 14. AI and summarization requirements

### 14.1 Inputs to the summary model
1. **Meeting metadata:** title, date, duration, participant list with IDs.
2. **User notes** with IDs, timestamps, and markers.
3. **Transcript segments** in order, each formatted as `[seg_id] (mm:ss) Speaker: text`.
4. **Template** instructions and **output language**.

### 14.2 Model behaviour requirements
| ID | Requirement |
|---|---|
| AI-01 | Treat each user note as an anchor: keep it verbatim and add supporting detail from the transcript beneath it. |
| AI-02 | Ignore small talk and off-topic segments unless a note anchors them. |
| AI-03 | Every generated item lists the segment IDs that support it. |
| AI-04 | Never invent timestamps, numbers, names, or commitments not present in the transcript or notes. |
| AI-05 | Owners and speakers come only from the supplied participant IDs, else `unassigned`. |
| AI-06 | Distinguish proposals from decisions: only explicit agreement counts as a decision. |
| AI-07 | Handle Hinglish input naturally; output in the requested language and script. |
| AI-08 | Single-pass over the full transcript for typical meetings; chunked (map-reduce) processing only when the transcript exceeds a configured token threshold. |

### 14.3 Output schema (draft)
```json
{
  "title": "string",
  "overview": "string (2-4 sentences)",
  "anchored_sections": [
    {
      "note_id": "string",
      "details": [ { "text": "string", "segment_ids": ["seg_..."] } ]
    }
  ],
  "decisions": [ { "text": "string", "segment_ids": ["seg_..."] } ],
  "action_items": [
    {
      "task": "string",
      "owner_participant_id": "string | \"unassigned\"",
      "due_date": "YYYY-MM-DD | null",
      "segment_ids": ["seg_..."]
    }
  ],
  "open_questions": [ { "text": "string", "segment_ids": ["seg_..."] } ],
  "topics": ["string"]
}
```

### 14.4 Validation pipeline
1. Parse JSON; on failure retry once with the validation error, then fail the job visibly.
2. Validate against the schema.
3. Drop or flag items whose `segment_ids` are empty or reference unknown segments.
4. Reject `owner_participant_id` values not in the participant list (→ `unassigned`).
5. (P2) Flag numbers/dates/names in text that are absent from cited segments.
6. Map segment IDs to timestamps in code for display.

### 14.5 Model selection
- Provider-swappable (AGENTS.md rule 3). Candidates: Gemini Flash (cost), Claude, others.
- Selection by the evaluation in 14.6, weighing quality, latency, cost, and data terms.
- **Only paid tiers with no-training terms are used for real user data.** Free tiers only with
  fully synthetic test data (no real voices or personal information) — see
  [STT_PREFLIGHT.md §4.3](STT_PREFLIGHT.md).

### 14.6 Evaluation
- **Golden set:** 30+ meetings (synthetic or recorded with consent) covering English, Hindi,
  Hinglish; standups, client calls, interviews; with and without user notes.
- **Human-labelled references:** decisions, action items with owners, key facts.
- **Metrics:** action-item precision/recall, owner accuracy, decision precision, citation support
  rate (does the cited segment support the claim), hallucination rate (unsupported facts per summary),
  user-edit rate in dogfooding.
- **Regression gate:** any prompt or model change must not reduce metrics beyond agreed tolerance.

---

## 15. Speech-to-text requirements and benchmark plan

### 15.1 Requirements
| ID | Requirement | Priority |
|---|---|---|
| STT-01 | Real-time streaming with interim and final results | P0 |
| STT-02 | Hindi–English code-switching within an utterance | P0 |
| STT-03 | Word- or segment-level timestamps | P0 |
| STT-04 | Speaker diarization on the `them` lane | P0 |
| STT-05 | Vocabulary boosting (participant names, product terms) | P1 |
| STT-06 | Batch mode for post-meeting re-transcription | P1 |
| STT-07 | Data-processing terms: no training on our data, deletion, acceptable region | P0 |
| STT-08 | Stable long sessions (≥ 2 h) or reliable reconnect/resumption | P0 |

### 15.2 Candidate providers (capabilities to verify)
| Provider | Why shortlisted | Things to verify |
|---|---|---|
| Sarvam AI | Indian-language and code-mixed focus | Streaming quality, diarization, script options, pricing at scale |
| Deepgram Nova-3 (multilingual) | Fast streaming, Hindi code-switching claimed | Hinglish WER, `keyterm` support in multilingual mode |
| Google Gemini Transcribe / Transcribe Live | Low reported cost, strong multilingual model | Session limits (reported ~10 min), timestamps, diarization, data terms |
| Others (Gladia, ElevenLabs Scribe, OpenAI transcribe) | Comparison baselines | As above |

### 15.3 Benchmark design
Full plan: [STT_BENCHMARK_PLAN.md](STT_BENCHMARK_PLAN.md). Summary:
- **Dataset:** 15–20 recordings, 5–15 min each, with everyone's consent: Hinglish-heavy, pure
  English, pure Hindi; varied accents; laptop mic and headset; one noisy environment; 2-person and
  4+ person calls. Captured through our own two-lane pipeline (prototype) so audio matches production.
- **Ground truth:** human transcripts in both Roman and Devanagari forms, with speaker turns.
- **Metrics:**
  - WER per lane, after normalization (case, punctuation, numerals, and **script transliteration**
    so Roman vs Devanagari output is compared fairly).
  - Code-switch WER (errors in a window around language switches).
  - Diarization error rate on the `them` lane.
  - Named-entity accuracy (person names, product names).
  - Latency (interim, final), stability over long sessions.
  - Cost per audio hour.
- **Process:** same audio to every provider; scripts and results committed (no real-meeting audio
  committed — store securely); summary in an ADR.

### 15.4 Provisional accuracy targets [Hypothesis — finalize after benchmark]
| Condition | Target WER |
|---|---|
| English, headset | ≤ 10% |
| English, laptop mic | ≤ 15% |
| Hinglish, headset | ≤ 18% |
| Hinglish, laptop mic | ≤ 25% |
| Person-name accuracy (with boosting) | ≥ 85% |

---

## 16. Multilingual requirements

| ID | Requirement | Priority |
|---|---|---|
| ML-01 | Transcript language modes: Auto (default), English, Hindi, Hinglish. | P0 |
| ML-02 | Code-switching inside a sentence is supported in Auto and Hinglish modes. | P0 |
| ML-03 | Hindi/Hinglish transcripts display in **Roman script** by default (D-01). Devanagari display as a user setting is P1. If benchmarked transliteration quality is poor, Phase 1 falls back to mixed script (Devanagari + Latin English words). | P0 |
| ML-04 | If the STT output is not in Roman script, transliterate it in the pipeline. The provider's original output is always stored (`raw_text`) so display text can be regenerated. | P0 |
| ML-05 | Summary language independent of transcript language: English, Hindi (Devanagari), Hinglish (Roman). | P0 |
| ML-06 | Participant names from Meet are passed as vocabulary hints. | P1 |
| ML-07 | Search matches regardless of script (Roman query finds Devanagari text and vice versa). | P2 |
| ML-08 | Architecture allows adding more Indian languages (Tamil, Telugu, Marathi, Bengali, …) by configuration and provider capability, not code rewrites. | P1 |

---

## 17. Privacy, security, and compliance

### 17.1 Data inventory
| Data | Where | Retention |
|---|---|---|
| Audio (per lane) | Encrypted object storage; transient local buffer | 7 days by default (user can choose immediate or 30 days); local buffer deleted after successful upload |
| Transcript segments | Database | Until user deletes |
| Notes, summaries | Database | Until user deletes |
| Participant display names | Database | Until user deletes |
| Account data | Database | Until account deletion |
| Usage/cost records | Database | Retained in aggregated, de-identified form after deletion |
| Logs | Logging system | 30 days, no content or PII |

### 17.2 Security requirements
| ID | Requirement | Priority |
|---|---|---|
| SEC-01 | TLS for all traffic; encryption at rest for database and object storage. | P0 |
| SEC-02 | No vendor API keys in the extension; short-lived, scoped session tokens only. | P0 |
| SEC-03 | Strict workspace isolation enforced in the data layer (every query scoped by `workspace_id`). | P0 |
| SEC-04 | Signed, expiring URLs for audio playback. | P0 |
| SEC-05 | Secrets in a secrets manager; never in code or repo. | P0 |
| SEC-06 | Dependency and vulnerability scanning in CI. | P1 |
| SEC-07 | Least-privilege extension permissions (section 18). | P0 |
| SEC-08 | Content Security Policy for extension pages; no remote code execution. | P0 |
| SEC-09 | Audit log for deletion and export actions. | P1 |
| SEC-10 | Design for SOC 2 readiness (access control, logging, change management) without certification in Phase 1. | P2 |

### 17.3 Privacy requirements
| ID | Requirement | Priority |
|---|---|---|
| PRV-01 | User data is never used to train our or third-party models. Contracts/terms with STT and LLM vendors must guarantee this. | P0 |
| PRV-02 | Free API tiers that may train on data are never used for real user data. | P0 |
| PRV-03 | No voiceprints or biometric identifiers stored. | P0 |
| PRV-04 | No emotion or sentiment inference from voice. | P0 |
| PRV-05 | Clear privacy policy and in-product explanation of processing and sub-processors. | P0 |
| PRV-06 | Deletion: primary storage immediately; backups within 30 days. | P0 |
| PRV-07 | Data export on request. | P1 |

### 17.4 Legal and compliance (to review with a legal advisor before public launch)
- **Recording consent:** laws differ by country and US state (some require all parties to consent).
  The product provides the consent notice and log; the user remains responsible for obtaining consent.
- **India — Digital Personal Data Protection (DPDP) Act:** notice, consent, purpose limitation,
  deletion, and grievance contact.
- **EU/UK — GDPR:** lawful basis, data processing agreements, international transfers, data subject
  rights — required before marketing to EU users.
- **Biometric privacy laws (e.g. Illinois BIPA):** avoided by not creating voiceprints (PRV-03).
- **EU AI Act:** avoid emotion recognition from biometric signals (PRV-04).
- **Chrome Web Store policies:** single purpose, minimal permissions, accurate privacy disclosures,
  and limited-use requirements for user data.
- **Google OAuth verification:** Phase 1 uses only basic sign-in scopes. Calendar scopes (Phase 2)
  are "sensitive" and require verification. Gmail scopes are avoided.

---

## 18. Chrome extension permissions

Request only what each feature needs; every permission needs a written justification for Chrome Web
Store review. **[Verify]** final list during M1.

| Permission | Why |
|---|---|
| `tabCapture` | Capture Meet tab audio (`them` lane) |
| `offscreen` | Run audio capture and processing outside the service worker |
| `sidePanel` | Live transcript, notes, and summary UI |
| `storage` | Settings and small state |
| `identity` | Google sign-in via `chrome.identity.launchWebAuthFlow` with PKCE ([ADR-0004](adr/0004-auth-and-token-model.md), proposed) |
| Host permission `https://meet.google.com/*` | Content script for call detection, metadata, active speaker, chat notice |
| Host permission for our API domain | Backend communication |
| `notifications` | "Notes ready" and "Your export is ready" alerts when the user has left the side panel (O1, DESIGN §8.7) |

Keyboard shortcuts (`Alt+Shift+R`, `Alt+Shift+P`) use the manifest `commands` key, which is not a
permission.

**Not requested:** `<all_urls>`, `history`, `tabs` (unless proven necessary), `cookies`,
`webRequest`, any Google API scope beyond basic sign-in.

Microphone access is a web permission granted to the extension origin through the onboarding page.

---

## 19. Success metrics and analytics

### 19.1 North-star metric
**Weekly active recorders:** users who record ≥ 2 meetings in a week and open at least one summary.

### 19.2 Product metrics
| Metric | Definition | Phase 1 beta target [Hypothesis] |
|---|---|---|
| Activation | % of installs that complete a recording with a summary within 7 days | ≥ 40% |
| Meetings per active user per week | — | ≥ 5 |
| Summary open rate | % of finished meetings whose summary is opened | ≥ 70% |
| Citation interaction | % of opened summaries where a citation is hovered/clicked | Track (trust signal) |
| Copy/export rate | % of summaries copied or exported | ≥ 30% |
| Week-4 retention | % of activated users still recording in week 4 | ≥ 30% |
| Summary thumbs-up rate | Up / (up + down) | ≥ 80% |

### 19.3 Quality metrics
Transcript WER on benchmark (section 15), action-item precision and owner accuracy (14.6),
citation support rate, user edit rate per summary.

### 19.4 Technical metrics
Capture failure rate, reconnects per hour, audio-loss incidents, STT latency P50/P90, summary
latency P50/P95, processing failure rate, extension crash rate, Meet DOM selector health.

### 19.5 Cost metrics
Cost per meeting-hour (STT + LLM + storage + infra), by provider and language.

### 19.6 Analytics rules
- Product analytics events contain IDs, counts, durations, and enum values only — never transcript
  text, notes, names, or meeting titles.
- Users can opt out of product analytics.

---

## 20. Cost model and pricing hypotheses

### 20.1 Unit cost estimate per meeting-hour [Hypothesis — replace with benchmark data]
| Item | Estimate |
|---|---|
| Streaming STT, two lanes | ~USD 0.30–1.20 depending on provider (lanes may be billed separately; `me` lane is often mostly silence — measure) |
| Optional batch re-transcription | ~USD 0.30–0.60 |
| LLM summary (~15k input tokens) | A few cents on a low-cost model |
| Audio storage (~30 MB, 30 days) | Negligible |
| Relay/compute | To be measured |
| **Target all-in** | **≤ USD 1.00 per meeting-hour in Phase 1; reduce over time** |

Cost levers: skip silence (VAD) before sending to STT, single-lane STT for `me` only when speech is
detected, cheaper batch models, caching, provider negotiation.

### 20.2 Pricing hypotheses (Phase 2+, to validate)
| Plan | Hypothesis |
|---|---|
| Free | Limited meetings or hours per month; full features; short history |
| Pro (individual) | India-friendly monthly price (INR), unlimited meetings within fair use, full history |
| Team | Per-seat, shared workspace, admin and retention controls |

No billing is built in Phase 1.

---

## 21. Release plan and milestones

| Milestone | Content | Exit criteria |
|---|---|---|
| **M0 — Research & decisions** | This PRD, STT benchmark, decisions D-01..D-08 | Decisions recorded in AGENTS.md and ADRs; STT provider chosen |
| **M1 — Capture spike** | Prototype: two-lane capture on Meet, playback routing, mic permission flow, buffering, streaming to one STT provider | Records a 60-min Meet call with no audio loss; CPU/memory measured; permission and user-gesture questions answered |
| **M2 — Internal alpha** | Live transcript, notepad, summary with citations, library (extension page), retention, delete | Both developers use it for all their Meet calls for 2 weeks; P0 bugs fixed; quality metrics baseline |
| **M3 — Private beta** | 10–30 external users; consent flows polished; export; templates; feedback; observability; privacy policy | Activation and retention measured; no P0 privacy/security issues; legal review of consent and policy text |
| **M4 — Public launch (Chrome Web Store)** | Store listing, permission justifications, support channel | Store approval; targets in 19.2 trending toward goals |

Phase 2 planning starts after M3 data is available.

---

## 22. Open questions and decisions

| ID | Question | Options | Owner | Needed by |
|---|---|---|---|---|
| D-01 | Hindi/Hinglish transcript script | **Decided 2026-10-28:** Roman display by default; store provider original; Devanagari setting later; mixed-script fallback if transliteration benchmarks poorly | Team | ✅ Closed |
| D-02 | Default audio retention | **Decided 2026-10-28:** 7 days default; user can pick immediate (after successful processing) or 30 days; audio only | Team | ✅ Closed |
| D-03 | STT provider | Decided by benchmark (15.3) | Team | M0 |
| D-04 | LLM provider for summaries | Decided by evaluation (14.6) | Team | M2 |
| D-05 | Consent notice default mode | One-click (proposed) / automatic / off | Team | M1 |
| D-06 | Stream raw PCM or compressed audio to the relay | **Decided 2026-10-29:** Opus 24 kbps ([ADR-0003](adr/0003-audio-transport-format.md)) | Team | ✅ Closed |
| D-07 | Library surface in beta | Extension page / web app | Team | M2 |
| D-08 | Backend stack and hosting region | **Option B selected 2026-10-28** ([ADR-0002](adr/0002-backend-stack-and-hosting.md)): TypeScript/Node on Google Cloud Mumbai (Cloud Run, Cloud SQL, Cloud Storage); final after ADR §9 checks | Team | M1 |
| D-09 | Product name and branding | — | Team | M3 |
| D-10 | Whether `me` lane should follow Meet mute by default | On (proposed) / off | Team | M1 |
| D-11 | Hinglish aliases for note markers | e.g. `faisla:` (decision), `kaam:` (action), `sawaal:` (question), `zaroori:` (important) / English markers only | Team | M2 |

---

## 23. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hinglish STT accuracy too low | Medium | High | Benchmark before building; provider-swappable; batch re-pass; vocabulary hints |
| `tabCapture` / offscreen / mic permission constraints block the UX | Medium | High | M1 spike answers these first; fallback flows designed |
| Meet UI changes break names, mute, or chat notice | High | Medium | Selectors isolated with fallbacks; capture independent of DOM; health monitoring |
| Google ships a stronger native feature for free | Medium | High | Differentiate on Hinglish, privacy, price, and features beyond Meet |
| Consent/legal complaints | Medium | High | Consent notice + log; clear docs; legal review before launch; stop-and-delete action |
| STT/LLM costs exceed the free tier budget | Medium | Medium | Cost tracking from day one; VAD; cheaper models; usage limits |
| Chrome Web Store rejection | Low–Medium | High | Minimal permissions; clear justifications; accurate privacy disclosures |
| Echo from laptop speakers duplicates remote speech in `me` lane | Medium | Medium | Browser echo cancellation; detect and de-duplicate overlapping text across lanes |
| Vendor data terms change | Low | High | Contract review; swappable providers |
| Two developers using different AI agents produce inconsistent code | Medium | Medium | Shared AGENTS.md; lint/format configs; cross-review of every PR |

---

## 24. Out of scope

Not in Phase 1 (some planned later — see section 7):
- Video and screen recording, clips, highlight reels
- Cloud meeting bots
- Platforms other than Google Meet in Chrome
- Calendar integration, auto-join, pre-meeting briefs
- Cross-meeting AI chat (keyword search only in Phase 1)
- Slack/Notion/CRM/ATS integrations, webhooks, automations
- MCP server
- Conversation analytics and coaching scores
- Team workspaces, sharing permissions, SSO, admin console
- Mobile apps, wearables
- Real-time translation
- Billing and payments

Never (unless the product strategy changes and is recorded in an ADR):
- Training models on user data
- Voiceprint identification across meetings
- Emotion inference from voice or video
- Sending notes to meeting attendees without the user's explicit action

---

## 25. Glossary

| Term | Meaning |
|---|---|
| **Lane** | One independent audio stream. `me` = user's microphone; `them` = Meet tab audio. |
| **Adapter** | Platform-specific module that captures audio and metadata and emits normalized events. |
| **Core** | Platform-agnostic backend pipeline (transcription, summary, storage, search). |
| **Anchor** | A note written by the user during the meeting that the summary keeps and expands. |
| **Segment** | A stored piece of transcript with ID, lane, speaker, start/end time, text, language. |
| **Citation** | Link from an AI-generated item to one or more segment IDs. |
| **Diarization** | Splitting audio into "who spoke when" clusters. |
| **Code-switching** | Mixing languages within one sentence (e.g. Hinglish). |
| **WER** | Word Error Rate — standard transcript accuracy metric (lower is better). |
| **STT** | Speech-to-text. |
| **MV3** | Chrome Manifest V3 extension platform. |
| **Offscreen document** | Hidden extension page used for media capture and processing in MV3. |
| **ADR** | Architecture Decision Record, stored in `docs/`. |

---

## 26. Appendix — competitive feature mapping

Ideas adopted from the market, by phase. Features and ideas only — no code, UI copying, or branding.

| Feature | Inspired by | Our phase |
|---|---|---|
| Bot-free capture | Granola, Bluedot, Scribbl | 1 |
| Two-lane me/them audio | Granola | 1 |
| Live transcript side panel | Tactiq, Otter | 1 |
| Notes as summary anchors, user vs AI text distinction | Granola | 1 |
| Fast post-meeting summary | Fathom | 1 |
| Owned action items | Circleback | 1 |
| Citations to transcript | Granola, Circleback | 1 |
| Templates | Granola Recipes, Fireflies AI Skills | 1 |
| Consent notice in chat | Enterprise bot tools | 1 |
| Cross-meeting search and chat | Fireflies AskFred, Granola Chat | 2 |
| Calendar sync, pre-meeting brief | Granola, Fireflies | 2 |
| MCP server | Granola | 2 |
| Desktop app | Granola, Otter, Fireflies | 2 |
| CRM sync, automations | Circleback, Fireflies | 3 |
| Talk-time analytics | Gong, Fireflies | 3 |
| Video and clips | Fathom, tl;dv, Scribbl | 3 |
| Optional cloud bot | Fireflies, bot APIs | 3 |

**Deliberately not adopted:** auto-emailing all attendees, default auto-join of every meeting,
training on user data, voice-based emotion analysis, voiceprint identification.
