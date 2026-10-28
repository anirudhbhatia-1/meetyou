# System Architecture — End to End

| Field | Value |
|---|---|
| Purpose | The complete technical architecture of the product, from capture in the browser to summaries, search, and integrations, across all phases |
| Status | Draft — design reference. Technology choices marked **(proposed)** need an ADR before implementation |
| Last updated | 2026-10-28 |
| Related | [PRD.md](PRD.md) · [FEATURES.md](FEATURES.md) · [AGENTS.md](../AGENTS.md) · [STT_PREFLIGHT.md](STT_PREFLIGHT.md) · [STT_BENCHMARK_PLAN.md](STT_BENCHMARK_PLAN.md) |

> **Scope.** Phase 1 (Google Meet Chrome extension) is described in full detail. Phase 2 and 3
> components are described at the level needed to make sure Phase 1 does not block them.
> Requirement IDs (e.g. `FR-CAP-07`) refer to the PRD; feature IDs (e.g. `C4`) refer to FEATURES.md.

---

## Contents

1. [Architecture drivers](#1-architecture-drivers)
2. [System context](#2-system-context)
3. [Container view](#3-container-view)
4. [Chrome extension architecture](#4-chrome-extension-architecture)
5. [Capture and streaming protocol](#5-capture-and-streaming-protocol)
6. [Realtime gateway](#6-realtime-gateway)
7. [Provider abstraction layer](#7-provider-abstraction-layer)
8. [Transcript assembly](#8-transcript-assembly)
9. [Post-meeting processing pipeline](#9-post-meeting-processing-pipeline)
10. [Summarization engine](#10-summarization-engine)
11. [Data architecture](#11-data-architecture)
12. [API design](#12-api-design)
13. [Authentication and authorization](#13-authentication-and-authorization)
14. [Security architecture and threat model](#14-security-architecture-and-threat-model)
15. [Privacy architecture](#15-privacy-architecture)
16. [Key end-to-end flows](#16-key-end-to-end-flows)
17. [Deployment topology](#17-deployment-topology)
18. [Scalability and capacity](#18-scalability-and-capacity)
19. [Reliability and failure modes](#19-reliability-and-failure-modes)
20. [Observability](#20-observability)
21. [Performance budgets](#21-performance-budgets)
22. [Cost architecture](#22-cost-architecture)
23. [Repository structure](#23-repository-structure)
24. [Evolution: Phase 2 and Phase 3](#24-evolution-phase-2-and-phase-3)
25. [Technology choices](#25-technology-choices)
26. [ADR backlog and open questions](#26-adr-backlog-and-open-questions)

---

## 1. Architecture drivers

| Driver | Architectural consequence |
|---|---|
| **Bot-free capture** | Capture runs on the user's device (Chrome extension, later desktop app). The backend never joins meetings in Phase 1. |
| **Two lanes (`me` / `them`)** | Lanes stay separate end to end: capture, transport, STT sessions, storage, segments. |
| **Platform-agnostic core** | A strict boundary: *adapters* emit normalized events; the *core* consumes only those events. |
| **Provider-swappable STT and LLM** | All vendor calls sit behind interfaces with capability descriptors; vendor choice is configuration. |
| **Hinglish-first** | Language handling, transliteration (Roman display), and raw-text preservation are first-class pipeline steps. |
| **Trustworthy summaries** | Structured LLM output, segment-ID citations, server-side validation. LLM never produces timestamps. |
| **Privacy by default** | Short audio retention (7 days default), no content in logs, paid no-training vendor tiers, deletion propagation. |
| **Multi-tenant from day one** | `workspace_id` on every row, enforced in the data layer. |
| **No data loss** | Sequence numbers + acknowledgements + local buffering + idempotent processing. |
| **Low cost per meeting-hour** | Usage metering per meeting; cost levers (silence gating, cheaper batch models) designed in. |

---

## 2. System context

```
                         ┌──────────────────────────┐
                         │          User            │
                         │  (Chrome on laptop/desk) │
                         └────────────┬─────────────┘
                                      │ uses
              ┌───────────────────────┼─────────────────────────┐
              ▼                       ▼                         ▼
     ┌─────────────────┐    ┌───────────────────┐     ┌───────────────────┐
     │  Google Meet    │◄───┤ Our Chrome        │     │ Our web app       │
     │  (meet.google.  │ DOM│ extension         │     │ (library, beta+)  │
     │   com tab)      │    │ (capture + UI)    │     └─────────┬─────────┘
     └─────────────────┘    └─────────┬─────────┘               │
                                      │ HTTPS + WSS             │ HTTPS
                                      ▼                         ▼
                         ┌───────────────────────────────────────────┐
                         │               Our backend                 │
                         │  API · Realtime gateway · Workers · Data  │
                         └──┬──────────┬───────────┬──────────┬──────┘
                            │          │           │          │
                            ▼          ▼           ▼          ▼
                     ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────────┐
                     │ STT      │ │ LLM     │ │ Google  │ │ Phase 2/3:        │
                     │ vendors  │ │ vendors │ │ OAuth   │ │ Calendar, Slack,  │
                     │ (Sarvam/ │ │ (Gemini/│ │ (sign-  │ │ Notion, CRM,      │
                     │ Deepgram/│ │ Claude/ │ │  in)    │ │ MCP clients,      │
                     │ Gemini)  │ │ …)      │ │         │ │ payments, bot API │
                     └──────────┘ └─────────┘ └─────────┘ └───────────────────┘
```

**Trust boundaries:** (1) the user's browser, (2) Google Meet's page (untrusted DOM),
(3) our backend, (4) third-party vendors (sub-processors).

---

## 3. Container view

```
┌──────────────────────────────── CHROME EXTENSION (MV3) ─────────────────────────────────┐
│ Content script (Meet adapter: detection, metadata, active speaker, chat notice)        │
│ Service worker (control plane: session state machine, auth tokens, tabCapture ID)      │
│ Offscreen document (media plane: capture, AudioWorklet, encoder, IndexedDB, WebSocket) │
│ Side panel UI (live transcript, notes, summary) · Extension pages (onboarding,         │
│ settings, library in alpha)                                                            │
└───────────────┬──────────────────────────────────────────────┬─────────────────────────┘
                │ WSS: audio + events + live transcript        │ HTTPS: REST API
                ▼                                              ▼
┌──────────────────────────┐                     ┌──────────────────────────┐
│ Realtime gateway         │                     │ API service              │
│ - session streams        │                     │ - auth, sessions, CRUD   │
│ - STT provider sessions  │                     │ - meetings, notes,       │
│ - transcript assembly    │                     │   summaries, settings    │
│ - audio persistence      │                     │ - export, deletion       │
└───────┬──────────┬───────┘                     └───────┬──────────────────┘
        │          │                                     │
        │          ▼                                     │
        │   ┌─────────────┐   ┌──────────────────────────▼─────┐   ┌───────────────────┐
        │   │ Redis       │   │ PostgreSQL                     │   │ Object storage    │
        │   │ (session    │   │ - all metadata, segments,      │   │ (S3-compatible)   │
        │   │  state,     │   │   notes, summaries, usage      │   │ - audio chunks    │
        │   │  pub/sub)   │   │ - job queue + outbox (proposed)│   │ - exports         │
        │   └─────────────┘   │ - full-text search (Phase 1)   │   │ - encrypted (SSE) │
        │                     │ - pgvector (Phase 2)           │   └───────────────────┘
        │                     └──────────────┬─────────────────┘
        │                                    │ jobs
        ▼                                    ▼
┌──────────────────────────┐   ┌──────────────────────────────────────────────────────┐
│ STT vendors (streaming)  │   │ Workers                                              │
└──────────────────────────┘   │ - finalize · batch re-transcribe · speaker resolve   │
                               │ - summarize · validate citations · index · notify    │
                               │ Scheduler                                            │
                               │ - retention deletion · usage rollups · health checks │
                               └───────────────┬──────────────────────────────────────┘
                                               ▼
                               ┌──────────────────────────────┐
                               │ STT batch + LLM vendors      │
                               └──────────────────────────────┘

Cross-cutting: secrets manager · logging/metrics/tracing · error reporting · CI/CD
```

| Container | Runtime | Scales by | State |
|---|---|---|---|
| Extension | User's Chrome | Users | chrome.storage, IndexedDB |
| Realtime gateway | Long-running containers (WebSockets — **not serverless functions**) | Concurrent sessions | Per-session state in Redis; audio to object storage |
| API service | Containers | Requests | Stateless |
| Workers | Containers | Queue depth | Stateless (jobs in DB) |
| Scheduler | Single leader (or cron) | — | Stateless |
| PostgreSQL | Managed | Vertical + read replicas | System of record |
| Redis | Managed | Memory | Ephemeral (rebuildable) |
| Object storage | Managed | — | Audio, exports |

---

## 4. Chrome extension architecture

### 4.1 Components and responsibilities
| Component | Responsibility | Lifetime |
|---|---|---|
| **Content script** (Meet adapter) | Detect in-call state; read title and participant names; observe active speaker and mute state; post consent notice in chat; show "Start recording" chip | While a Meet tab is open |
| **Service worker** | Control plane: recording state machine, auth/token refresh, obtain `tabCapture` stream ID, create/close offscreen document, badge updates, message routing | Ephemeral (Chrome stops it when idle) — **holds no critical state in memory** |
| **Offscreen document** | Media plane: open tab and mic streams, playback routing, AudioWorklet resampling, optional Opus encoding, IndexedDB buffer, WebSocket to gateway | Exists only while recording |
| **Side panel** | Live transcript, notepad, summary, health indicator | User-opened |
| **Extension pages** | Onboarding (mic permission), settings, library (alpha) | User-opened |

### 4.2 Internal messaging
```
Content script ──runtime messages──► Service worker ◄──runtime port──► Offscreen document
      ▲                                    │  ▲                               │
      │ adapter events                     │  │ state, health                 │ WSS
      │ (speaker.active, participants,     ▼  │                               ▼
      │  mute, meeting ended)          Side panel ◄────── live transcript ── Gateway
```
- Adapter events flow content script → service worker → offscreen document → gateway (as
  normalized events, §5.4).
- Live transcript flows gateway → offscreen document → side panel.
- The **recording state is persisted in `chrome.storage.session`** so a restarted service worker can
  recover it.

### 4.3 Recording state machine
```
idle ──start──► starting ──streams ok──► recording ──pause──► paused
  ▲                │                        │  ▲                 │
  │                │ error                  │  └────resume───────┘
  │                ▼                        │ network lost
  │              error ◄────────────────────┤──────────────► reconnecting ──ok──► recording
  │                                         │ stop / tab closed / call ended
  │                                         ▼
  └──────────────── ready ◄── processing ◄── stopping (flush buffer, session.ended)
```

### 4.4 Audio graph (offscreen document)
```
Tab stream (them) ──► MediaStreamSource ──┬──► AudioContext.destination  (user keeps hearing Meet)
                                          └──► AudioWorklet(them): downmix → resample 16 kHz → PCM16
Mic stream (me, echoCancellation on) ────────► AudioWorklet(me):   resample 16 kHz → PCM16
                                                     │
                       ┌─────────────────────────────┴───────────────────────────┐
                       ▼                                                         ▼
         Framer: 100 ms frames per lane                           Encoder (optional, D-06):
         + header {lane, seq, captureMs}                          Opus for transport/storage
                       │
                       ▼
         IndexedDB buffer (write first) ──► WebSocket sender ──► gateway
                       ▲                                   │
                       └──────── prune on ack ◄────────────┘
```

### 4.5 Local storage
| Store | Contents | Retention |
|---|---|---|
| `chrome.storage.local` | Settings cache, refresh token (see §13), onboarding flags | Until sign-out |
| `chrome.storage.session` | Recording state machine, current session ID | Browser session |
| IndexedDB `audio_buffer` | Unacknowledged audio frames per lane | Until acknowledged; recovered after crash |
| IndexedDB `notes_drafts` | Notepad lines not yet synced | Until synced |

### 4.6 Meet adapter internals
```
meet-adapter/
  selectors        one module holding every DOM selector, each with fallbacks and a version tag
  detector         URL + in-call controls → in_call / lobby / ended
  metadata         meeting title, participant display names
  speakerSignal    active-speaker tile changes → speaker.active events
  muteSignal       local mic mute state → me-lane gating (FR-CAP-11)
  chatNotice       types and sends consent notice; reports success/failure
  health           which selectors matched this session (no content) → O6 monitoring
```
DOM text read from Meet is **untrusted input**: length-limited, sanitized, never executed or
rendered as HTML.

### 4.7 Permissions (see PRD §18)
`tabCapture`, `offscreen`, `sidePanel`, `storage`, `notifications`, `identity` (if used), host
permissions for `https://meet.google.com/*` and our API domain; keyboard shortcuts via the
`commands` manifest key. No `<all_urls>`. `externally_connectable` is not
set, so web pages cannot message the extension.

---

## 5. Capture and streaming protocol

### 5.1 Session start
1. Extension calls `POST /v1/sessions` with `{ platform: "google_meet", meetingCode, title?, clientInfo }`.
2. API creates `meeting` + `session` rows and returns
   `{ sessionId, meetingId, streamUrl, streamToken, expiresAt, audioFormat }`.
   `streamToken` is a short-lived token **scoped to this one session**.
3. Offscreen document connects to `streamUrl` with the token.

### 5.2 Message types
**Client → gateway**

| Type | Frame | Payload |
|---|---|---|
| `hello` | JSON | `{ sessionId, resumeFrom: { me: lastAckSeq, them: lastAckSeq }, format }` |
| `audio` | Binary | Header `{ lane (1 byte), seq (uint32), captureMs (uint32) }` + audio payload (PCM16 100 ms = 3,200 bytes, or Opus packet) |
| `event` | JSON | A normalized capture event (§5.4) with `seq` |
| `control` | JSON | `pause`, `resume`, `end` |
| `ping` | JSON | Keep-alive |

**Gateway → client**

| Type | Payload |
|---|---|
| `ready` | `{ sessionId, acceptedFormat }` |
| `ack` | `{ lane, upToSeq }` — client prunes its buffer |
| `transcript.interim` | `{ lane, text, startMs }` — not stored |
| `transcript.segment` | Full segment (§8.2) — stored |
| `speaker.update` | `{ clusterId, participantId?, displayName? }` |
| `health` | `{ stt: ok/degraded/down, lanes: {...} }` |
| `error` | `{ code, retryable }` |
| `pong` | — |

### 5.3 Ordering, acknowledgement, replay
- Each lane has its own monotonically increasing `seq`.
- The gateway acknowledges a frame **only after it is durably stored** (object storage chunk write or
  write-ahead in Redis with flush), so acknowledged = safe.
- On reconnect the client sends `hello.resumeFrom`; gateway replies with its last durable `seq` per
  lane; client replays the gap from IndexedDB.
- Duplicate frames (same lane + seq) are ignored.

### 5.4 Normalized capture events (adapter → core)
The contract defined in [AGENTS.md §4](../AGENTS.md):
`session.started`, `participant.joined`, `participant.left`, `speaker.active`, `audio.chunk`,
`caption.observed` (optional), `session.ended`. Any change to this schema requires an ADR, because
every future adapter (desktop, upload, bot) emits the same events.

### 5.5 Clock model
- **Session clock** starts at 0 when capture begins (`captureMs`). Both lanes share it.
- All segment times, note timestamps, and speaker events are in session milliseconds.
- Pauses: the session clock keeps running; paused intervals are recorded so the UI can show gaps.
- Wall-clock start time is stored once on the session for display.

### 5.6 Audio format and bandwidth (decision D-06)
| Option | Bandwidth (2 lanes) | Notes |
|---|---|---|
| PCM16, 16 kHz | ~512 kbps | Simplest; every STT provider accepts it; heavy on weak connections |
| Opus 24–32 kbps | ~48–64 kbps | Needs decoding (or provider support); benchmark Phase D checks accuracy impact |

Proposal: **Opus over the wire, decoded to PCM in the gateway** if the benchmark shows no accuracy
loss; PCM as fallback. Stored audio is Opus either way.

---

## 6. Realtime gateway

### 6.1 Responsibilities
1. Authenticate the stream token; bind the connection to a session.
2. Persist audio per lane to object storage in time-bounded chunks (e.g. 10 s Opus objects) —
   **always**, because batch re-transcription and recovery need it; retention deletes it later.
3. Maintain one **STT streaming session per lane** through the provider layer (§7).
4. Assemble final results into segments (§8), store them, push them to the client.
5. Forward interim results to the client (not stored).
6. Store normalized capture events (speaker, participants) for speaker resolution.
7. Emit internal events (`segment.finalized`, `session.ended`) via the outbox (§9.1).
8. Report health to the client.

### 6.2 Session state and failover
- Per-session state lives in **Redis**: last durable seq per lane, provider session metadata,
  language config, keyterms, clock offsets.
- A WebSocket is bound to one gateway instance. If that instance dies, the client reconnects (any
  instance), the new instance loads state from Redis, and replay fills the gap.
- Load balancer: WebSocket-capable, long idle timeouts, no sticky sessions required.

### 6.3 STT session management
| Concern | Handling |
|---|---|
| Idle timeouts (e.g. Deepgram ~10 s) | Provider adapter sends keep-alives during silence and pause |
| Max session length (e.g. Gemini Live 10 min) | Rotate sessions before the limit with a few seconds of **overlap**; de-duplicate words in the overlap by timestamp |
| Provider disconnect | Reconnect with backoff; replay recent audio from the gateway's short ring buffer |
| Provider outage | Mark health `degraded`; keep persisting audio; mark the session for batch transcription after the meeting; optionally fail over to a secondary provider |
| Concurrency limits | Per-provider connection limiter; queue or fail over when exhausted |

### 6.4 Silence gating (cost optimization, later)
The `me` lane is often silent. A gateway-side voice-activity detector can stop forwarding silence to
the STT provider while keeping an **offset map** so timestamps stay correct. Phase 1 forwards
everything (simpler, correct); gating is an optimization behind a flag, measured with usage records.

---

## 7. Provider abstraction layer

All vendor calls live in `providers/`. Nothing else imports vendor SDKs (AGENTS.md rule 3).

### 7.1 Interfaces (contract sketch, not implementation)
```
SttStreamingProvider
  capabilities(): {
    maxSessionMs?, idleTimeoutMs?, interim: bool, diarization: bool,
    wordTimestamps: bool, outputScripts: ["devanagari","roman","mixed"],
    vocabulary: { maxTerms?, maxTokens?, midStreamUpdate: bool },
    audioFormats: [...], languages: [...]
  }
  open(config: { lane, language, script, vocabulary, sampleRate, format }): SttStream

SttStream
  send(frame)            // audio with session timestamp
  updateVocabulary(terms)
  close()
  events: interim(text, startMs) | final(result) | error(code, retryable) | closed(reason)

SttBatchProvider
  capabilities(): { maxDurationMs, diarization, maxSpeakers, wordTimestamps, ... }
  transcribe(audioRef, config): Promise<BatchResult>   // may chunk internally per limits

LlmProvider
  generateStructured(request: { system, input, jsonSchema, temperature, maxTokens }):
    Promise<{ json, usage: { inputTokens, outputTokens }, model }>

Transliterator
  toRoman(text, sourceLang): { text, confidence }

EmbeddingProvider            // Phase 2
  embed(texts[]): vectors[]
```

### 7.2 Normalized STT result
```
{ lane, startMs, endMs, text, rawText, language, confidence?,
  words?: [{ text, startMs, endMs, confidence? }],
  speakerLabel?,            // provider cluster label, if any
  provider, model }
```

### 7.3 Provider registry and routing
- Configuration selects providers per environment and, later, per workspace or language
  (e.g. `streaming: sarvam`, `batch: gemini-transcribe`).
- Capability descriptors drive behaviour (rotation, keep-alive, whether batch diarization is needed),
  so swapping vendors does not change pipeline code.
- Vendor data-use controls are applied **inside each adapter** and cannot be turned off by callers:
  Deepgram `mip_opt_out=true` on every request, Gemini only on billing-enabled projects, Sarvam
  account-level opt-out verified at startup by configuration check (see STT_PREFLIGHT.md).

---

## 8. Transcript assembly

### 8.1 Steps per final STT result
1. Map provider times to the session clock.
2. **Transliterate** to Roman display text if the result is not already Roman (D-01); keep `rawText`.
3. Normalize spelling with the canonical Hinglish list (display only; raw kept).
4. Attach provisional speaker: `me` lane → user; `them` lane → provider label or `unknown`.
5. Assign a stable **segment ID** (ULID) and store.
6. Push `transcript.segment` to the client.
7. De-duplicate obvious echo: if near-identical text appears in `me` and `them` within a short window,
   flag the `me` copy as probable echo (do not delete; exclude from summary input).

### 8.2 Segment shape
See [AGENTS.md §4](../AGENTS.md) and PRD §13:
`{ id, workspaceId, meetingId, lane, speakerClusterId?, speakerName?, startMs, endMs, text, rawText,
language, source: live|batch, words?, flags: [echo?, lowConfidence?] }`

### 8.3 Live vs batch segments
Batch re-transcription (D2) produces `source=batch` segments. Replacement keeps citations valid by
**mapping old segment IDs to the batch segments that overlap them in time**; the summary is
regenerated if content changed materially.

---

## 9. Post-meeting processing pipeline

### 9.1 Events and jobs
- Services write domain events to an **outbox table** in the same transaction as the data change;
  a dispatcher turns outbox rows into jobs. This guarantees no event is lost if a process crashes.
- Jobs live in a Postgres-backed queue (proposed) with retries, backoff, and a dead-letter state.

### 9.2 Pipeline DAG
```
session.ended
    │
    ▼
[1] finalize_transcript ── wait for in-flight finals, close STT sessions, seal segments
    │
    ├──────────────────────────────► [2] summarize (uses live transcript, fast path)
    │                                     │
    │                                     ▼
    │                                [3] validate_citations_and_owners
    │                                     │
    │                                     ▼
    │                                [4] index_for_search ──► [5] notify_user ("notes ready")
    │
    └─► [6] batch_retranscribe (if audio retained and enabled)
              │
              ▼
         [7] resolve_speakers (batch diarization + speaker.active events)
              │
              ▼
         [8] compare_and_maybe_resummarize ──► [3] → [4] → notify ("notes updated")

[9] retention_schedule ── set delete_after on audio assets once [2..4] succeeded
```
The fast path (1→2→3→4→5) targets the **≤ 60 s P95** summary budget. The batch path improves
quality afterwards without delaying the first result.

### 9.3 Job rules
- **Idempotent:** keyed by `(meeting_id, step, input_version)`; re-running never duplicates rows.
- **Resumable:** each step reads persisted inputs, never in-memory state from a previous step.
- **Observable:** every job records duration, attempts, provider, usage.
- **Progress:** steps 1–3 advance `meetings.processing_step`; step 5 sets `status = ready` (or
  `too_short` / `failed`) and triggers the Chrome notification via the extension.
- **Action-item status survives regeneration:** when a new summary version is accepted, existing
  action items are matched by text similarity and owner, and their `status`/`completed_at` carry over.
- **Retention safety:** the "delete immediately" policy is applied only by step 9, which runs only
  after the summary succeeded (D-02).

---

## 10. Summarization engine

### 10.1 Prompt assembly
```
SYSTEM: role, rules (anchors verbatim, cite segment IDs, no invented facts, owners from list only,
        decisions only on explicit agreement), output language/script, template rules
INPUT:
  <meeting> title, date, duration </meeting>
  <participants> [{id, name, isSelf}] </participants>
  <notes> [{id, sessionMs, marker, text}] </notes>
  <transcript> [seg_01HX…] (03:12) Rahul: … </transcript>   ← echo-flagged segments excluded
OUTPUT: JSON matching the summary schema (PRD §14.3)
```
- Transcript and notes are wrapped as **data**, with an instruction that their content is never to
  be treated as instructions (prompt-injection defence — see §14.3).
- Single pass for typical meetings; above a token threshold, chunk by time windows with overlap and
  merge (rarely needed).

### 10.2 Validation chain
1. Parse JSON; on failure, retry once with the validation error.
2. Validate against the schema.
3. Drop/flag items whose `segment_ids` are empty or unknown.
4. Replace unknown owners with `unassigned`.
5. Resolve relative due dates using the meeting date.
6. (P2) Flag numbers/dates/names not present in cited segments.
7. Store as a new **summary version** with model, template, language, usage.

### 10.3 Templates
Templates are **data** (sections, emphasis rules, extra schema fields), versioned in the database,
not hard-coded prompts. Prompt and template versions are recorded on every summary so quality
regressions can be traced (O4).

---

## 11. Data architecture

### 11.1 Stores
| Store | Holds | Notes |
|---|---|---|
| PostgreSQL | All structured data (PRD §13), job queue, outbox, full-text index; vectors in Phase 2 | System of record |
| Object storage | Audio chunks, mixed playback renditions, exports | Server-side encryption; lifecycle rules as backstop for retention |
| Redis | Realtime session state, pub/sub between gateway instances | Rebuildable; no system-of-record data |

### 11.2 Identifiers
ULIDs for all entities and segments (sortable by time, safe to generate on any node).

### 11.3 Tenancy enforcement
- Every table has `workspace_id`.
- **Row-level security** in Postgres keyed on a per-request workspace setting, plus a data-access
  layer that refuses queries without a workspace context. Defence in depth: either alone would
  catch most mistakes; together they make cross-tenant leaks very unlikely.
- Automated tests attempt cross-workspace reads and must fail.

### 11.4 Object storage layout
```
ws/{workspaceId}/meetings/{meetingId}/audio/{lane}/{chunkStartMs}.opus
ws/{workspaceId}/meetings/{meetingId}/audio/mixed.opus          (playback rendition, optional)
ws/{workspaceId}/exports/{exportId}.zip
```
Keys contain only IDs — no names, titles, or emails.

### 11.5 Search
- **Phase 1:** Postgres full-text search over a normalized column (lowercase, canonical Hinglish
  spelling, Roman script) for segments, notes, and summary items.
- **Phase 2:** hybrid search — keyword + vector (pgvector) with multilingual embeddings; chunks built
  from segment windows and summary items, each carrying workspace and permission metadata.

### 11.6 Retention and deletion
| Mechanism | Purpose |
|---|---|
| `audio_assets.delete_after` + scheduler job | Enforce D-02 retention (7 days default) |
| Object storage lifecycle rule (e.g. 31 days) | Backstop if the job fails |
| Deletion job | Meeting/account deletion across DB rows, object storage, search index, vector index |
| Backups | Point-in-time recovery with **≤ 30-day** retention, matching the deletion promise |
| `deletion_requests` table | Audit trail |

---

## 12. API design

REST over HTTPS, JSON, versioned under `/v1`. Realtime uses the WebSocket protocol in §5.

### 12.1 Phase 1 endpoints
| Area | Endpoints |
|---|---|
| Auth | `POST /v1/auth/google` (exchange Google ID token) · `POST /v1/auth/refresh` · `POST /v1/auth/logout` |
| Me & settings | `GET /v1/me` · `GET/PATCH /v1/settings` |
| Sessions | `POST /v1/sessions` · `POST /v1/sessions/{id}/end` · `POST /v1/sessions/{id}/recover` |
| Meetings | `GET /v1/meetings` · `GET/PATCH/DELETE /v1/meetings/{id}` · `POST /v1/meetings/{id}:restore` (within the delete grace period) |
| Action items | `GET /v1/action-items?status=open\|done\|all&owner=me\|any&cursor=` · status, owner, and due changes via `PATCH /v1/summary-items/{id}` |
| Glossary | `GET /v1/glossary` · `PUT /v1/glossary` (replace list; validated against provider limits) |
| Transcript | `GET /v1/meetings/{id}/segments?cursor=` · `PATCH /v1/meetings/{id}/speakers/{clusterId}` |
| Notes | `GET/PUT /v1/meetings/{id}/notes` |
| Summaries | `GET /v1/meetings/{id}/summary` · `POST /v1/meetings/{id}/summary:regenerate` · `PATCH /v1/summary-items/{id}` · `POST /v1/feedback` |
| Audio | `GET /v1/meetings/{id}/audio` → short-lived signed URL |
| Consent | `GET /v1/meetings/{id}/consent-log` |
| Search | `GET /v1/search?q=` |
| Export & deletion | `POST /v1/exports` · `GET /v1/exports/{id}` · `POST /v1/account:delete` |

### 12.2 Conventions
- Cursor pagination; ETags for notes/summary edits (optimistic concurrency).
- Idempotency keys on mutating requests from the extension (retries after network loss).
- Errors: `{ error: { code, message, retryable } }`.
- Request/response schemas defined once in `shared/` and validated on both sides.

### 12.3 Library updates and processing progress
The side panel gets live updates over the session WebSocket while recording. After `session.ended`
the gateway closes the stream; the side panel and library then follow the meeting's `status` and
`processing_step` (`finalizing → summarizing → validating → done`, PRD FR-PROC-07) via
**server-sent events** on `GET /v1/meetings/{id}/events` (fallback: polling `GET /v1/meetings/{id}`
every 2 s). Each fast-path job (§9.2 steps 1–3) updates `processing_step` in the same transaction as
its result.

---

## 13. Authentication and authorization

### 13.1 Tokens
| Token | Issued by | Lifetime | Stored | Used for |
|---|---|---|---|---|
| Google ID token | Google | Minutes | Not stored | One-time exchange at sign-in |
| Access token | Our API | ~15 min | Memory / `chrome.storage.session` | REST calls |
| Refresh token | Our API | Rotating, revocable | `chrome.storage.local` | Getting new access tokens |
| Stream token | Our API | Session-scoped, short | Memory (offscreen doc) | One WebSocket session only |

- Refresh tokens rotate on every use; reuse of an old refresh token revokes the family (theft signal).
- **No vendor API keys ever reach the client.**

### 13.2 Authorization model
- Phase 1: user ↔ personal workspace (owner).
- Phase 3: roles (owner/admin/member/guest), folder permissions, share links with scopes — the
  authorization check is centralized (one policy module) so new roles do not touch every endpoint.

---

## 14. Security architecture and threat model

### 14.1 Controls
| Layer | Controls |
|---|---|
| Transport | TLS everywhere (HTTPS/WSS); HSTS on web app |
| Data at rest | DB and object storage encryption; secrets in a secrets manager |
| Extension | Minimal permissions; strict CSP; no remote code; no `externally_connectable`; Meet DOM text treated as untrusted |
| API | Input validation at the boundary; rate limiting per user and IP; idempotency keys; audit of sensitive actions |
| Tenancy | RLS + data-access layer + cross-tenant tests |
| Media access | Signed, expiring URLs; no public buckets |
| Supply chain | Dependency scanning, lockfiles, pinned CI actions |
| Logging | No transcript text, audio, names, emails, or tokens; IDs and counts only |

### 14.2 Threats and mitigations
| Threat | Mitigation |
|---|---|
| Stolen refresh token from a compromised device | Rotation + reuse detection; revocation; short access tokens |
| Malicious web page tries to talk to the extension | No `externally_connectable`; content script only on Meet; validate all messages by sender |
| Meet DOM manipulation (e.g. crafted participant names) | Sanitize and length-limit; never render as HTML; never use as code |
| Cross-tenant data access bug | RLS, central data-access layer, automated tests |
| Leaked vendor key | Keys only server-side; per-environment keys; rotation; spend alerts |
| Audio URL sharing | Short-lived signed URLs bound to the requesting user |
| Abuse (recording without consent) | Consent notice defaults, consent log, stop-and-delete, terms of use |

### 14.3 Prompt injection through meeting content
A participant can say (or name themselves) "ignore previous instructions and…". Defences:
1. Transcript and notes are passed as **delimited data**, with explicit instructions to treat them
   only as content.
2. The summarization LLM has **no tools and no side effects** — it can only return JSON.
3. Output is schema-validated and every claim must cite existing segments.
4. Phase 2 features that *act* (integrations, automations, MCP) never execute instructions found in
   meeting content; actions come only from user-configured rules or explicit user clicks.

---

## 15. Privacy architecture

### 15.1 Data flow to sub-processors
```
Extension ──audio──► Gateway ──audio──► STT vendor (paid tier, training opt-out enforced in adapter)
                         │
                         └─► Object storage (encrypted, 7-day default retention)
Workers ──transcript text──► LLM vendor (paid tier, no training)
Workers ──(Phase 2) text chunks──► Embedding vendor (same rules)
```

### 15.2 Rules enforced by architecture (not by convention)
| Rule | Where enforced |
|---|---|
| Vendor training opt-outs | Inside provider adapters (§7.3); config check at startup refuses to run with free/unpaid keys in production |
| Retention | Scheduler + lifecycle backstop (§11.6) |
| Deletion propagation | Deletion job covers DB, object storage, search/vector indexes; vendor-side retention documented per vendor |
| No content in telemetry | Logging library with an allow-list of fields; analytics events typed to IDs/counts/enums |
| Minimal Google scopes | Auth service requests only `openid email profile` in Phase 1 |
| No voiceprints | Diarization outputs are per-meeting labels only; no embeddings stored across meetings |

---

## 16. Key end-to-end flows

### 16.1 Start recording
```
User      Content script   Service worker      Offscreen doc        API            Gateway
 │ joins Meet   │                │                   │                 │                │
 │─────────────►│ in_call        │                   │                 │                │
 │◄─────────────│ show chip      │                   │                 │                │
 │ click Start ─┼───────────────►│ tabCapture ID     │                 │                │
 │              │                │ create offscreen ►│                 │                │
 │              │                │───────────────────┼─POST /sessions─►│                │
 │              │                │◄──────────────────┼─ token, url ────│                │
 │              │                │ start(streamId) ─►│ open tab+mic    │                │
 │              │                │                   │──── WSS hello ──┼───────────────►│
 │              │                │                   │◄─── ready ──────┼────────────────│
 │              │ consent notice │◄── state=recording│                 │                │
 │              │ posted in chat │ badge REC         │── audio/events ─┼───────────────►│
```

### 16.2 Live transcription
```
Offscreen ──audio(lane,seq)──► Gateway ──store chunk──► Object storage
                                  │──ack(seq)──► Offscreen (prune buffer)
                                  │──frame──► STT stream (per lane)
                                  │◄─interim/final── STT
                                  │ final → transliterate → segment → Postgres
                                  └─transcript.segment──► Offscreen ──► Side panel
```

### 16.3 Network drop and recovery
```
Offscreen: WSS closed → state=reconnecting → keep capturing → frames accumulate in IndexedDB
Offscreen: reconnect (backoff) → hello{resumeFrom} → Gateway (any instance) loads Redis state
Gateway: reply last durable seq per lane → Offscreen replays gap → STT receives backlog (faster
than real time where the provider allows; otherwise gap is marked for batch transcription)
```

### 16.4 End of meeting to notes
```
Stop / leave / tab closed → Offscreen flushes buffer → control:end → Gateway closes STT sessions
→ session.ended (outbox) → finalize → summarize → validate → index → notify ("notes ready")
→ Side panel shows summary; library status = ready
→ (background) batch re-transcribe → resolve speakers → maybe re-summarize → notify ("updated")
```

### 16.5 Viewing a citation
```
Side panel hover marker → segment IDs already in summary payload → show quote, speaker, time
Click → open transcript at segment → request signed audio URL → play from startMs
```

### 16.6 Deleting a meeting
```
DELETE /v1/meetings/{id} → meetings.deleted_at = now, deletion_request{execute_after = now + 10 s}
→ meeting hidden from all lists immediately; UI shows Undo for 5 s
→ (Undo) POST /v1/meetings/{id}:restore → cancelled_at set, deleted_at cleared
→ (no Undo) deletion job runs after execute_after: DB rows (segments, notes, summaries, citations,
  consent log) → object storage (audio, exports) → search/vector index → mark request complete
  → backups age out within 30 days
Account deletion has no undo grace; it runs on confirmation (PRD FR-SET-03).
```

---

## 17. Deployment topology

### 17.1 Environments
| Environment | Purpose | Data |
|---|---|---|
| Local | Development with local Postgres/Redis/object-storage emulator | Synthetic only |
| Staging | Integration testing, alpha builds of the extension | Synthetic + team test meetings |
| Production | Real users | Real data |

Each environment has its own vendor keys, buckets, databases, and OAuth clients.

### 17.2 Production layout (proposed)
```
                 ┌──────────── CDN / edge ────────────┐
Users ── HTTPS ──►  Web app static assets (beta+)     │
                 └────────────────────────────────────┘
Extension ─HTTPS─► Load balancer ─► API service (N containers)
Extension ─WSS───► Load balancer (WebSocket, long idle timeout) ─► Realtime gateway (N containers)
                                   Workers (autoscaled on queue depth) · Scheduler (1)
Managed: PostgreSQL (with PITR) · Redis · Object storage · Secrets manager · Logs/metrics/traces
```
- **Region:** decision D-08. Considerations: latency to Indian users and to STT vendors, data
  location expectations (DPDP), and vendor regions. An India region is attractive for latency and
  trust; confirm vendor availability.
- **Hosting style:** the realtime gateway needs long-lived WebSocket connections, so it must run on
  container or VM infrastructure — **not on short-lived serverless functions**. API and web app can
  be serverless or containers.
- Candidate platforms to evaluate in the ADR: a managed Postgres platform with RLS, auth, and storage
  (e.g. Supabase) plus a container host for gateway/workers; or a single cloud provider (e.g. AWS).

### 17.3 Extension distribution
- Alpha: unpacked/private builds for the team.
- Beta: Chrome Web Store **unlisted** or trusted testers.
- Launch: public listing after store review (permission justifications ready).
- Releases are versioned; the API supports at least the current and previous extension versions
  (`clientInfo.version` sent on session start).

### 17.4 CI/CD
Lint, typecheck, unit tests, schema compatibility check (shared contracts), build extension package,
build containers, deploy to staging, smoke test (synthetic audio through the full pipeline), manual
promotion to production.

---

## 18. Scalability and capacity

### 18.1 Phase 1 target
Up to **1,000 users** and **200 concurrent recordings** (PRD §11.4).

### 18.2 Per-session load
| Resource | Per session |
|---|---|
| Client → gateway | ~50–64 kbps (Opus) or ~512 kbps (PCM) |
| STT streams | 2 (one per lane) |
| Object storage writes | ~1 chunk / 10 s / lane |
| DB writes | ~1 segment row per utterance, events |

200 concurrent sessions → **400 concurrent STT streams** — check vendor concurrency limits on our
plan (STT_PREFLIGHT.md action 7).

### 18.3 Bottlenecks and responses
| Bottleneck | Response |
|---|---|
| Vendor concurrency limits | Per-provider limiter; secondary provider; batch-later fallback |
| Meetings ending on the hour (summary spike) | Queue absorbs bursts; workers autoscale; LLM rate limits handled with backoff |
| Gateway memory/CPU (decoding Opus) | Horizontal scaling; measure per-session cost in M1 |
| Postgres write volume | Batch inserts for segments; partition `transcript_segments` by time when large |

---

## 19. Reliability and failure modes

| Failure | Detection | Behaviour |
|---|---|---|
| User's network drops | WSS close | Keep capturing; buffer locally; replay on reconnect (no loss ≤ 10 min, NFR-REL-01) |
| Browser/extension crash | Unsealed session found on restart | Offer recovery; upload buffered audio; process normally |
| Gateway instance dies | Client WSS close | Reconnect to another instance; Redis state + replay |
| STT vendor outage | Errors/timeouts | Health `degraded`; audio still stored; batch transcription later or secondary provider |
| LLM vendor outage | Job failures | Transcript available; summary job retried with backoff; optional secondary LLM |
| Postgres failover | Connection errors | Managed failover; gateway buffers briefly; client buffer covers the gap |
| Meet UI change | Selector health drops | Capture unaffected (not DOM-based); names/mute/chat degrade gracefully; alert |
| Chrome API change | Extension errors in telemetry | Version pinning in tests; Chrome beta channel testing |
| Retention job fails | Scheduler alert | Lifecycle rule backstop deletes old audio |

---

## 20. Observability

- **Correlation:** every log, metric, and trace carries `sessionId` / `meetingId` / `workspaceId`
  (IDs only).
- **Metrics:** active sessions, reconnects/hour, audio frames lost (should be 0), ack lag, STT
  interim/final latency per provider, STT errors, summary latency P50/P95, job failures, queue depth,
  cost per meeting-hour, selector health.
- **Tracing:** session start → stream → STT → segment write; session end → each pipeline job.
- **Session timeline:** an internal view of one session's events (no content) for debugging.
- **Alerts:** audio-loss events, STT error rate, summary P95 > budget, queue backlog, retention job
  failures, spend anomalies per vendor.

---

## 21. Performance budgets

### 21.1 Live transcript (target ≤ 1.5 s interim P90, ≤ 3 s final P90)
| Stage | Budget |
|---|---|
| Frame accumulation (100 ms frames) | ~100 ms |
| Client → gateway network | 50–150 ms |
| Gateway processing (decode, forward) | ≤ 20 ms |
| STT interim | ~100–700 ms (provider-dependent; benchmark) |
| Final + transliteration + DB write | ≤ 100 ms after provider final |
| Gateway → client → render | 50–150 ms |

### 21.2 Summary (target ≤ 60 s P95 for a 60-minute meeting)
| Stage | Budget |
|---|---|
| Finalize transcript (drain finals) | ≤ 5 s |
| Prompt build | ≤ 1 s |
| LLM generation | ≤ 40 s |
| Validation + store + index | ≤ 3 s |
| Notify | ≤ 1 s |

### 21.3 Extension
CPU ≤ 10% of one core, memory ≤ 300 MB while recording (to be measured in M1), no impact on Meet
call quality.

---

## 22. Cost architecture

- **Usage records** per meeting: STT seconds per lane and provider, batch seconds, LLM input/output
  tokens and model, embedding tokens (Phase 2), storage bytes, estimated cost.
- **Cost levers** designed into the architecture:
  - Silence gating on the `me` lane (§6.4)
  - Opus transport (bandwidth) and storage
  - Batch pass only when retention is on and the meeting is long enough to benefit
  - Cheaper models for short meetings or drafts; caching of template prompts
  - Provider routing by language (later, only if the benefit is large)
- Indicative unit costs from research (STT_PREFLIGHT.md): streaming STT roughly $0.3–0.6 per audio
  hour per lane depending on provider; summary LLM call a few cents. Target ≤ USD 1 per
  meeting-hour all-in (PRD §20).

---

## 23. Repository structure

Proposed monorepo (extends the layout in AGENTS.md §5):
```
extension/
  src/
    background/        service worker: state machine, auth, tabCapture, routing
    offscreen/         capture, audio worklets, encoder, buffer, websocket client
    adapters/meet/     selectors, detector, metadata, speaker, mute, chat notice, health
    ui/sidepanel/      live transcript, notes, summary
    ui/pages/          onboarding, settings, library (alpha)
backend/
  apps/
    api/               REST API
    gateway/           realtime WebSocket gateway
    workers/           pipeline jobs, scheduler
  packages/
    core/              domain logic: sessions, segments, speakers, summaries, retention
    providers/         stt/, llm/, transliteration/, embeddings/ (vendor adapters only here)
    db/                schema, migrations, data-access layer with tenancy enforcement
    observability/     logging (field allow-list), metrics, tracing
shared/
  schemas/             event schema, WS protocol, REST DTOs, summary JSON schema (single source)
  types/               generated/derived types for extension and backend
infra/                 infrastructure as code, environment configs (later)
docs/                  PRD, features, architecture, research, ADRs
```
Dependency rules: `adapters/*` may depend on `shared/` only; `core` must not import `providers`
implementations (only interfaces); only `providers/` imports vendor SDKs.

---

## 24. Evolution: Phase 2 and Phase 3

### 24.1 Phase 2 additions
```
                ┌────────────── New adapters (same event contract) ─────────────┐
                │ Desktop app (macOS/Windows)  ·  File upload/import            │
                └──────────────────────────────┬────────────────────────────────┘
                                               ▼
   Existing core ── + Calendar service (Google/Microsoft sync, push channels, schedules)
                 ── + Retrieval service (hybrid search, embeddings worker, pgvector)
                 ── + Chat service (cross-meeting RAG, live Q&A, briefs)
                 ── + MCP server (remote, OAuth, read-only tools)
                 ── + Integrations service (Slack, Notion, Docs, email drafts)
                 ── + Web app (library, sharing)
                 ── + Billing service (plans, metering, payments)
```
- **Desktop app** reuses the WS protocol and event schema; only capture differs (Core Audio
  process taps / WASAPI process loopback). ADR decides native vs cross-platform shell.
- **File upload** enters the pipeline at the batch step (no realtime gateway).
- **Retrieval** is built once and serves chat, briefs, live Q&A, and MCP.

### 24.2 Phase 3 additions
- **Bot adapter** via a meeting-bot API vendor (buy first): vendor webhooks deliver media and events
  that are translated into our normalized events.
- **Video pipeline:** fragmented uploads → transcoding to adaptive streaming → signed playback;
  clips service cutting media by segment timestamps.
- **Automation engine:** triggers (meeting processed) + conditions + actions with run logs and replay.
- **Enterprise:** roles, SSO/SCIM via an identity service, org policies evaluated in the policy
  module, audit log store, optional India-region data residency deployment.
- **Analytics:** derived metrics computed by workers from segments (talk share by speaking time,
  monologues, questions), topic trackers on normalized text.

### 24.3 What must not change
Event schema, segment model, summary schema, provider interfaces, and tenancy model are the stable
contracts. Changing them requires an ADR and a migration plan.

---

## 25. Technology choices

| Area | Choice | Status | Rationale |
|---|---|---|---|
| Language | TypeScript everywhere | **Proposed** | One language for extension, backend, and shared schemas |
| Extension platform | Chrome MV3 | Decided | Required by Chrome |
| Schema validation | Runtime schema library shared by client and server (e.g. zod) | Proposed | Single source of truth for contracts |
| HTTP/WS server | Lightweight Node.js framework with first-class WebSocket support | Proposed | Gateway needs efficient long-lived connections |
| Database | PostgreSQL (+ pgvector in Phase 2) | Proposed | Relational data, RLS, full-text search, queue, vectors in one system |
| Job queue | Postgres-backed queue | Proposed | Fewer moving parts in Phase 1; revisit at scale |
| Cache / pub-sub | Redis | Proposed | Gateway session state and fan-out |
| Object storage | S3-compatible, SSE | Proposed | Standard, cheap, lifecycle rules |
| STT | Decided by benchmark (D-03) | Open | Sarvam, Deepgram, Gemini candidates |
| LLM | Decided by evaluation (D-04) | Open | Gemini Flash candidate; provider-swappable |
| Hosting | Google Cloud, Mumbai (`asia-south1`): Cloud Run, Cloud SQL, Cloud Storage | **Selected** ([ADR-0002](adr/0002-backend-stack-and-hosting.md)) | India region; same cloud as Gemini billing; low ops |
| Observability | OpenTelemetry-compatible stack | Proposed | Vendor-neutral |

---

## 26. ADR backlog and open questions

### 26.1 ADRs to write (in `docs/adr/`)
| ADR | Topic | Needed by |
|---|---|---|
| 0001 | STT provider(s) for streaming and batch | M0 |
| [0002](adr/0002-backend-stack-and-hosting.md) | Backend stack and hosting/region — **Option B selected:** TypeScript/Node on Google Cloud Mumbai (Cloud Run, Cloud SQL, Cloud Storage) | M1 |
| 0003 | Audio transport format: Opus vs PCM (D-06) | M1 |
| 0004 | Auth and token model for the extension | M1 |
| 0005 | Job queue and outbox implementation | M1 |
| 0006 | Library surface: extension page vs web app (D-07) | M2 |
| 0007 | LLM provider and prompt/version management | M2 |
| 0008 | Desktop app approach (native vs cross-platform; build vs SDK) | Phase 2 |
| 0009 | Retrieval design (chunking, embeddings, hybrid ranking) | Phase 2 |
| 0010 | Meeting bot: buy vs build | Phase 3 |

### 26.2 Open technical questions (answer in the M1 capture spike)
1. Which UI entry points satisfy the user-gesture requirement for `tabCapture` (toolbar click,
   in-page chip, side panel button)?
2. Does Chrome's echo cancellation on the mic stream suppress Meet audio played back through our
   AudioContext well enough on laptop speakers?
3. Real CPU and memory cost of two AudioWorklets + Opus encoding on a mid-range laptop.
4. Reliability of Meet's active-speaker and mute signals from the DOM.
5. Can STT backlog after a reconnect be sent faster than real time for each provider?
6. Gateway resource cost per session (decode + two provider streams).
7. Can the side panel be opened from a click on our Meet prompt (content script), or only from the
   toolbar icon? (`sidePanel.open()` requires a user gesture — DESIGN §2, §19 item 10.)
8. Does `backdrop-filter` glass on the Meet overlay cost noticeable CPU/GPU during a call? If yes,
   use the solid fallback inside Meet (DESIGN §5.6).
