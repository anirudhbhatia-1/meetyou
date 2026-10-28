# STT Benchmark Plan (Decision D-03)

| Field | Value |
|---|---|
| Purpose | Choose the speech-to-text (STT) provider(s) for Phase 1 using our own Hinglish data |
| Decision informed | **D-03** (STT provider). Also feeds D-01 fallback (transliteration quality), D-06 (PCM vs Opus input), and the cost model (PRD §20) |
| Status | Plan — not started |
| Last updated | 2026-10-28 |
| Related | [PRD §15](PRD.md), [AGENTS.md](../AGENTS.md) |

> This is a plan only. Tooling (scoring scripts, streaming replay harness) is described by *what it
> must do*, not how it is coded. Items marked **[Verify]** must be checked against current vendor
> docs before the run.

---

## 1. Questions this benchmark must answer

1. Which provider transcribes **Hinglish (code-switched) meeting audio** most accurately, in both
   streaming and batch mode?
2. How good is each provider on **names, numbers, money (lakh/crore), dates, and product terms**,
   with and without vocabulary boosting?
3. How well does each provider **separate speakers** on the `them` lane?
4. What are the real **streaming latencies**, and do sessions survive **60+ minutes**?
5. Does any provider **invent text during silence or noise**?
6. Can we produce good **Roman-script display text** from each provider's output (D-01)?
7. Does sending **Opus instead of raw PCM** hurt accuracy (D-06)?
8. What is the real **cost per audio hour**, per lane?
9. Which transcript gives the **best downstream summary** (action items, owners, decisions)?
10. Is a **hybrid** best, e.g. provider X for live streaming and provider Y for the batch pass?

---

## 2. Providers and configurations

### 2.1 Candidates
| # | Provider | Modes to test | Why |
|---|---|---|---|
| P1 | **Sarvam AI** | Streaming + batch | Indian-language and code-mixed focus |
| P2 | **Deepgram Nova-3, multilingual mode** | Streaming + batch | Fast streaming; Hindi code-switching claimed |
| P3 | **Google Gemini Transcribe / Transcribe Live** | Streaming + batch | Low reported cost; strong multilingual model |
| B1 | **ElevenLabs Scribe** (baseline) | Batch | Accuracy reference for the batch pass |
| B2 | **OpenAI transcription model** (baseline) | Batch | Accuracy reference |

Optional if time allows: Gladia (streaming), AssemblyAI (batch only — reported to lack streaming Hindi).

Keep the core comparison to **P1–P3**. Baselines only run in batch mode to see whether a separate
batch provider is worth it.

### 2.2 Configuration matrix (record exact values used)
| Setting | Values to test |
|---|---|
| Language | Auto/multilingual; and explicit Hindi or Hinglish where the provider offers it |
| Diarization | On for `them` lane; off for `me` lane |
| Vocabulary boosting | Off; On (participant names + clip-specific terms) |
| Output script | Provider default; Roman/transliterated option if offered [Verify] |
| Timestamps | Word-level if available, else segment-level |
| Input format | 16 kHz mono PCM (all); Opus 24–32 kbps (top 2 providers only) |

For every run record: provider, model name and version, API endpoint, all parameters, date and
time. Vendors update models silently; results are only comparable if this is logged.

### 2.3 Provider pre-flight checklist (complete before any audio is sent)
- [ ] Data terms: is our audio used for training? How long do they keep it? Can we opt out or delete?
- [ ] Processing region
- [ ] Free credits / free tier limits and expiry
- [ ] Streaming session limits (max duration, idle timeout, keep-alive needs) [Verify Gemini ~10 min]
- [ ] Rate limits and concurrency
- [ ] Supported audio formats and sample rates
- [ ] Diarization availability in streaming vs batch
- [ ] Vocabulary boosting parameter name and limits (e.g. Deepgram `keyterm`) [Verify]
- [ ] Terms on **publishing benchmark results** (keep results internal unless allowed)

**Results:** see [STT_PREFLIGHT.md](STT_PREFLIGHT.md) (completed 2026-10-28 from docs; items marked
[Unknown] there must be tested). Key outcomes:
- Gemini runs on a **billing-enabled (paid) project only**. The free tier's terms forbid personal
  information, and our recordings contain real voices and names.
