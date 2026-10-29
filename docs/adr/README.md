# Architecture Decision Records

Each ADR records one significant decision: context, options, the decision, and its consequences.
Agents and developers must follow accepted ADRs; changing one requires a new ADR that supersedes it.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-stt-provider.md) | STT provider(s) for streaming and batch | Pending benchmark — results template ready |
| [0002](0002-backend-stack-and-hosting.md) | Backend stack and hosting | Option B selected (Google Cloud Mumbai); Accepted after §9 checks |
| [0003](0003-audio-transport-format.md) | Audio transport format (Opus vs PCM) | Accepted 2026-10-29 |
| [0004](0004-auth-and-token-model.md) | Auth and token model for the extension | Accepted 2026-10-29 |
| [0005](0005-job-queue-and-outbox.md) | Job queue and outbox implementation | Accepted 2026-10-29 |
| 0006 | Library surface: extension page vs web app | Not started |
| 0007 | LLM provider and prompt/version management | Not started |
| 0008 | Desktop app approach | Not started (Phase 2) |
| 0009 | Retrieval design | Not started (Phase 2) |
| 0010 | Meeting bot: buy vs build | Not started (Phase 3) |

**Statuses:** Not started → Proposed → Accepted → (Superseded by NNNN / Rejected)

**File name:** `NNNN-short-title.md`. Sections: Context · Decision drivers · Options · Decision ·
Consequences · Verification · Sources.
