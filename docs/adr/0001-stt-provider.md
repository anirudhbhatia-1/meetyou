# ADR-0001: Speech-to-text provider(s)

| Field | Value |
|---|---|
| Status | **Pending benchmark** — results sections are filled in after Phases A–G |
| Decision | D-03 (PRD §22) |
| Inputs | [STT_BENCHMARK_PLAN.md](../STT_BENCHMARK_PLAN.md) · [STT_PREFLIGHT.md](../STT_PREFLIGHT.md) · `results/scores.csv` from `tools/stt-benchmark` |
| Owner | Anirudh (analysis) · Gaurav (logistics, Phase G) |

---

## 1. Context

We need one or more STT providers for (a) live streaming transcription of both lanes and (b) an
optional post-meeting batch pass, with strong Hindi–English code-switching and Roman display
(D-01). Vendor claims are not enough; the decision is based on our own 20-clip Hinglish benchmark.

## 2. Options

| Option | Streaming | Batch |
|---|---|---|
| Sarvam (Saaras v3-realtime / v4) | ✓ (`translit`, `codemix`) | ✓ (diarization) |
| Deepgram Nova-3 (`multi`, `hi`) | ✓ | ✓ |
| Gemini 3.5 Transcribe (Live / batch) | ✓ (10-min sessions) | ✓ (diarization ≤ 30 min) |
| Baselines (ElevenLabs Scribe, OpenAI) | — | ✓ |
| Hybrid | One provider live + another batch | — |

## 3. Gates (all must pass — STT_BENCHMARK_PLAN §8.1)

| Gate | Sarvam | Deepgram | Gemini |
|---|---|---|---|
| Data terms acceptable on the plan we would buy | | | |
| Streaming Hindi–English code-switching works | | | |
| ≥ 60-min sessions or reliable resumption | | | |
| Word or segment timestamps | | | |
| Diarization (streaming or batch) | | | |

## 4. Results (fill from `scores.csv`, normalized scores unless noted)

### 4.1 Streaming (Phase B)
| Run | Hinglish WER | Code-switch WER | WER hi | WER en | Entity acc. | DER | Interim P90 | Final P90 | Halluc./min | Cost/h |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

### 4.2 Batch (Phase A)
| Run | WER | CER | Entity acc. | DER | Cost/h |
|---|---|---|---|---|---|
| | | | | | |

### 4.3 Long sessions (Phase C)
| Run | Disconnects | Rotations | Latency drift | Notes |
|---|---|---|---|---|

### 4.4 Input format (Phase D) — PCM vs Opus 24/32 kbps
| Run | WER PCM | WER Opus 32 | WER Opus 24 |
|---|---|---|---|

### 4.5 Vocabulary boosting (Phase E)
| Run | Entity acc. off | Entity acc. on | Name acc. on |
|---|---|---|---|

### 4.6 Downstream summary quality (Phase F)
| Transcript from | Action-item recall | Precision | Owner accuracy | Number/date errors |
|---|---|---|---|---|

### 4.7 Display readability (Phase G, blind)
| Run | Readability (mean of 2 raters) | Naturalness |
|---|---|---|

## 5. Weighted score (STT_BENCHMARK_PLAN §8.2)

| Criterion | Weight | Sarvam | Deepgram | Gemini |
|---|---|---|---|---|
| Hinglish WER incl. code-switch | 30% | | | |
| Entity accuracy | 15% | | | |
| Downstream summary quality | 15% | | | |
| Cost per audio hour | 15% | | | |
| Streaming latency and stability | 10% | | | |
| Diarization | 10% | | | |
| Operations scorecard | 5% | | | |
| **Total** | | | | |

## 6. Decision

_To be written: chosen streaming provider and model, batch provider and model, configuration
(language mode, script mode, boosting), and what triggers a re-run (new model versions)._

## 7. Consequences

_To be written: D-01 follow-up (Roman vs mixed-script fallback), D-06 (PCM vs Opus), cost model
update in PRD §20, gateway rotation/keep-alive requirements from §4.3._

## 8. Run log

| Date | Phase | Runs | Clips | Who | Notes (model versions, anomalies) |
|---|---|---|---|---|---|