- Sarvam: turn off training in account settings first; top up beyond the ₹100 free credit.
- Deepgram: add `mip_opt_out=true` to every request.
- Extra configurations to test: Sarvam `translit` and `codemix` modes; Deepgram `nova-3` with
  `language=multi`, with `language=hi`, and `flux-general-multi`.

---

## 3. Dataset

### 3.1 Size
| Set | Content | Audio |
|---|---|---|
| **Core set** | 20 clips × ~10 min | ~3.3 h per lane (~6.6 h audio total across both lanes) |
| **Long-session set** | 2 meetings × 60 min | Stability and latency drift only |
| **Annotation subset** | 5 clips with extra Devanagari reference | Transliteration evaluation (D-01) |

### 3.2 Composition targets (core set)
| Dimension | Distribution |
|---|---|
| Language | Hinglish-heavy 50% · English (Indian accents) 25% · Hindi-dominant 15% · English with other regional accents 10% |
| Participants | 2 people: 8 clips · 3–4 people: 8 clips · 5+ people: 4 clips |
| Local audio setup (`me` side) | Wired/USB headset 35% · AirPods/Bluetooth 30% · Laptop mic + laptop speakers 35% (echo test) |
| Environment | Quiet 60% · Moderate noise (fan, traffic, café) 30% · Loud/poor 10% |
| Scenario | Standup · client/sales call · technical discussion · interview · planning with numbers |

### 3.3 Required content (spread across clips)
Each clip follows a light script or topic card so these appear naturally:
- **Indian names** of people and companies (at least 5 per clip)
- **Numbers and money:** "15 lakh", "2.5 crore", "₹40,000", percentages, phone-number-like digit strings
- **Dates and times:** "next Monday", "15 November", "kal shaam 5 baje"
- **Product and tech terms:** e.g. "deployment", "Kubernetes", "API", "sprint", "invoice"
- **Code-switching** at different points: within a phrase, sentence starts in Hindi and ends in English, and the reverse
- **Overlapping speech** and interruptions (at least 2 per multi-person clip)
- **Fast speech** segments and **long pauses / silence** (≥ 10 s, to test hallucination)
- **Explicit decisions and action items** with owners and dates (for the downstream test)

### 3.4 Recording method (no custom code needed)
Goal: produce audio that matches our production lanes before the extension exists.

1. Run a real Google Meet call between participants.
2. On the host machine, record **two separate tracks** with OBS Studio (multi-track recording):
   - Track 1 = microphone → becomes the `me` lane
   - Track 2 = Chrome/application audio → becomes the `them` lane
   [Verify] OBS app-audio capture setup on macOS and Windows before the first session.
3. **Every participant also records their own microphone locally** (QuickTime, Voice Memos, or a
   phone placed close by). These clean per-person tracks make ground-truth speaker turns and
   transcripts much easier and more accurate.
4. Keep originals as 48 kHz WAV. Derive:
   - 16 kHz mono 16-bit PCM WAV per lane (main test input)
   - Opus 24 kbps and 32 kbps per lane (D-06 test)
5. Note clock offset between tracks (clap or say a sync word at the start of each recording).

When the M1 capture prototype exists, re-record 3–5 clips through it to confirm results transfer
to the real pipeline.

### 3.5 Clip metadata (one row per clip)
| Field | Example |
|---|---|
| clip_id | `hx-007` |
| duration | 10:12 |
| language_mix | Hinglish ~60% hi / 40% en |
| participants | 3 (names list, consented) |
| local_setup | laptop mic + speakers |
| environment | moderate noise (fan) |
| scenario | sprint planning |
| vocabulary | names and terms used in the clip |
| consent_ref | consent form IDs |
| notes | two overlapping segments at 03:10 and 07:45 |

### 3.6 Consent and data handling
- Participants are team members, friends, or volunteers. **No customer or third-party meetings.**
- Written consent form covering: purpose, which vendors receive the audio (list them), whether a
  vendor may use it for training, storage location, retention, right to withdraw and deletion.
