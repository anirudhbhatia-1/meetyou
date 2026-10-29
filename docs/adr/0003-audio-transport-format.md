# ADR-0003: Audio transport format (Opus vs PCM)

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-10-29) — verification items below run in Stage 1; a failed check reopens this ADR |
| Date | 2026-10-29 |
| Decision | D-06 (PRD §22) |
| Related | [ARCHITECTURE §5.6](../ARCHITECTURE.md) · [STT_BENCHMARK_PLAN Phase D](../STT_BENCHMARK_PLAN.md) · [ADR-0001](0001-stt-provider.md) |

## 1. Context

The capture client streams two lanes to the gateway. Raw 16 kHz PCM16 costs ~256 kbps per lane
(~512 kbps for both); Opus at 24–32 kbps costs ~10× less, which matters on weak Indian home and
mobile-hotspot connections and for stored audio. The question is whether Opus compression hurts
transcription accuracy.

## 2. Evidence (Phase D, 2026-10-29)

Same 8 clips (MUCS 2021 Hindi-English code-switching test set, ~4 min each), Deepgram Nova-3
`language=multi` with `hi,en` hints, batch mode. The Opus input was encoded at 24 kbps (`-application
voip`) and decoded back to 16 kHz PCM before sending, so only the compression differs.

| Input | WER | WER (spelling-insensitive) | CER | Code-switch WER |
|---|---|---|---|---|
| PCM16 16 kHz | 17.8% | 11.0% | 8.2% | 16.8% |
| Opus 24 kbps → PCM | 18.0% | 11.5% | 8.5% | 17.1% |

Difference: **≤ 0.5 percentage points** on every metric — within the variation expected between
runs of the same audio.

Limitations: one provider; clean lecture audio (not Meet-compressed meeting audio); 8 clips.

## 3. Decision (proposed)

- **Transport:** Opus, 24 kbps mono, 20 ms Opus frames packed into the 100 ms protocol frames
  (ARCHITECTURE §5.2), decoded to PCM16 in the gateway before forwarding to STT providers.
- **Storage:** the same Opus stream is stored (≈ 11 MB per lane-hour).
- **Fallback:** PCM16 if a client cannot encode Opus (the `hello.format` negotiation already
  supports both codecs).

## 4. Consequences

- Client CPU: an Opus encoder in the offscreen document (WebCodecs `AudioEncoder` or a WASM
  encoder) — measure in S1-11. [Verify] WebCodecs Opus support in the Chrome versions we target.
- Gateway: Opus decoder per lane; measure per-session CPU in S1-11.
- Re-test with the ADR-0001 provider(s) on real meeting audio before acceptance.

## 5. Verification before acceptance

| # | Check | Owner |
|---|---|---|
| 1 | Repeat Phase D with the chosen streaming provider (and Sarvam once its key is available) | Anirudh |
| 2 | Encoder CPU and battery impact in the extension (S1-11) | Anirudh |
| 3 | Gateway decode CPU per session (S1-11) | Anirudh |
