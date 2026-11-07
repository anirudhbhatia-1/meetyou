# ADR-0001: Speech-to-text provider(s)

| Field | Value |
|---|---|
| Status | **Accepted, amended 2026-11-05** (Anirudh) — **Deepgram Nova-3 is the only STT provider**; Google Chirp 3 is dropped and the §6.2 gate is cancelled (§0). First accepted 2026-11-01 with a gate |
| Decision | D-03 (PRD §22) |
| Inputs | [STT_BENCHMARK_PLAN.md](../STT_BENCHMARK_PLAN.md) · [STT_PREFLIGHT.md](../STT_PREFLIGHT.md) · `bench-data/mucs/results/scores*.csv` (gitignored) |
| Owner | Anirudh |

---

## 0. Amendment 2026-11-05 — Deepgram only

**Decision (Anirudh, 2026-11-05):** we will not use Google Cloud Speech-to-Text (Chirp 3).
**Deepgram Nova-3** is the STT provider for live streaming and for the post-meeting pass.

**Facts behind it**
- Deepgram was the best measured provider on our benchmark (§4.1: 14.2% spelling-insensitive WER,
  final P90 2.8 s). Chirp 3 was never benchmarked.
- Deepgram is already integrated and verified end to end in the S1-05 gateway: Ogg Opus input
  (ADR-0003 check 4), `them`-lane diarization, `mip_opt_out=true`.
- It gives streaming diarization and word timestamps; Chirp 3 has both only in batch.

**What changes**
- §6.1: Deepgram for both roles; no backup provider for now.
- §6.2 gate and S1-14 are cancelled. The Google consequences in §7 (stream rotation, quota,
  `OGG_OPUS` check, `us`/`eu` region, $0.016/min) no longer apply.
- The provider interface stays (ARCHITECTURE §7). A new provider later means a new adapter and an
  ADR update, not a pipeline change.
- The Google provider in `tools/stt-benchmark` stays as benchmark code only; the product does not use it.

**Consequences of Deepgram only**
- **Region:** audio is transcribed in the United States, so it leaves India. Storage stays in
  `asia-south1`. SUBPROCESSORS and the privacy policy say so.
- **Cost:** about $0.0092 per audio-minute for Nova-3 multilingual streaming [Verify on Deepgram's
  pricing page; third-party source] → about **$1.10 per meeting-hour** with both lanes; `me`-lane
  mute gating (FR-CAP-11) lowers it.
- **Keep-alive:** send `KeepAlive` during silence (AGENTS §10).
- **Script (D-01):** check on dogfooding which script `multi` returns for Hindi words; the assembler
  still transliterates Devanagari to Roman and keeps `rawText`.
- **Open:** what the product does during a Deepgram outage, with no second provider. Audio is still
  stored durably by the gateway. Decide before beta.

## 1. Context

We need one or more STT providers for (a) live streaming transcription of both lanes and (b) an
optional post-meeting batch pass, with strong Hindi–English code-switching and Roman display
(D-01).

**What changed during Stage 0**

- No consented meeting recordings were available, so the benchmark used the public **MUCS 2021
  Hindi-English code-switching test set** (OpenSLR 104, CC BY-SA 4.0).
  - 20 clips of about 4 minutes each, single speaker, lecture audio.
  - References come from the dataset: Devanagari for Hindi words, Latin script for most English words.
- **2026-11-01, product direction (Anirudh):**
  - Use **Google's speech library** for transcription.
  - **Drop Sarvam.**
  - Record **video (the meeting screen)** too — see [ADR-0011](0011-video-screen-recording.md).

## 2. Options

| Option | Streaming | Batch | Status |
|---|---|---|---|
| **Google Cloud Speech-to-Text V2, Chirp 3** (`@google-cloud/speech`) | ✓ `StreamingRecognize`, 5-min streams | ✓ `BatchRecognize` with diarization, ≤ 8 h | **Dropped 2026-11-05** (§0) — never benchmarked |
| Deepgram Nova-3 (`multi`, hints `hi,en`) | ✓ | ✓ | Measured — **chosen, only provider (2026-11-05)** |
| Gemini 3.5 Transcribe (Live / Interactions) | ✓ (10-min sessions) | ✓ | Measured — rejected for STT |
| Sarvam Saaras v3 (`translit`) | ✓ | ✓ | Measured — **dropped 2026-11-01** |

