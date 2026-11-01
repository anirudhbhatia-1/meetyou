# Sub-processors — DRAFT (S0-18)

> Public list linked from Settings → Privacy & data (PRD FR-SET-06). Draft for legal review (S6-05).
> STT follows ADR-0001 (accepted 2026-11-01 with a gate): Google Chirp 3 is primary once it passes the
> ADR-0001 §6.2 gate, otherwise Deepgram is primary; publish only the provider(s) actually in use.
> Sarvam was dropped and is not listed. The LLM row stays a placeholder until ADR-0007 is accepted.
> Data-use terms are from STT_PREFLIGHT.md (2026-10-28) and ADR-0001 §3 and must be re-checked
> before publishing.

| Provider | Purpose | Data | Location | Training on our data |
|---|---|---|---|---|
| Google Cloud (Cloud Run, Cloud SQL, Cloud Storage) | Hosting, database, storage | All product data, including meeting audio and video | India (Mumbai, `asia-south1`) | No |
| Google Cloud Speech-to-Text V2 (Chirp 3) — **primary** speech-to-text | Transcription | Meeting audio only (never video) | `us` or `eu` multi-region — **outside India**; audio and transcripts are stored back in Mumbai | No — data logging kept off for our Cloud project |
| Deepgram (Nova-3) — **fallback** speech-to-text | Transcription, if Chirp 3 fails the ADR-0001 gate, or during a Google outage | Meeting audio only (never video) | United States | No — `mip_opt_out=true` on every request |
| [LLM provider, per ADR-0007] | Summaries, action items | Transcript text, notes (never audio or video) | [per provider] | No — paid tier / no-training terms only |
| [Error reporting / analytics, if used] | Reliability | Diagnostics without meeting content | [region] | No |

Changes: we update this page before a new sub-processor starts receiving data.

Meeting video is stored only in our Google Cloud storage in Mumbai and is not shared with any other
sub-processor.
