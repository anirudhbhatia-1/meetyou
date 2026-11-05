# ADR-0003: Audio transport format (Opus vs PCM)

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-10-29); **amended 2026-11-04** (Anirudh): the gateway wraps Opus in Ogg instead of decoding it (§3.1). Verification items run in Stage 1; a failed check reopens this ADR |
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

### 3.1 Amendment (2026-11-04): Ogg wrap, no decode

Decided by Anirudh during S1-11. Superseding "decoded to PCM16 in the gateway":

- **Client:** WebCodecs `AudioEncoder` (built into Chrome, no WASM or dependency): `opus`, 16 kHz
  mono, 24 kbps, 20 ms packets, `application: voip`. If `isConfigSupported` fails, the client
  streams PCM16. A build flag (`MINUTES_AUDIO_CODEC=pcm16`) forces PCM16 for comparisons.
- **Frame payload:** consecutive 20 ms packets, each prefixed with its length (u16 LE); normally 5
  per 100 ms frame, fewer at a pause or the end (`packOpusFrame` / `unpackOpusFrame` in
  `shared/contracts`).
- **Gateway:** does not decode. It wraps the packets in an Ogg Opus stream (RFC 7845; our own
  ~150-line muxer, byte-identical to ffmpeg's `OpusHead` page in tests) and
  - stores each 10 s chunk as a standalone `.opus` file (ARCHITECTURE §11.4 layout);
  - streams Ogg Opus to the STT provider: Deepgram reads the container header, so `encoding` and
    `sample_rate` are omitted (Google Chirp 3 was dropped 2026-11-05, ADR-0001 §0).
- **Why:** no decoder dependency, less gateway CPU, and the stored files are directly playable and
  usable by batch STT. A future gateway-side VAD (§6.4 silence gating) would need decoding; it
  stays an optional optimization.

## 4. Consequences

- Client CPU: the WebCodecs Opus encoder in the offscreen document — measure in S1-11 (Chrome
  Task Manager, Opus vs `MINUTES_AUDIO_CODEC=pcm16`). [Verify] that `isConfigSupported` passes on
  the Chrome versions we target (`minimum_chrome_version` 116).
- Gateway: no decoder (§3.1). Local load test 2026-11-04 (Apple M4, STT off, 20 sessions × 30 s,
  both lanes): Opus 0.14% of one core per session, 127 MB RSS; PCM16 0.22%, 162 MB. Cloud Run
  sizing is measured on staging.
- Re-test with the ADR-0001 provider(s) on real meeting audio before acceptance.

## 5. Verification before acceptance

| # | Check | Owner |
|---|---|---|
| 1 | Repeat Phase D with the chosen streaming provider (and Sarvam once its key is available) | Anirudh |
| 2 | Encoder CPU and battery impact in the extension (S1-11) | Anirudh |
| 3 | ~~Gateway decode CPU per session~~ — no decode since §3.1; gateway CPU per session measured locally (§4), staging pending | Anirudh |
| 4 | Deepgram accepts the gateway's Ogg Opus stream — **done 2026-11-04**: 60 s MUCS clip streamed as our Ogg, transcripts returned | Anirudh |
| 5 | ~~Google Chirp 3 streaming accepts `OGG_OPUS`~~ — cancelled 2026-11-05, Google dropped (ADR-0001 §0) | Anirudh |
| 6 | WebCodecs Opus encodes in the offscreen document — **done 2026-11-04** (Anirudh's Chrome, M4 Mac): 48.5 s Meet recording, both lanes Opus, 485 frames each, no loss, ~0.1 MB stored, live Deepgram transcripts | Anirudh |