## 3. Gates (STT_BENCHMARK_PLAN §8.1)

| Gate | Google Chirp 3 | Deepgram | Gemini |
|---|---|---|---|
| Data terms acceptable on the plan we would buy | ✓ No training unless the project opts into data logging (keep it off) | ✓ `mip_opt_out=true` on every request | ✓ Paid tier only; ✗ free tier (training and human review) |
| Streaming Hindi–English code-switching | [Verify] in the §6.2 gate | ✓ measured | ✓ measured (English loanwords come back in Devanagari) |
| ≥ 60-min sessions or reliable resumption | Rotation every < 5 min (quota) | ✓ long sessions + keep-alive | Rotation every < 10 min |
| Word or segment timestamps | Utterance end offsets when streaming; word timestamps only in batch (optional, may lower accuracy) | ✓ words | Batch only |
| Diarization | Batch only | ✓ streaming and batch | Batch ≤ 30 min |
| Region | `us` / `eu` multi-region only for Chirp 3 (no `asia-south1` listed) | US | Global |

## 4. Results (MUCS 2021, 20 clips, `them` lane, 2026-10-29)

WER (spelling-insensitive) counts a substitution as correct when both spellings share a phonetic
key. This matters here: the references write English loanwords in Devanagari, so providers that
output Latin English are unfairly penalised by plain WER. This is the fairest single number on
this dataset.

### 4.1 Streaming (Phase B, real-time 100 ms chunks)

| Run | WER | WER (spelling-insensitive) | CER | WER hi | WER en | Code-switch WER | Interim P50 | Final P50 | Final P90 |
|---|---|---|---|---|---|---|---|---|---|
| deepgram-nova3-multi-stream | 22.6% | **14.2%** | 11.2% | 21.1% | 23.3% | 23.5% | 691 ms | **616 ms** | **2.8 s** |
| gemini-live-stream | 32.6% | 15.9% | 18.3% | 14.6% | 78.9% | 41.1% | 333 ms | 4.8 s | 20.2 s |
| sarvam-v3rt-translit-stream (19 clips) | 35.3% | 15.8% | 16.2% | 39.9% | 21.0% | 34.7% | 190 ms | 3.2 s | 9.8 s |

### 4.2 Batch (Phase A)

| Run | WER | WER (spelling-insensitive) | CER | WER hi | WER en | Code-switch WER |
|---|---|---|---|---|---|---|
| deepgram-nova3-multi-batch | 20.0% | 11.5% | 9.4% | 19.4% | 17.7% | 20.6% |
| deepgram-nova3-hi-batch | 21.2% | 12.4% | 9.6% | 19.8% | 21.4% | 23.6% |
| gemini-transcribe-batch | 30.5% | 11.9% | 14.9% | 10.0% | 86.0% | 39.9% |
| sarvam-v3-translit-batch | 31.3% | **10.4%** | 11.0% | 36.2% | 15.2% | 30.2% |

### 4.3 Long sessions (Phase C)

Not run as a separate phase. Every streaming clip ran about 4 minutes in real time. Gemini 10-min
rotation was exercised in unit tests only. The 60-minute live test moves to S1-11 with the chosen
provider.

### 4.4 Input format (Phase D) — see [ADR-0003](0003-audio-transport-format.md)

Opus 24 kbps vs PCM16 on Deepgram batch: ≤ 0.5 points difference on every metric → Opus accepted.

### 4.5–4.7 Boosting, downstream summaries, readability (Phases E–G)

**Not run.** The public dataset has no entity labels, no multi-person meetings, and no action items.
These phases move to S1 dogfooding with consented recordings (kit in `docs/benchmark/`).

## 5. Weighted score (STT_BENCHMARK_PLAN §8.2) — partial

Only the accuracy and latency criteria could be scored. The others need data we do not have
(entities, summaries, multi-speaker audio) or are vendor terms.

