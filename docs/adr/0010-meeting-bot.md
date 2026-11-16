# ADR-0010: Optional meeting bot ("Send notetaker") next to the extension

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-11-16): "make our own bot … give option of either use bot or extension to user". Proposed the same day. The spike gate (IMPLEMENTATION_PLAN SB-01) decides go/no-go; a no-go reopens this ADR (§6.4) |
| Date | 2026-11-16 |
| Changes | AGENTS §2 out-of-scope item "Cloud meeting bots in Phase 1"; FEATURES C7 "Buy first"; ARCHITECTURE §1 "The backend never joins meetings in Phase 1" and §24.2; IMPLEMENTATION_PLAN S9-01 (see §8) |
| Related | [ADR-0001](0001-stt-provider.md) (Deepgram) · [ADR-0003](0003-audio-transport-format.md) (Opus frames) · [ADR-0004](0004-auth-and-token-model.md) (tokens) · [ADR-0005](0005-job-queue-and-outbox.md) (queue) · [ADR-0011](0011-video-screen-recording.md) (video) · [ADR-0012](0012-azure-hosting.md) (Azure) · FEATURES C7 · PRD §3.3 |

> Facts were read on the vendors' and Google's own pages on 2026-11-16 (§10). Anything marked
> **[Verify]** comes from a secondary source, could not be confirmed, or is our estimate, and must
> be checked before or during the first build. Prices are list prices in USD on that date.

## 1. Context

On 2026-11-16 Anirudh asked for an option to add a **Fireflies-style bot** to the call instead of
using the extension, so the user can choose per meeting: **record with the extension** (bot-free,
today's product) or **invite a bot** that joins the Meet call as a named participant. On the
choice between paying a vendor and running it ourselves, his direction was **"use the best free
option"**: no paid per-hour bot vendor.

Today a bot is out of scope: AGENTS §2 lists "Cloud meeting bots in Phase 1" as out of scope,
PRD §3.3 lists cloud bots as a Phase 1 non-goal, and Phase 3 has "Optional cloud bot (own or via a
bot API)". FEATURES C7 said "buy first". This ADR proposes reversing both, **only if Anirudh
accepts it**.

What a bot is good for:
- Users who cannot or will not install the extension (another browser, a locked-down laptop, a
  phone), or who want notes from a meeting they do not attend.
- **Speaker names for free:** the bot sits inside the call and sees the participant list and the
  active-speaker tiles of every participant, including the user.
- **Visible consent:** the bot is a named participant in everyone's People list.

What it costs us: a bot is the very thing our positioning avoids (PRD §2, "No bot"), hosts must
admit it, some organisations block guests or note-taker bots, and we run a browser per meeting.
That is why it stays **optional and per meeting**, and the extension remains the default.

### 1.1 Constraints from the existing design

- **Adapters, not core changes** (AGENTS §3 rules 1–2, ARCHITECTURE §5.4). A bot is a new capture
  adapter that emits the normalized events and binary audio frames from `shared/contracts` to the
  existing realtime gateway. The gateway, pipeline, segment model, summary schema and provider
  interfaces do not change.
- **The contract has two lanes**, `me` and `them` (`Lane` in `shared/contracts/src/common.ts`), and
  frames are 16 kHz mono, 100 ms, `pcm16` or `opus` (`AudioFormat` in `ws-protocol.ts`). There is no
  per-participant lane, and adding one would be an event/frame schema change that needs its own ADR.
- **Staging hosting** is Azure for Students (ADR-0012): about USD 100 of credit, one Container
  Apps environment per region, shared with another project (WorkloadProfiles mode), Postgres on
  Supabase free.
- **Consent:** the Meet chat notice and consent log are paused behind `MEET_CHAT_NOTICE_ENABLED`
  (AGENTS §9, 2026-11-09).
- **Data residency:** audio is already transcribed by Deepgram in the US (ADR-0001 §0); the rest of
  our data lives in Central India and Supabase Mumbai.

### 1.2 Google offers no official live-media path

