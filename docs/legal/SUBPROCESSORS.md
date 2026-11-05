# Sub-processors — DRAFT (S0-18)

> Public list linked from Settings → Privacy & data (PRD FR-SET-06). Draft for legal review (S6-05).
> STT follows ADR-0001 (amended 2026-11-05): Deepgram Nova-3 is the only speech-to-text provider.
> Google Chirp 3 and Sarvam were dropped and are not listed. The LLM row stays a placeholder until ADR-0007 is accepted.
> Data-use terms are from STT_PREFLIGHT.md (2026-10-28) and ADR-0001 §3 and must be re-checked
> before publishing.

| Provider | Purpose | Data | Location | Training on our data |
|---|---|---|---|---|
| Google Cloud (Cloud Run, Cloud SQL, Cloud Storage) | Hosting, database, storage | All product data, including meeting audio and video | India (Mumbai, `asia-south1`) | No |
| Deepgram (Nova-3) — speech-to-text | Transcription, live and after the meeting | Meeting audio only (never video) | United States — **outside India**; audio and transcripts are stored back in Mumbai | No — `mip_opt_out=true` on every request |
| [LLM provider, per ADR-0007] | Summaries, action items | Transcript text, notes (never audio or video) | [per provider] | No — paid tier / no-training terms only |
| [Error reporting / analytics, if used] | Reliability | Diagnostics without meeting content | [region] | No |

Changes: we update this page before a new sub-processor starts receiving data.

Meeting video is stored only in our Google Cloud storage in Mumbai and is not shared with any other
sub-processor.