| Criterion | Weight | Deepgram | Gemini | Sarvam |
|---|---|---|---|---|
| Hinglish WER incl. code-switch | 30% | **Best** (stream 14.2%, code-switch 23.5%) | Close on spelling-insensitive WER; poor in English (79%) | Best batch number; weak in Hindi script terms |
| Streaming latency and stability | 10% | **Best** (final P90 2.8 s) | Final P90 20 s — not usable live | Final P90 9.8 s; one DNS failure mid-run |
| Others (entities, summaries, cost, diarization, operations) | 60% | Not measured | Not measured | Not measured |

## 6. Decision

### 6.1 Providers

| Role | Provider and configuration | Condition |
|---|---|---|
| **Live (both lanes)** | Deepgram Nova-3 streaming, `language=multi`, `language_hint=hi,en`, interim results, `mip_opt_out=true`, diarization on the `them` lane | Since 2026-11-05 (§0) |
| **Post-meeting pass** | Deepgram Nova-3 pre-recorded, from the stored Opus lanes, with diarization | Since 2026-11-05; settings in S2-03 |
| Backup | None for now (§0, open item) | — |
| Not used | Google Chirp 3 (dropped 2026-11-05); Gemini for STT; Sarvam (dropped) | — |

The gateway talks to providers only through the provider-adapter interface (ARCHITECTURE §6), so
adding another provider later is a new adapter, not a rewrite.

### 6.2 Gate before S2-03 (provider layer) — cancelled 2026-11-05

Kept for the record; not run (§0).

Run `bench run-stream --config tools/stt-benchmark/examples/runs.google.json` on the same 20 MUCS
clips (≈ 160 audio-minutes ≈ $3).

**Setup:**
- A billing-enabled Cloud project (the ADR-0002 project).
- Speech-to-Text API enabled.
- Data logging **off**.
- `GOOGLE_CLOUD_PROJECT` set, plus `gcloud auth application-default login`.

| Metric | Must reach | Reference (Deepgram stream) |
|---|---|---|
| WER (spelling-insensitive) | ≤ 16% | 14.2% |
| Code-switch WER | ≤ 28% | 23.5% |
| WER en (English words) | ≤ 30% | 23.3% |
| Final P90 latency | ≤ 3.5 s | 2.8 s |
| Rotation every 5 min | No lost or duplicated words at the seams beyond 1% | — |

If Chirp 3 misses a target, Deepgram becomes primary and this ADR is updated. No further approval
is needed.

## 7. Consequences

> Since 2026-11-05 (§0) the Google-specific parts below (gateway rotation, quota, timestamps,
> region, cost) no longer apply; §0 lists the Deepgram consequences. The Gemini free-key rule still applies.

### Gateway (S2-03/S2-04)
- Rotate Google streams before 5 minutes, using the harness pattern (open the next stream, replay
  the last 2 s, de-duplicate overlapping finals). That is about 12 rotations per lane-hour.
- **Quota:** 300 concurrent streams per region means about 150 live meetings (two lanes each). Ask
  Google for an increase before beta.
- Audio is decoded from Opus to 16 kHz PCM16 before sending (ADR-0003). Each request must stay under 25 KB.

### Timestamps
Live segments get utterance-level end offsets, not word times.
- Click-to-seek works at segment level.
- Word-level timing comes from the post-meeting batch pass.

### Speakers
- Live naming: lanes plus Meet active-speaker events (unchanged).
- Labels inside the `them` lane: batch diarization after the meeting.

### Script (D-01)
`hi-IN` output is expected in Devanagari, including English loanwords (as with Gemini). The S2-05
assembler already transliterates Devanagari to Roman and applies the canonical spelling list. Check
the English-loanword quality (`मीटिंग` → `meeting`, not `miting`) in the gate, and add common
loanwords to the canonical list.

### Region and privacy
- Chirp 3 runs in the `us` or `eu` multi-region, so audio leaves India for transcription. Storage
  stays in `asia-south1`.
- Add this to SUBPROCESSORS and the privacy policy.
- At S2-03, check the locations API for `asia-south1` / `asia-southeast1` support.