- Store audio and transcripts in an **encrypted shared drive with access limited to the team**.
  **Never commit audio or transcripts to git** (AGENTS.md §8).
- Delete or re-consent the dataset at the end of the project, as stated in the consent form.

---

## 4. Ground truth (reference transcripts)

### 4.1 What each reference contains
- Verbatim transcript per lane in **Roman script** (canonical Hinglish spelling, §4.2)
- Speaker turns with start/end times (`them` lane)
- Per-word language tags (`hi` / `en`) for code-switch metrics
- Tagged entities: person names, organizations, numbers/money, dates/times, product terms
- Marked non-speech regions (silence, noise-only) for hallucination checks
- For the 5-clip annotation subset: an additional **Devanagari** reference for Hindi words

### 4.2 Annotation guidelines (summary)
- English words keep standard English spelling ("deployment", not "deploymant").
- Hindi words use one canonical Roman spelling from a shared list, e.g.
  `hai`, `hain`, `nahi`, `kya`, `kyun`, `accha`, `theek`, `matlab`, `abhi`, `kal`.
  The list grows during annotation and is versioned with the dataset.
- Numbers written as digits ("15 lakh", "₹40,000"); dates as spoken but consistently.
- Fillers ("um", "uh", "matlab", "haan" used as filler) are tagged, and excluded from the main WER.
- Unclear words marked `[unclear]` and excluded from scoring.

### 4.3 Process and bias control
1. Create a first draft from each participant's clean local track (better audio than the mixed lane).
2. Use **a provider that is not in the core comparison** for the machine draft, or rotate drafts
   across providers — otherwise the reference becomes biased toward whichever provider produced it.
3. Human correction pass by one developer, review pass by the other.
4. **Double-annotate 2 clips independently** and measure agreement (target: < 5% WER between annotators).
   If agreement is worse, fix the guidelines before continuing.

### 4.4 Effort estimate
Careful annotation takes about 4–6× real time. Core set ≈ 3.3 h of `them` audio plus `me` lanes →
**roughly 20–30 person-hours**, split between both developers.

---

## 5. Normalization before scoring

Apply the **same** normalization to every provider and the reference:
1. Lowercase; remove punctuation.
2. Map Hinglish spelling variants to the canonical list (e.g. `nahin`, `nai` → `nahi`; `he`, `h` → `hai`).
3. Transliterate any Devanagari output to Roman with **one fixed transliteration tool** for all
   providers (record tool and version).
4. Normalize numbers (e.g. "pandrah lakh", "fifteen lakh", "15 lakh" → one form).
5. Remove tagged fillers and `[unclear]` regions.

Report both **raw** scores (before steps 2–4) and **normalized** scores. The gap shows how much
work our own transliteration and normalization layer will have to do.

---

## 6. Metrics

### 6.1 Accuracy
| Metric | Definition | Notes |
|---|---|---|
| **WER** | Word error rate vs reference (normalized) | Per clip, per lane, per condition |
| **CER** | Character error rate | Less sensitive to Roman spelling variation |
| **Code-switch WER** | WER on words within ±2 words of a language switch | Key Hinglish metric |
| **Language-split WER** | WER on `hi`-tagged words vs `en`-tagged words | Shows where a provider is weak |
| **Entity accuracy** | % of tagged entities transcribed exactly | Separately for names, numbers/money, dates, terms; boosting on vs off |
| **Silence hallucination rate** | Words inserted in marked non-speech regions per minute of non-speech | Important for LLM-based STT |
| **Echo leakage** | Words in `me` lane that belong to `them` speech (laptop-speaker clips) | Measures browser/OS echo cancellation, provider-independent but affects all |

### 6.2 Speakers and timing
| Metric | Definition |
|---|---|
| **DER** (`them` lane) | Diarization error rate with a 0.25 s collar |
| **Speaker count error** | Detected speakers vs actual |
| **Timestamp offset** | Mean absolute difference of word/segment start times vs reference (subset of clips) |

### 6.3 Streaming behaviour
| Metric | Definition |
|---|---|
| **Interim latency** | Time from audio sent to first interim text for that audio (P50, P90) |
| **Final latency** | Time from end of utterance to final text (P50, P90) |
| **Interim stability** | How much interim text changes before final (edit distance) |
| **Long-session stability** | Disconnects, forced session ends, latency drift over 60 min |