- The **Meet Media API** (real-time media, Developer Preview only) is being wound down: Google will
  "permanently turn down its endpoints on January 15, 2027" (Meet release notes, 2026-10-28). It
  was never an option for a product.
- The **Meet REST API** (GA) gives conference records, participants, and Meet's own recordings,
  transcripts and smart notes **after** the meeting, saved to the organizer's Drive, and only if
  Meet's own recording or transcription was on. It gives no live audio, so it cannot feed our
  Hinglish STT. It may become a separate "import from Meet" feature later; it is not a bot.

So a live bot is either a vendor's bot or a browser we run that joins as a participant.

## 2. Decision drivers

1. **Free to run at our scale** (Anirudh's direction): no per-hour vendor fee.
2. **No core changes:** the bot is an adapter (AGENTS §3).
3. **Our STT, our pipeline:** audio must reach our gateway (Deepgram, Hinglish keyterms, the
   summary engine), not a vendor's transcription.
4. **Privacy and residency:** fewest new sub-processors; data stays in our Azure region where it can.
5. **Honest and visible:** the bot is clearly named, never disguised to avoid Meet's controls.
6. **Low maintenance for two developers:** reuse code we already maintain.
7. **Licence safe for a SaaS.**

## 3. Options

### 3.1 Option A — Buy a meeting-bot API (paid; kept for comparison)

| | Recall.ai | Meeting BaaS | Skribby | Attendee (hosted) | Nylas Notetaker | Vexa (hosted) |
|---|---|---|---|---|---|---|
| Price per bot-hour | $0.50 pay-as-you-go, first 5 h free; startup programme $0.25 for the first 10,000 h; transcription +$0.15 or bring your own | Prepaid tokens, $0.50 → $0.35; streaming +$0.10 per direction; lobby wait is billed; plans $0–299/month | $0.35 base, per minute; realtime add-on +$0.05; no minimums | 5 h free, then $0.50 → $0.35 (includes transcription) | Free 5 h; $15/mo (10 h) then $0.80; $49/mo (70 h) then $0.70 | $0.30 + $0.20 realtime transcription; $2 free credit |
| Google Meet | Yes. Anonymous by default, must be admitted; signed-in via SAML "login groups" | Yes. Anonymous by default; signed-in via SAML | Yes. Guest first, then a stored Google account (Gmail or Workspace, TOTP) | Yes. Guest; signed-in since 2025-09-30 | Yes. Not signed in, must be admitted, ~10 min timeout | Yes |
| Audio to our endpoint | **Per-participant** live PCM16 16 kHz (16 loudest speakers) or mixed, over our `wss://` | PCM16 16/24 kHz over WebSocket; per-participant **[Verify]** | PCM16 16 kHz to `websocket_audio_url`; per-participant **[Verify]** | Mixed or per-participant PCM16 over WebSocket; per-participant on Meet **[Verify]** | No live media found (post-meeting webhooks) | No per-speaker audio; live transcript only |
| Speaker names / events | Join, leave, speech on/off, mic, chat over WebSocket; Meet "adaptive audio" rooms attribute everything to one person | Speaker messages (`name`, `isSpeaking`); join/leave **[Verify]** | Join/leave, speaking, mute, chat; transcript with names | Join/leave webhook; per-participant streams carry `participant_uuid` | Post-meeting | Transcript speakers |
| Regions | US West, US East, EU, **Tokyo**; no India | **Paris** (Scaleway); no India | EU, **Japan**; no India | Not stated | US endpoints only | US |
| Retention / training | Configurable, including zero retention; no training on customer data; SOC 2 Type II, ISO 27001 claimed; DPA **[Verify]** | 3–30 days by plan; DPA forbids training; "not SOC 2 compliant yet" | Audio 1 week default; no-training STT only; DPA for business; no SOC 2 found | Not stated | 14 days default; training/DPA **[Verify]** | 12-month audio storage; retention controls "not built yet"; no external audit |
| Bot name, image, chat on join | Name; image; `chat.on_bot_join` (Meet, 500 chars) | Name; image; `entry_message` (4096 chars) | Name (60 chars); avatar; `initial_chat_message`. Its docs advise human-looking names to avoid detection | Image; chat | Name; image; `messages.on_join` | Name; chat "not implemented" |

**For us:** Recall.ai is the most capable (live per-participant audio on Meet, good events,
zero-retention mode). But every option costs money per hour, adds a foreign sub-processor that
receives the whole meeting audio (none has an India region), and none is free beyond a few trial
hours. Under Anirudh's direction this option is **not chosen**; it stays the fallback in §6.4.

### 3.2 Option B — Self-host an open-source bot (free software, our compute)

| | Attendee | Vexa | ScreenApp meeting-bot |
|---|---|---|---|
| Licence | **Elastic License 2.0**, not OSI open source. Forbids providing the software "as a hosted or managed service" with "any substantial set of the features" | **Apache-2.0** | **MIT** |
| Stack | Python/Django, Selenium, pinned Chrome 134, Xvfb | Python services + a TypeScript/Node 22 bot (Playwright Chromium, Xvfb, PulseAudio) | TypeScript, Node, Playwright; optional Chrome + Xvfb sidecar |
| Meet join | Guest by default; signed-in needs a **paid Workspace domain** acting via SAML | Guest by default; optional single signed-in browser session (created once over VNC) | Anonymous guest; meetings that require sign-in are not supported |
| Audio out | Mixed or per-participant PCM16 over WebSocket, `speaker_name` in transcripts | Per-speaker buffers feed its own Whisper; raw audio stream out to another STT **[Verify]**; WebSocket streaming "not yet wired" in the open-core stack (v0.12) | A webm recording file to S3/Azure Blob; no live stream, no speaker names |
| Needs | Postgres + Redis; Kubernetes "the correct way" in production; bot pod default **4 CPU / 4 GiB** | Postgres, Redis, object storage; Docker or Helm; per-bot size not set by default | Redis (optional); sidecar 0.5–2 CPU, 1–3 GiB |
| Activity | v1.94.1 on 2026-11-14, very active | v0.12.28 on 2026-10-09, last commit 2026-11-04 | v1.2.34 on 2026-06-18, last commit 2026-08-28 |

**For us:**
- **Attendee** is the best bot functionally, but ELv2 makes running it behind our SaaS a legal
  question (our users would get its core feature set as a hosted service). It is also a second
  stack (Python, Selenium, Kubernetes) and wants 4 CPU per bot. **Rejected** unless a lawyer says
  otherwise.
- **Vexa** has a safe licence and production Meet support, but it is a whole platform (its own
  transcription, agents, workspaces, Postgres, Redis) built around Whisper. Getting raw audio out to
  our Deepgram gateway is unconfirmed, and we would run and upgrade a second platform next to ours.
- **ScreenApp** only produces a file after the meeting: no live transcript, no speaker names.

### 3.3 Option C — Build our own bot (free software, our compute)

A small TypeScript service that starts a Chromium, opens the Meet link, asks to join as a guest,
and once admitted **runs our own extension code inside the Meet page**:
- **Meet adapter** (`extension/src/adapters/meet/`: selectors, detector, metadata, speaker signal,
  mute signal, chat) gives participants, active speaker and the meeting title, exactly as in the
  extension. One selector fix serves both the extension and the bot.
- **Capture pipeline** (`extension/src/offscreen/`: PCM worklet, PCM framer, WebCodecs Opus
  encoder, stream client with acks and replay) turns the remote meeting audio into our 100 ms Opus
  frames and streams them to the gateway with a stream token.

Join and capture details (all **[Verify]** in a spike):
- **Audio source:** collect the remote WebRTC audio tracks inside the page (wrap
  `RTCPeerConnection` before Meet loads, with an init script) and mix them in an `AudioContext`.
  This avoids `tabCapture`, which a page cannot call. PulseAudio + Xvfb capture of the whole
  browser output is the fallback, as Vexa and Recall's write-ups do.
- **Headless or Xvfb:** Meet may refuse or degrade in headless mode; a headful Chromium under Xvfb is
  the safe default.
- **Join flow:** set the bot name, turn camera and microphone off, "Ask to join", wait in the lobby
  (10-minute timeout), then record. Leave when the call ends, when the bot is alone for 2 minutes,
  when the user presses Stop, or at a 3-hour cap.
- **Driver:** Playwright (`playwright-core`) is the obvious choice, already used by Vexa and
  ScreenApp. It is a **new dependency** and needs approval (AGENTS §6.7); this ADR adds none.
- **Code reuse from others:** Vexa (Apache-2.0) and ScreenApp (MIT) bots solve the same join and
  lobby problems. Their code may be studied and, where useful, copied with the licence notice kept.
  Attendee's code (ELv2) must not be copied.

**For us:** no licence question, the same language and contracts as the rest of the repo, the Meet
selectors we already maintain, and bot data that never leaves our Azure region except for STT.
The price is that we own the join flow and Meet's changes to it.

### 3.4 Not options

- **Signed-in bot on a Google account.** Google may block sign-ins from browsers "being controlled
  through software automation"; the vendors that do it use SAML on a Workspace domain or TOTP
  tricks; Google's Terms forbid "bypassing our systems or protective measures". A guest bot needs
  no account at all. Revisit only if guest admission proves to be the main failure (§6.4).
- **Meet Media API:** being turned down on 2027-01-15 (§1.2).

## 4. Decision

**Option C: build our own guest bot on top of our extension's Meet adapter and capture code,
self-hosted as one Container Apps Job execution per meeting in Central India.** No paid bot
vendor. Option A (Recall.ai) remains the documented fallback if the build fails its spike (§6.4).

### 4.1 How it fits the architecture

```
Web app ──POST /v1/bot-sessions──► API ──job bot.launch──► worker ──start execution──► Container Apps Job "bot"
                                    │                                                     │ Chromium (Xvfb)
                                    │ meeting + session rows                              │ Meet page + our Meet adapter
                                    │ (capture_source = 'bot')                            │ + our capture pipeline
                                    ▼                                                     ▼
                                Postgres ◄──────── segments, events ─────────── Realtime gateway (unchanged)
```

- **Adapter only.** The bot emits `session.started` (`platform: 'google_meet'`, unchanged),
  `participant.joined/left`, `speaker.active`, `caption.observed` (optional), `consent.notice` and
  `session.ended`, plus binary frames, over the same WebSocket protocol (`minutes.v1`). The
  gateway cannot tell a bot from the extension, and the core does not change.
- **One lane.** Everything the bot hears goes to the **`them` lane**; the `me` lane stays empty
  (`resumeFrom.me = -1`). The user's own voice arrives in `them` and is named through
  `speaker.active` like everyone else. No `mic.mute_changed` (the bot is always muted). Whether
  the assembler, speaker resolution and summary accept a session with an empty `me` lane is a
  **[Verify]** in the first test; if one does not, the fix is in that consumer's handling of an
  empty lane, not in the contract.
- **Mixed audio, not per-participant.** Per-participant audio would need new lanes in the
  contract (an ADR of its own). Speaker names come from the Meet DOM, as in the extension, and
  Deepgram diarization stays the backup. **Dependency:** the extension's active-speaker selectors
  are not yet verified on a live call (HANDOFF 2026-11-16: 0 `speaker.active` signals in staging
  meetings), so speaker names for the bot depend on fixing them first.
- **Bonus on cost:** one lane streams instead of two, so Deepgram cost per bot-hour is about half
  the extension's (PRD §20 estimate ≈ $1.10 per hour for two lanes **[Verify]**).
- **Session start** reuses `POST /v1/sessions` logic server-side: the API creates the meeting and
  session for the signed-in user, and the bot gets a **single-use launch token** (ADR-0004 style)
  that it exchanges for a stream token. No long-lived secret is in the bot image.
- **Video:** v1 is **audio only**. Recording the bot's view (ADR-0011) is later work
  (`getDisplayMedia` with auto-select inside Xvfb **[Verify]**). The meeting page shows "No video
  for notetaker recordings".
- **Notes:** the user has no side panel during a bot meeting. Summaries work without notes;
  writing notes on the web app during a bot meeting is a later feature.

### 4.2 Product and UI

DESIGN.md must get the screens before any UI is built (the design artifact and DESIGN.md are the
only UI sources). The proposal:
- **Where the user picks.** Per meeting, never as a default:
  - **Web app:** Home and Meetings get a **"Send notetaker"** field: paste a Meet link
    (`meet.google.com/abc-defg-hij`), optional title, **Join now**. The meeting then appears in the
    library with a live status: *Joining → Waiting to be let in → Recording → Processing → Ready*,
    or *Not let in* / *This meeting doesn't allow guests* with a hint to use the extension.
  - **Extension (later, P1):** the Meet prompt (DESIGN §8.2) offers "Send notetaker instead" next
    to Start, for people who would rather not capture in their own browser.
  - **Calendar auto-join:** Phase 2, after Calendar sync (FEATURES). Never on by default.
- **How the bot appears in the call:** display name **"{First name}'s notetaker (Minutes)"**
  (final wording in DESIGN.md), camera off with a static avatar if supported, microphone muted.
  It never uses a human-looking name or disguises itself to get past Meet's controls.
- **Consent text.** The bot's name is the always-on notice. A chat message on join is proposed:
  *"{First name} invited Minutes to take notes. This call is being recorded and transcribed.
  Remove this notetaker from the People list to stop it."* Whether it posts while
  `MEET_CHAT_NOTICE_ENABLED` is off is **Anirudh's decision** (open question §9.1). The bot
  writes a `consent.notice` event either way, so the consent log works when it comes back.
- **Stop.** The user can press Stop on the meeting page; any host can remove the bot from the call
  (Meet's own control), which ends the session with `left_call`.
- **Badge:** meeting rows and detail show "Recorded by notetaker" or "Recorded in Chrome".

### 4.3 API, data, infra (outline)

- **REST** (`shared/contracts` DTOs first): `POST /v1/bot-sessions` `{ meetingUrl, title? }`,
  `GET /v1/bot-sessions/{id}`, `POST /v1/bot-sessions/{id}/leave`. The URL must match
  `^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$` (the bot never opens any other URL:
  no SSRF). Limits: one live bot per user, a daily bot-hours cap per workspace, both enforced
  server-side.
- **Data** (a schema change, needs approval): `sessions.capture_source` (`extension` | `bot`);
  a `bot_runs` table with `workspace_id`, status, timestamps (requested, admitted, left), leave
  reason and bot minutes for cost (AGENTS §3 rule 10). No meeting URL in logs.
- **Infra:** a Container Apps **Job** `bot` in `infra/azure` (manual trigger, one execution per
  meeting, 2 vCPU / 4 GiB, replica timeout ~3.5 h, image with Chromium + Xvfb). The worker starts
  executions through the Azure management API with the existing managed identity (needs a role on
  the job). Jobs already run in the shared environment (`migrate`, `smoke`).

## 5. What "free" still costs

There is no bot fee, but the bot is not free to run.

### 5.1 Compute on Azure (Container Apps Consumption, Central India)

Rates from the Azure Retail Prices API on 2026-11-16: vCPU active $0.000024/s, memory
$0.000003/GiB-s. Free grant per subscription per month: 180,000 vCPU-s and 360,000 GiB-s.

| Bot size | Cost per active bot-hour | Free grant covers | USD 100 credit covers |
|---|---|---|---|
| 2 vCPU / 4 GiB (our target, **[Verify]** in the spike) | ≈ **$0.22** | ≈ 25 bot-hours/month | ≈ 460 bot-hours |
| 4 vCPU / 8 GiB (Attendee's default; Recall reports 4 cores for audio+video bots) | ≈ $0.43 | ≈ 12 bot-hours/month | ≈ 230 bot-hours |

Caveats:
- The free grant and the credit are **shared** with the API, gateway, web and worker (the worker
  runs one replica all the time) and with Managed Redis and Container Registry, so the real
  headroom is smaller **[Verify]** in Azure Cost Management.
- An "Environment Management Hour" meter ($0.10/h, from 2026-11-01) appears in the price list;
  whether it applies to our shared environment is **[Verify]**.
- Concurrency is bounded by the subscription's core quota, which "depends on the age and type of
  your subscription" **[Verify]**; Consumption allows at most 4 vCPU / 8 GiB per replica.
- Xvfb and Chromium must run unprivileged (no privileged containers on Container Apps), and
  Chromium needs `--disable-dev-shm-usage` if `/dev/shm` is small **[Verify]**.
- **Azure for Students terms** limit use to education and non-commercial work, and the subscription
  is disabled when the credit runs out. That is fine for staging test meetings; hosting bots for
  real customers needs a paid subscription (a production-hosting decision, not this ADR).

For comparison at 100 bot-hours a month: our compute ≈ $22 (part of it inside the free grant);
Recall ≈ $50 (bring-your-own STT); Skribby ≈ $35–40; Meeting BaaS ≈ $35–50 plus a plan. STT and
LLM costs are the same in every option, because audio goes to our Deepgram either way.

### 5.2 Engineering and maintenance

- **Build:** roughly 3–4 developer-weeks for the tasks in §7 **[estimate]**.
- **Meet changes:** Google changes the join screen and lobby; the bot breaks until we fix the
  selectors. Because the selectors are shared with the extension, one fix covers both, but the
  bot's join flow (name field, Ask to join, lobby, leave) is new surface. Budget a few hours a
  month **[estimate]**.
- **Chromium updates** and automation flags; a nightly canary that joins a test meeting is needed
  before users depend on the bot.
- **Detection:** Meet may decline or flag automated guests (reported by Recall and Skribby, not
  documented by Google **[Verify]**). We will not spoof fingerprints or hide the bot: if Meet blocks
  honest bots, we stop and revisit (§6.4).

### 5.3 A Google account for the bot

**None.** The bot joins as a guest. That costs nothing, but:
- a host or participant must admit it;
- meetings that only allow signed-in users or the organisation's own users refuse it, and with
  knocking off "third-party bots, like note takers" are denied automatically (Google Meet help);
- Education domains by default admit only their own users.

The UI must explain these cases and point to the extension. A signed-in bot would need Google
accounts (and for a SAML approach a paid Workspace domain) and runs into sign-in automation blocks,
so it is out (§3.4).

## 6. Consequences

### 6.1 Positive
- Users get a per-meeting choice without a paid vendor; bot data stays in Central India apart from
  STT (better residency than any vendor, none of which has an India region).
- The core, contracts and pipeline do not change; the bot proves the adapter boundary.
- Speaker names and visible consent come from being in the call.
- STT cost per bot-hour is about half the extension's (one lane).

### 6.2 Negative
- Weakens the "no bot" positioning (PRD §2, §5.3); marketing must say "bot-free by default".
- We own a browser fleet, however small: join-flow breakage, Chromium updates, capacity limits.
- No video and no live notes for bot meetings in v1.
- Guest bots fail in locked-down Workspace and Education meetings.

### 6.3 Neutral
- No new sub-processor. Deepgram and Gemini are unchanged.
- New dependency proposals (Playwright, Chromium and Xvfb in an image) come with the build PR.

### 6.4 Fallback
If the spike (§7, B-01) cannot join and capture reliably as an honest guest, or the core quota
cannot run the bot, the fallback is **Option A with Recall.ai** (best Meet support, zero-retention
mode) behind the same adapter boundary: vendor WebSocket audio → our frames → our gateway. That is
paid and would need Anirudh's approval and a sub-processor entry.

## 7. Rough task list (no product code in this ADR)

The detailed plan with estimates, gate and exit criteria is **Stage B** in
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) (tasks `SB-01`…); the list below is the
original outline.

| ID | Task | Owner (proposed) |
|---|---|---|
| B-01 | **Spike:** Chromium under Xvfb on Container Apps joins a test Meet as a guest, in-page audio capture works, size and CPU measured; go/no-go for §6.4 | Anirudh |
| B-02 | **Shared Meet code:** move the parts of `extension/src/adapters/meet/` and the capture pipeline that the bot reuses into a package both can import, with no behaviour change for the extension | Anirudh (Gaurav reviews the adapter move) |
| B-03 | **Contracts:** bot-session REST DTOs in `shared/contracts` (no event or frame schema change) | Anirudh |
| B-04 | **DB migration:** `sessions.capture_source`, `bot_runs` with `workspace_id` and RLS | Anirudh |
| B-05 | **API:** `/v1/bot-sessions` endpoints, URL allow-pattern, per-user and per-workspace limits, `bot.launch` job, single-use launch token | Gaurav (REST owner) |
| B-06 | **Bot runner** app (`backend/apps/bot`): join flow, lobby timeout, leave rules, adapter + capture injection, stream to gateway, bot minutes metering | Anirudh |
| B-07 | **Infra:** Container Apps Job `bot` in `infra/azure`, image, role for the worker to start executions, nightly canary | Gaurav (infra owner) |
| B-08 | **DESIGN.md + UI:** "Send notetaker" field, status states and errors, badge, consent text; extension prompt option later | Anirudh (UI owner) |
| B-09 | **Consent and legal:** bot name and join message, consent log entry, privacy policy and onboarding text mention the notetaker | Anirudh decides; Gaurav updates legal drafts |
| B-10 | **Tests:** unit tests for the join state machine and URL validation; a replay test feeding recorded bot frames through the gateway; a manual checklist with two Google accounts | Both |

## 8. Scope change (applied 2026-11-16 on acceptance)

Anirudh accepted this ADR on 2026-11-16; these edits were made in the same change:
- **AGENTS §2:** remove "Cloud meeting bots in Phase 1" from out of scope; add a Phase 1 (or
  stage-to-be-decided) bullet: "Optional self-hosted Google Meet notetaker bot, per meeting, guest
  join, audio only ([ADR-0010](0010-meeting-bot.md))". Phase 3's "optional cloud bot" becomes
  "bot video, calendar auto-join, other platforms".
- **AGENTS §9 Decided:** a dated entry: own guest bot, no paid vendor, Recall.ai as fallback, bot
  audio in the `them` lane, consent decision from §9.1.
- **ARCHITECTURE:** §1 driver "The backend never joins meetings in Phase 1" → "…unless the user
  sends the notetaker (ADR-0010)"; §24.2 "Bot adapter via a meeting-bot API vendor" → self-hosted
  bot; §26 backlog row 0010 → Proposed/Accepted.
- **PRD:** §3.3 non-goal "Cloud meeting bots" removed; Phase 3 bullet updated; new FR-BOT
  requirements (from §4).
- **FEATURES C7:** "Buy first" → "Build on our Meet adapter (free); Recall.ai fallback".
- **IMPLEMENTATION_PLAN:** S9-01 is replaced by B-01..B-10 in a stage Anirudh chooses (after the
  Stage 5 alpha is the natural point, since the bot reuses the alpha-tested capture code).
- **HANDOFF §4.1:** the row "Bot is optional in product Phase 3, and we buy … before building".
- **docs/adr/README.md:** status of 0010.

## 9. Verification and open questions

### 9.1 Open (Anirudh decides)
1. ~~Accept the scope change and which stage the bot lands in.~~ Accepted 2026-11-16; the bot is
   Stage B in the plan, after the Stage 5 alpha.
2. Does the bot post its join message in Meet chat while `MEET_CHAT_NOTICE_ENABLED` is off?
   Recommendation: yes, because a guest named "notetaker" is the main notice, and a separate
   `BOT_JOIN_MESSAGE_ENABLED` flag keeps it independent of the extension's paused notice.
3. Bot display name and wording (DESIGN.md).

### 9.2 To verify in the spike (B-01)
- Guest join works from Container Apps egress IPs and is not blocked or CAPTCHA'd.
- In-page remote-track capture yields complete audio; otherwise PulseAudio fallback.
- 2 vCPU / 4 GiB holds a 60-minute meeting without audio gaps; `/dev/shm` and Xvfb unprivileged.
- The gateway, assembler, speaker resolution and summary accept a `them`-only session.
- The Container Apps Job replica timeout and start latency fit (bot in the lobby within ~30 s).
- The core quota and the shared environment allow the job.
- The Meet adapter's active-speaker and participant signals work on a live call (they are
  unverified for the extension too).

## 10. Sources (read 2026-11-16)

Google:
- Meet release notes (Media API turn-down 2027-01-15; REST API items): developers.google.com/workspace/meet/release-notes
- Meet REST API overview (post-meeting artifacts in the organizer's Drive): developers.google.com/workspace/meet/api/guides/overview
- Join a meeting (Ask to join, admission, Workspace and Education defaults): support.google.com/meet/answer/9303069
- Control meeting access (bots denied when knocking is off; Open/Trusted/Restricted): support.google.com/a/users/answer/11989526
- Manage Meet settings (admin): knowledge.workspace.google.com/admin/meet/manage-meet-settings
- Sign in with a supported browser (automation-controlled browsers blocked): support.google.com/accounts/answer/7675428
- Google Terms of Service (effective 2026-07-30): policies.google.com/terms
- Workspace Acceptable Use Policy (recording consent): workspace.google.com/terms/use_policy/

Vendors (Option A):
- Recall.ai: recall.ai/pricing; docs.recall.ai/docs/google-meet, /google-meet-faq, /google-meet-login-getting-started, /how-to-get-separate-audio-per-participant-realtime, /real-time-websocket-endpoints, /sending-chat-messages, /regions, /storage-and-playback, /output-video-in-meetings; recall.ai/product/ai-agent-api
- Meeting BaaS: meetingbaas.com/pricing; docs.meetingbaas.com/llms/api; docs.meetingbaas.com/api-v2/reference/bots/createBot and /createScheduledBot; meetingbaas.com/en/legal/data-processing-agreement; meetingbaas.com/en/api/introducing-meeting-baas-v2
- Skribby: skribby.io/pricing; skribby.io/docs/guides/regions, /bot-authentication, /bot-detection, /realtime-transcription, /speaker-timelines, /transcription-privacy; skribby.io/docs/rest-api/bot-operations/createbot; skribby.io/privacy-policy
- Attendee (hosted): attendee.dev/pricing; attendee.dev/changelog; docs.attendee.dev/guides/realtimeaudio, /basics
- Nylas: nylas.com/pricing; developer.nylas.com/docs/v3/notetaker/
- Vexa (hosted): vexa.ai/pricing; vexa.ai/security; docs.vexa.ai/api/meetings.md

Open source (Option B):
- github.com/attendee-labs/attendee (LICENSE ELv2, README, Dockerfile, requirements, docs/realtime_audio.md, docs/signed_in_bots.md, bots/bot_pod_creator/bot_pod_creator.py)
- github.com/Vexa-ai/vexa (Apache-2.0, README v0.12 notes, bot Dockerfile, speaker-streams.ts, docs/adr/0049)
- github.com/screenappai/meeting-bot (MIT, README, K8s sidecar example)

Build our own (Option C), non-official engineering write-ups:
- recall.ai/blog/how-websockets-cost-us-1m-on-our-aws-bill (4 cores per bot)
- recall.ai/blog/how-i-built-an-in-house-google-meet-bot (Playwright, signed-in caption bot, CAPTCHA/2FA)

Azure:
- Azure Retail Prices API, Container Apps, centralindia: prices.azure.com/api/retail/prices
- Container Apps pricing (free grant): azure.microsoft.com/pricing/details/container-apps/
- Containers (CPU/memory pairs, no privileged containers): learn.microsoft.com/azure/container-apps/containers
- Quotas: learn.microsoft.com/azure/container-apps/quotas
- Azure for Students offer and terms: azure.microsoft.com/free/students/; azure.microsoft.com/pricing/offers/ms-azr-0170p