### Cost
- Standard V2 recognition is about **$0.016 per audio-minute** [Verify on the pricing page]. Two
  lanes cost about **$1.92 per meeting-hour** live.
- Dynamic batch is about $0.003–0.004/min.
- To bring the live cost down:
  - Do not stream `me`-lane silence while muted (FR-CAP-11).
  - Reuse the stored Opus for the batch pass.
- Update PRD §20.

### Gemini free key — development and testing only (Anirudh, 2026-11-01)
Google's terms for unpaid services say: "Do not submit sensitive, confidential, or personal
information to the Unpaid Services". Google may also train on that content, and human reviewers
may read it. So the free key is used **only** in these places:

| Allowed | Never |
|---|---|
| Local development and CI with synthetic (TTS) audio and synthetic transcripts (S2-13 fixtures) | Any real meeting — the developers' own meetings included |
| Summary-prompt development and the S3-05 evaluation on synthetic or public data | Staging or production environments |
| Benchmarks on public licensed datasets (MUCS) | Data from beta users or dogfooding |

The provider layer enforces this: `GEMINI_FREE_TIER_ACCEPTED` is honoured only when
`APP_ENV` is `local` or `ci`. Staging and production refuse to start with a free key
(ARCHITECTURE §15.2). D-04 (the summary LLM for real meetings) still needs a paid tier.

**Amendment — temporary staging exception (Anirudh, 2026-11-07).** Until Anirudh moves the key to
the paid tier, staging may use the free key for summaries when `GEMINI_FREE_TIER_ON_STAGING=true`
is set on the service. Anirudh accepted that this conflicts with Google's terms quoted above and
that staging transcripts may be used for training and read by reviewers. Conditions: only test
meetings where every participant knows and agrees; testers are told (tester guide); production
always refuses the free key; remove the setting when the paid key is in place.

## 8. Run log

| Date | Phase | Runs | Clips | Who | Notes |
|---|---|---|---|---|---|
| 2026-10-28 | Smoke | Deepgram, Gemini | 1 synthetic (TTS) | Anirudh | Pipeline check |
| 2026-10-29 | A (batch) | Deepgram multi/hi, Gemini, Sarvam translit | 20 MUCS | Anirudh | Gemini key turned out to be free tier: stopped, then continued with `GEMINI_FREE_TIER_ACCEPTED` (public data only). Two clips had already gone to the free tier |
| 2026-10-29 | B (stream) | Deepgram, Gemini Live, Sarvam translit | 20 / 20 / 19 | Anirudh | Sarvam run stopped on `ENOTFOUND api.sarvam.ai` (mx-018/019 partial, mx-020 missing); not re-run because Sarvam was dropped |
| 2026-10-29 | D (Opus) | Deepgram multi batch, PCM vs Opus 24k | 8 | Anirudh | ≤ 0.5 pt difference |
| 2026-11-01 | — | — | — | Anirudh | Decision: Google primary (gated), Sarvam dropped. Google provider added to `tools/stt-benchmark` (`provider: "google"`, streaming) |
| 2026-11-05 | — | — | — | Anirudh | Decision: Deepgram only; Google Chirp 3 dropped, §6.2 gate and S1-14 cancelled |

## 9. Follow-ups

- Deepgram pre-recorded settings for the post-meeting pass (S2-03).
- Phases E–G with consented meeting recordings during S1 dogfooding.
- Re-run the benchmark when Deepgram ships a new model.

## Sources

- [Chirp 3 model](https://docs.cloud.google.com/speech-to-text/v2/docs/chirp_3-model) — streaming, `hi-IN` GA, `us`/`eu` regions, diarization in batch only, adaptation up to 1,000 phrases
- [Speech-to-Text V2 quotas](https://docs.cloud.google.com/speech-to-text/v2/quotas) — streams ≤ 5 min, 300 concurrent per region, batch files ≤ 8 h
- [Speech-to-Text pricing](https://cloud.google.com/speech-to-text/pricing) · [V2 launch blog (dynamic batch)](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-speech-to-text-v2-api)
- [MUCS 2021, OpenSLR 104](https://www.openslr.org/104/) (CC BY-SA 4.0)
