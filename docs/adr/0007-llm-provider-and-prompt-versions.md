# ADR-0007: LLM provider and prompt/version management

| Field | Value |
|---|---|
| Status | **Proposed** (2026-11-09) — for Anirudh to accept; decides D-04 (PRD §19) |
| Date | 2026-11-09 |
| Related | [ARCHITECTURE §10](../ARCHITECTURE.md) · [PRD §14](../PRD.md) · [ADR-0001 §7](0001-stt-provider.md) (free-key rule) · `tools/summary-eval` |

## 1. Context

Stage 3 needs one model for meeting summaries (S3-01) and "Ask this meeting" (S3-12). D-04 was left
open: build first on **Gemini Flash** (Anirudh, 2026-11-07) and let the evaluation (PRD §14.6,
S3-05) decide. That code now exists:

- **Provider interface** `LlmProvider.generateStructured` in `@meetyou/providers`: system text,
  data input, JSON Schema, token limit; **no tools**. One adapter, `llm/gemini.ts` (Gemini API with
  a key, `x-goog-api-key`, structured output via `responseFormat`, `temperature` never sent on
  3.6+). Registry `LLM_PROVIDER=none|gemini`, model `GEMINI_MODEL` (default `gemini-3.6-flash`).
- **Free key guard:** refused outside `local`/`ci`, except staging behind
  `GEMINI_FREE_TIER_ON_STAGING=true` for test meetings (ADR-0001 §7 amendment); production always
  refuses it.
- **Evaluation harness** `tools/summary-eval`: synthetic golden meetings, PRD §14.6 metrics on the
  production validation chain, recorded outputs gated in CI, live re-recording.

## 2. Decision drivers

1. Hinglish and Hindi (Devanagari) understanding, and output in the user's chosen language.
2. Reliable schema-valid JSON with citations to the segment IDs we supply (AGENTS §3 rule 7).
3. Resistance to instructions inside meeting content (ARCHITECTURE §14.3).
4. Latency inside the ≤ 60 s P95 summary budget (S3-03), and cost per meeting.
5. Data terms: no training on user data — paid tier for anything real (AGENTS §9).
6. Same cloud as the backend preferred (ADR-0002), but not required.

## 3. Options

| Option | Notes | Verdict |
|---|---|---|
| **A. Gemini Flash via the Gemini API (paid tier)** | Built and evaluated (§4); strong multilingual output; structured JSON; key-based like Deepgram | **Proposed** |
| B. Gemini via Vertex AI | Same models, Google Cloud IAM and regional controls; a second adapter (service-account auth, different endpoint) | Later, if enterprise data terms or region pinning require it |
| C. Claude / other vendors | Not built; the interface allows an adapter | Compare on the same golden set before any switch |

## 4. Evidence (2026-11-09, `tools/summary-eval/baseline.json`)

`gemini-3.6-flash`, prompt `summary-v1`, templates v1, 10 synthetic meetings (English, Devanagari
Hindi, Hinglish; all five templates; with and without notes; echo; three injection cases):

| Metric | Value |
|---|---|
| Action-item precision / recall | 0.95 / 0.95 |
| Owner accuracy | 1.00 |
| Decision precision | 0.90 |
| Citation support (lexical proxy) | 1.00 |
| Unverified items per summary | 0.3 |
| Injection failures | 0 |

About 8–14 s per summary on these short meetings with the free key. A templates v2 run on 7 of the
10 meetings scored at least as well; the other 3 hit the free-tier rate limit (v2 is parked, not
merged). **Not yet measured:** long (60-minute) meetings and the 60 s P95 on staging (S3-03),
cost per meeting on the paid tier, and a golden set of 30+ meetings (PRD §14.6).

## 5. Decision (proposed)

**Option A** for Phase 1: Gemini Flash (`gemini-3.6-flash`) through the Gemini API, **paid tier**
for any real meeting; the free key stays for synthetic data and CI only (plus the temporary staging
switch).

### 5.1 Prompt and version management
- Prompts and templates live in code as data (`@meetyou/summarizer`): `PROMPT_VERSION`
  (`summary-v1`), `ASK_PROMPT_VERSION` (`ask-v2`), and a `version` per template. Every stored
  summary records model, prompt and template versions.
- **Any prompt, template or model change** bumps its version and must be re-recorded with
  `eval:live`; the CI gate fails while recordings are stale, and passes only within tolerance of
  `baseline.json` (0.05 per metric, zero injection failures). A new baseline is committed only after
  review.
- Switching vendor = a new adapter behind `LlmProvider` + a full evaluation run; no other code
  changes.

## 6. Consequences

- Summaries and answers leave Google Cloud Mumbai for the Gemini API (sub-processor list, privacy
  notice).
- A paid Gemini key in Secret Manager is required before real meetings on staging or production.
- The evaluation set must grow to 30+ meetings (and include real meetings recorded with consent)
  before this ADR is re-checked for general availability.

## 7. Verification (to accept)

1. Anirudh accepts the evidence in §4 (or asks for more).
2. Staging: a 60-minute test meeting's notes within 60 s (S3-03 done-when).
3. Paid key in Secret Manager; cost per meeting recorded from `usage_records`.
