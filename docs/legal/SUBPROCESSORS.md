# Sub-processors — DRAFT (S0-18)

> Public list linked from Settings → Privacy & data (PRD FR-SET-06). Draft until ADR-0001 (STT) and
> ADR-0007 (LLM) are accepted; then remove the providers that were not chosen. Data-use terms are
> from STT_PREFLIGHT.md (2026-10-28) and must be re-checked before publishing.

| Provider | Purpose | Data | Location | Training on our data |
|---|---|---|---|---|
| Google Cloud (Cloud Run, Cloud SQL, Cloud Storage) | Hosting, database, storage | All product data | India (Mumbai, `asia-south1`) | No |
| [Speech-to-text provider — Sarvam AI / Deepgram / Google Gemini, per ADR-0001] | Transcription | Meeting audio | [per provider] | No — Sarvam: account opt-out [+ business terms]; Deepgram: `mip_opt_out` on every request; Gemini: paid tier only |
| [LLM provider, per ADR-0007] | Summaries, action items | Transcript text, notes | [per provider] | No — paid tier / no-training terms only |
| [Error reporting / analytics, if used] | Reliability | Diagnostics without meeting content | [region] | No |

Changes: we update this page before a new sub-processor starts receiving data.