### 6.4 Downstream quality
Feed each provider's transcript to the **same** summary prompt and model, then compare against the
labelled decisions and action items in the clip:
- Action-item recall and precision
- Owner accuracy
- Decision precision
- Number/date errors in the summary

This is the metric users actually feel; it can reveal that a slightly worse WER does not matter, or
that entity errors matter a lot.

### 6.5 Display quality (D-01)
For 5 clips, both developers (blind to provider) rate the **Roman display text** after our
transliteration on a 1–5 scale for readability and naturalness.

### 6.6 Cost and operations
| Metric | Definition |
|---|---|
| **Cost per audio hour** | From actual billing, per lane and mode |
| **Cost with silence skipping** | Estimate if only speech segments are sent (matters most for `me` lane) |
| **Operational scorecard** (qualitative, 1–5) | Docs quality, SDK/WebSocket ergonomics, error clarity, rate limits, support, data terms |

---

## 7. How the benchmark runs

### 7.1 Required tooling (to be built later — described, not coded here)
| Tool | Must do |
|---|---|
| **Batch runner** | Send each prepared file to each provider/config; save raw JSON responses and run metadata |
| **Streaming replay harness** | Play a 16 kHz PCM file into each provider's streaming API **at real-time speed in 100 ms chunks**, identical for every provider; record arrival time of every interim/final message; handle keep-alive and reconnects |
| **Normalizer** | Implement §5 identically for all outputs |
| **Scorer** | Compute §6 metrics per clip/lane/config; export to one results sheet |
| **Summary runner** | Run the fixed summary prompt over each transcript for §6.4 |

All runs use the same machine and network where possible. Note network conditions; repeat
streaming runs twice per clip to measure variance.

### 7.2 Run phases
| Phase | What | Clips | Providers |
|---|---|---|---|
| **A — Batch accuracy** | All accuracy, diarization, entity metrics in batch mode | Core 20 | P1–P3, B1–B2 |
| **B — Streaming** | Same metrics plus latency/stability via replay harness | Core 20 | P1–P3 |
| **C — Long sessions** | 60-min stability, drift, session limits | Long 2 | P1–P3 |
| **D — Input format (D-06)** | PCM vs Opus 24/32 kbps | 8 representative clips | Top 2 from A/B |
| **E — Vocabulary boosting** | Boosting on vs off | Core 20 | P1–P3 (where supported) |
| **F — Downstream** | Summary quality from each transcript | 10 clips with labelled items | Best config per provider |
| **G — Display (D-01)** | Blind readability rating of Roman output | Annotation subset 5 | P1–P3 |

### 7.3 Order and stop rules
1. Run Phase A first. If a provider fails a **gate** (§8.1), drop it from later phases.
2. Run B and C only for providers that pass A.
3. If two providers are within 2 WER points on Hinglish, Phase F decides.

---

## 8. Decision rule

### 8.1 Gates (must pass all)
- Acceptable data terms: no training on our users' data on the plan we would buy; deletion possible.
- Streaming support for Hindi–English code-switching.
- Sessions of ≥ 60 min, or reliable session resumption without losing audio.
- Word- or segment-level timestamps.
- Diarization available (streaming or batch).

### 8.2 Weighted score (providers that pass the gates)
| Criterion | Weight |
|---|---|
| Hinglish WER (streaming, normalized) incl. code-switch WER | 30% |
| Entity accuracy (names, numbers, dates) | 15% |
| Downstream summary quality (§6.4) | 15% |
| Cost per audio hour | 15% |
| Streaming latency and stability | 10% |
| Diarization (DER) | 10% |
| Operational scorecard | 5% |

Each criterion is scaled 0–100 relative to the best provider on that criterion.

### 8.3 Targets
Compare winners against the provisional targets in [PRD §15.4](PRD.md). If no provider meets the
Hinglish targets, record the gap and decide whether to (a) accept and improve via post-processing,
(b) use a hybrid streaming + batch setup, or (c) revisit providers.

