# @meetyou/stt-benchmark

Tooling for the speech-to-text benchmark ([docs/STT_BENCHMARK_PLAN.md](../../docs/STT_BENCHMARK_PLAN.md)):
batch runner (S0-06), streaming replay harness (S0-07), normalizer and scorer (S0-08), blind
display samples (S0-10), and a vendor latency probe (ADR-0002 check 4).

> **Status:** unit-tested against documented request/response formats. **Not yet run against the
> live vendor APIs** — the first real run is part of Phase A. Places where the docs were incomplete
> are marked `[Verify]` in the code.

## Data lives outside git

Audio, references, and results contain real voices and names. Keep them in a separate encrypted
folder and point the tool at it:

```
$BENCH_DATA_DIR/
  manifest.json            clip list (see examples/manifest.example.json)
  audio/<clip>.<lane>.wav  16 kHz mono PCM16 (see "Preparing audio")
  refs/<clip>.<lane>.json  reference transcripts (docs/benchmark/ANNOTATION_GUIDELINE.md)
  results/                 written by the tool: raw/, stream/, scores.csv, ratings/
```

## Keys and data-use guards

Set these in your shell (never in a file in the repo):

| Variable | Purpose |
|---|---|
| `SARVAM_API_KEY` | Sarvam key |
| `SARVAM_TRAINING_OPT_OUT_CONFIRMED=true` | Required: you turned off training in Sarvam's account settings (STT_PREFLIGHT §2.4) |
| `DEEPGRAM_API_KEY` | Deepgram key (`mip_opt_out=true` is always sent) |
| `GEMINI_API_KEY` | Gemini key from a **billing-enabled** Cloud project |
| `GEMINI_BILLING_ENABLED=true` | Required: confirms the key is not free tier (STT_PREFLIGHT §4.3) |

The tool refuses to send audio when a guard variable is missing.

## Preparing audio

```bash
ffmpeg -i original.wav -ac 1 -ar 16000 -c:a pcm_s16le audio/hx-001.them.wav
```

For the Opus test (Phase D), round-trip through Opus and back to WAV so every provider receives
the same degraded audio:

```bash
ffmpeg -i audio/hx-001.them.wav -c:a libopus -b:a 24k /tmp/x.opus && ffmpeg -i /tmp/x.opus -ac 1 -ar 16000 -c:a pcm_s16le audio/hx-001.them.opus24.wav
```

## Commands

```bash
export BENCH_DATA_DIR=~/meetyou-benchmark-data
pnpm --filter @meetyou/stt-benchmark bench run-batch  --config tools/stt-benchmark/examples/runs.phase-a.json
pnpm --filter @meetyou/stt-benchmark bench run-stream --config tools/stt-benchmark/examples/runs.phase-b.json
pnpm --filter @meetyou/stt-benchmark bench score      --config tools/stt-benchmark/examples/runs.phase-a.json
pnpm --filter @meetyou/stt-benchmark bench blind-samples --config tools/stt-benchmark/examples/runs.phase-b.json
pnpm --filter @meetyou/stt-benchmark bench measure-latency
```

- `--clips hx-001,hx-002` limits the run; batch runs skip clips that already have results.
- `--speed 1` is real time (required for latency numbers). Higher speeds are for smoke tests only.
- `score` writes `results/scores.csv`: WER (normalized and raw), CER, Hindi/English WER,
  code-switch WER, entity accuracy by type, hallucinations per minute of non-speech, echo words
  (`me` lane), DER (`them` lane), interim/final latency P50/P90, interim instability, rotations.

## How scoring works

1. Reference and hypothesis go through the same `Normalizer`: Devanagari → Roman transliteration,
   lowercase, punctuation and currency removal, canonical Hinglish spellings
   (`data/hinglish-canonical.json`), compound splits, safe number words → digits, filler removal.
2. Token-level Levenshtein alignment gives substitutions, deletions, insertions; errors are
   attributed to reference positions for language-split and code-switch WER.
3. Latency is provider-independent: an energy VAD on our own audio finds speech starts/ends, and the
   streaming log maps audio position → send time.

## Known limits (v1)

- The transliterator is rule-based (Ohala schwa deletion); English loanwords written in Devanagari
  may not match their English spelling. CER and raw/normalized WER are both reported for this reason.
- Compound numbers spoken as words ("chaalis hazaar") are not converted to digits.
- Deepgram Flux (`/v2/listen`) is not implemented yet.
- Gemini live rotation replays 2 s of audio into the new session; duplicate words at the boundary
  count as insertions (this mirrors what the production gateway must handle).
