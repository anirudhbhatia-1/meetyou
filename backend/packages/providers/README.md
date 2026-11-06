# @meetyou/providers (S2-03)

The only package that talks to vendors (AGENTS §3 rule 3, ARCHITECTURE §7).

| Piece | What it is |
|---|---|
| `SttStreamingProvider` | Live STT per lane, with `capabilities` (idle timeout, interim, diarization, word times, Hindi script, vocabulary limits, inputs) so callers adapt without naming vendors |
| `SttBatchProvider` | Post-meeting pass: audio bytes (`audio/ogg`, `audio/wav`) or a short-lived URL → speaker turns with words |
| `deepgramProvider`, `deepgramBatchProvider` | Deepgram Nova-3 (ADR-0001 §0): `language=multi`, hints `hi,en`, `mip_opt_out=true` always |
| `LlmProvider` | Structured JSON calls; no adapter until D-04 / ADR-0007 |
| `Transliterator` | Devanagari → Roman (D-01); implemented in S2-05 |
| `createProviders(env)` | Registry from `APP_ENV`, `STT_PROVIDER` (`none` / `deepgram`), `DEEPGRAM_API_KEY` |
| `assertFreeKeyAllowed(env)` | `GEMINI_FREE_TIER_ACCEPTED=true` is refused outside `local` and `ci` (ADR-0001 §7) |

Data-use controls live inside each adapter and cannot be turned off by callers. Vendor error bodies
are never surfaced (they can echo request details); only HTTP status codes are.

[Verify] Deepgram pre-recorded with our Ogg Opus chunks and its price (S2-14).
