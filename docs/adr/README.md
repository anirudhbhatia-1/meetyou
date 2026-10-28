# Architecture Decision Records

Each ADR records one significant decision: context, options, the decision, and its consequences.
Agents and developers must follow accepted ADRs; changing one requires a new ADR that supersedes it.

| ADR | Title | Status |
|---|---|---|
| 0001 | STT provider(s) for streaming and batch | Pending benchmark ([plan](../STT_BENCHMARK_PLAN.md)) |
| [0002](0002-backend-stack-and-hosting.md) | Backend stack and hosting | Option B selected (Google Cloud Mumbai); Accepted after §9 checks |
| 0003 | Audio transport format (Opus vs PCM) | Not started |
| 0004 | Auth and token model for the extension | Not started |
| 0005 | Job queue and outbox implementation | Not started |
| 0006 | Library surface: extension page vs web app | Not started |
| 0007 | LLM provider and prompt/version management | Not started |
| 0008 | Desktop app approach | Not started (Phase 2) |
| 0009 | Retrieval design | Not started (Phase 2) |
| 0010 | Meeting bot: buy vs build | Not started (Phase 3) |

**Statuses:** Not started → Proposed → Accepted → (Superseded by NNNN / Rejected)

**File name:** `NNNN-short-title.md`. Sections: Context · Decision drivers · Options · Decision ·
Consequences · Verification · Sources.