### 8.4 Possible outcomes
- **Single provider** for streaming and batch.
- **Hybrid:** one provider for live streaming, another for the post-meeting batch pass.
- **Per-language routing** (e.g. English-only meetings to a cheaper provider) — only if the gain is
  large, because it adds complexity.

---

## 9. Deliverables

1. **Results sheet:** every metric × clip × lane × provider × config, with run metadata.
2. **ADR-0001 — STT provider choice** in `docs/adr/`: options, results summary, decision, consequences.
3. Updates to **AGENTS.md** decisions log (D-03 closed) and **PRD** (§15.4 targets, §20 costs).
4. **D-01 follow-up:** keep Roman display or switch to mixed-script fallback, based on §6.5.
5. **D-06 recommendation:** PCM or Opus streaming, based on Phase D.
6. **Normalization spec** and the canonical Hinglish spelling list (reused in production).
7. The dataset, references, and metadata stored securely (not in git) for future regression runs
   when providers release new models.

---

## 10. Timeline and roles (proposal)

| Week | Work | Anirudh | Gaurav |
|---|---|---|---|
| 1 | Consent forms, topic cards, provider pre-flight checklist, OBS setup, record clips | Annotation guideline, canonical spelling list, topic cards | Consent forms, recording sessions and OBS setup, provider accounts and pre-flight checklist |
| 2 | Annotation and review; double-annotation agreement check | Annotate clips 11–20, review 1–10, agreement check | Annotate clips 1–10, review 11–20 |
| 3 | Build tooling (§7.1), run Phases A–C | Streaming replay harness, normalizer, scorer; Phases B–C | Batch runner; Phase A |
| 4 | Phases D–G, analysis, ADR | Input-format, boosting, and downstream tests; analysis; ADR-0001 | Display readability test (Phase G); results sheet |
| End of 4 | Decision meeting; ADR merged | Both | Both |

Task IDs for this work are S0-01 to S0-11 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Tooling code is written in week 3 only after this plan is approved, following AGENTS.md rules.

---

## 11. Budget estimate [Hypothesis]

- Audio volume: ~6.6 h (core, both lanes) × up to 5 provider configs × 2 modes, plus long
  sessions and repeats → on the order of **60–80 audio hours** in total.
- At roughly USD 0.30–1.00 per audio hour, that is about **USD 20–80**. Deepgram's reported signup
  credit covers its share; Sarvam's ₹100 credit does not (top-up needed); Gemini must be paid
  (expected to cost only a few dollars). See [STT_PREFLIGHT.md](STT_PREFLIGHT.md).
- LLM cost for the downstream test is small (a few dollars).

Track actual spend per provider during the run; it doubles as real cost data for the PRD.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Dataset too small or not representative | Composition targets (§3.2); add clips if results are close |
| Reference transcripts biased toward one provider | §4.3: non-competing draft provider, two-person review, agreement check |
| Roman spelling variation inflates WER | Canonical spelling list + CER + normalized and raw scores |
| Vendor model changes mid-benchmark | Log model versions and dates; finish each phase within a short window |
| Free credits run out | Prioritize Phases A and B; skip baselines if needed |
| Consent or privacy mistakes | Consent form before recording; secure storage; no real customer meetings |
| Results cannot be published | Check vendor terms (§2.3); keep results internal by default |
| OBS recording differs from extension capture | Re-record 3–5 clips through the M1 prototype and compare |

---

## Appendix A — Consent form contents (checklist)
- [ ] Purpose: internal STT benchmark for product development
- [ ] What is recorded (voice, names spoken, meeting content)
- [ ] Which vendors receive the audio, and whether any may use it for training
- [ ] Where it is stored, who can access it, how long it is kept
- [ ] Right to withdraw and have recordings deleted
- [ ] Signature, date, participant ID

## Appendix B — Topic card example
> **Scenario:** Sprint planning (3 people, Hinglish)
> **Must mention:** two people's full names, a vendor company name, "₹2.5 lakh budget",
> "15 November deadline", "API integration", "staging deployment".
> **Must include:** one clear decision ("launch staging pe Friday ko karenge"), two action items
> with owners and dates, one interruption, one 10-second pause.
