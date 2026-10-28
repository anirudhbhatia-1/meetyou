# STT Provider Pre-flight Results

| Field | Value |
|---|---|
| Purpose | Complete the provider pre-flight checklist ([STT_BENCHMARK_PLAN.md §2.3](STT_BENCHMARK_PLAN.md)) before any audio is sent |
| Providers | Sarvam AI, Deepgram, Google Gemini |
| Researched | 2026-10-28, from vendor docs and pages (sources at the end) |
| Status | Desk research only — nothing tested yet |

> **Confidence labels.** **[Docs]** = stated in the vendor's official docs or terms.
> **[3rd-party]** = from blogs or aggregators, not confirmed by the vendor. **[Unknown]** = not
> found; must be tested or asked. Vendors change models, prices, and terms often — re-check before
> the run.

---

## 1. Summary

| Checklist item | Sarvam AI | Deepgram | Gemini |
|---|---|---|---|
| Streaming model | `saaras:v3-realtime` (beta, default) or `saaras:v4` [Docs] | Nova-3 (`language=multi` or `hi`); Flux `flux-general-multi` [Docs] | `gemini-3.5-transcribe-live` [Docs] |
| Batch model | Saaras v3/v4 Batch API [Docs] | Nova-3 pre-recorded [Docs] | `gemini-3.5-transcribe` [Docs] |
| Hindi | Yes, `hi-IN`, plus `auto` detection [Docs] | Nova-3 monolingual `hi` yes; Hindi in `multi` code-switching unclear for general Nova-3 (see §3.2) [Docs] | Yes, `hi-IN`; auto-detection and code-switching [Docs] |
| **Roman (Hinglish) output** | **Yes — `translit` mode outputs Latin script** [Docs] | Not documented for Nova-3 [Unknown] | Not documented [Unknown] |
| Mixed-script output (D-01 fallback) | **Yes — `codemix` mode** [Docs] | [Unknown] | [Unknown] |
| Interim results (streaming) | Yes, on realtime endpoint (`transcript.partial`) [Docs] | Yes [Docs] | Yes (`interim_input_transcription`) [Docs] |
| Diarization — streaming | Not mentioned [Unknown] | Expected yes (`diarize`); not verified for Hindi [Unknown] | **No** [Docs] |
| Diarization — batch | Yes (`diarized_transcript`), +₹0.10/min [Docs] | Yes [Docs] | Yes, up to 8 speakers; 3+ speakers experimental [Docs] |
| Timestamps | Chunk-level (phrase/sentence), not word-level [Docs] | Word-level [Docs] | Live: utterance-level only. Batch: word-level, may be less accurate [Docs] |
| Vocabulary boosting | `keyterms`, up to 50 terms × 64 chars, **`saaras:v4` only**; docs disagree on streaming support [Docs] | `keyterm`, Nova-3 and Flux, mono + multilingual, 500-token limit [Docs] | `custom_vocabulary`, up to 1,000 terms (~100 recommended) [Docs] |
| **Max streaming session** | Not stated [Unknown] | Not stated [Unknown] | **10 minutes**; resumption not documented [Docs] |
| Idle timeout / keep-alive | Inactivity closes with code 1008; send `ping` (interval not stated) [Docs] | ~10 s without audio → close 1011; send `KeepAlive` every 3–5 s [Docs] | [Unknown] |
| Audio input | Mono `linear16` (default), 8 or 16 kHz only, base64 in JSON [Docs] | Linear16 and many encodings [Docs] | 16 kHz mono 16-bit PCM, ~100 ms chunks [Docs] |
| **Training on our data** | **Yes by default; opt-out in account settings or by email.** Business customer agreements excluded from the policy [Docs] | Model Improvement Program; exclude each request with `mip_opt_out=true` [Docs] | **Free tier: yes, with human review. Paid tier: no** [Docs] |
| Data retention | Content: user-configurable, default 30 days after last access; logs 1 year [Docs] | Opted-out requests: kept only as long as needed to process [Docs] | Paid: logged "for a limited period" for abuse detection; no fixed period [Docs] |
| Data location | May be processed outside India (US, EU named) [Docs] | [Unknown] | May be stored or cached in any country with Google facilities [Docs] |
| Streaming price | ₹0.49/min pay-as-you-go (≈ ₹29/hour) [Docs] | ~$0.0092/min multilingual, ~$0.0077/min monolingual [3rd-party] | ~$0.009/min (≈ $0.54/hour), estimated from token pricing [Docs] |
| Batch price | ₹0.49/min; ₹0.59/min with diarization [Docs] | ~$0.0043/min [3rd-party] | ~$0.005/min (≈ $0.30/hour) [Docs] |
| Free credits | ₹100 per verified user (expiry not stated) [Docs] | ~$200 signup credit, no card [3rd-party] | Free tier for both transcribe models — **but not usable for our benchmark (see §4.3)** [Docs] |
| Rate limits / concurrency | Not stated; see "Credits & Rate Limits" page [Unknown] | Not found [Unknown] | Not stated; per-project, shown in AI Studio [Docs] |
| Benchmark publishing terms | [Unknown] | [Unknown] | No clause found in the Gemini API terms [Docs] |

---

## 2. Sarvam AI — details

### 2.1 Models and endpoints
- **Realtime endpoint** `/speech-to-text-realtime/ws`: default `saaras:v3-realtime` (beta), also
  `saaras:v4`. Sends interim (`transcript.partial`) and final events.
- **Legacy streaming endpoint** `/speech-to-text/ws`: defaults to Saaras v4, but gives **no interim
  results** — only a final transcript per utterance. Use the realtime endpoint.
- **REST:** up to 30 seconds of audio per request. **Batch:** up to 2 hours per file.

### 2.2 Output modes (very relevant to D-01)
| Mode | Output for "मेरा फोन नंबर है 9840950950" |
|---|---|
| `transcribe` (default) | मेरा फोन नंबर है 9840950950 (Devanagari) |
| `translit` | **mera phone number hai 9840950950 (Roman)** |
| `codemix` | मेरा phone number है 9840950950 (English in Latin, Hindi in Devanagari) |
| `verbatim` | Devanagari, fillers kept, numbers spelled out |
| `translate` | English translation |

In streaming, modes apply **only to final transcripts**; interim results are always plain
transcription (Devanagari for Hindi). Our live UI would show Devanagari interim text that turns
Roman when finalized, unless we transliterate interim text ourselves. **Test this.**

### 2.3 Gaps to test
- Maximum streaming session length (run a 60-minute session).
- Ping interval needed to avoid the 1008 inactivity close.
- Whether `keyterms` works on the streaming endpoint with `saaras:v4` (docs conflict).
- Streaming diarization (assume none; use batch diarization post-meeting).
- Rate limits and concurrent connections per plan.

### 2.4 Data terms — action required
- Sarvam's privacy policy says content (inputs and outputs) **is used for training by default**,
  with an opt-out in account settings. The section heading and body contradict each other, so
  treat it as **on by default**.
- **Before sending any benchmark audio: turn off training in the account settings and keep a
  screenshot.** For production, ask about a business customer agreement, which the policy says
  overrides these defaults.
- Set content retention to the shortest available period.

### 2.5 Budget note
₹100 free credit ≈ 200 minutes (~3.4 hours). The benchmark needs more than that for Sarvam alone
(both lanes, streaming + batch, repeats). Plan a small top-up (on the order of a few hundred rupees).

---

## 3. Deepgram — details

### 3.1 Models
- **Nova-3 monolingual Hindi** (`language=hi`) is listed.
- **Nova-3 multilingual** (`language=multi`) supports code-switching in batch and streaming, with
  optional `language_hint`. Docs recommend `endpointing=100` for streaming code-switching.
- **Flux** (`flux-general-multi`) lists Hindi.
- Older **Base** model lists `hi-Latn` (Roman Hindi) — old model, but worth one baseline run to
  see Roman output quality.

### 3.2 Hindi in code-switching — unclear
The languages overview lists Hindi in the `multi` set explicitly only under `nova-3-medical`. For
general Nova-3 the multilingual list is given as language codes and includes `hi`, but it is not
clear that Hindi–English code-switching inside a sentence works in `multi` mode. **Benchmark three
configurations:** `nova-3` + `language=multi` (+ `language_hint=hi,en`), `nova-3` + `language=hi`,
and `flux-general-multi`.

### 3.3 Vocabulary boosting (`keyterm`)
- Works on Nova-3 and Flux, monolingual and multilingual.
- Pass as repeated query parameters (`keyterm=Rahul&keyterm=staging%20deployment`); no weights,
  no commas.
- Limit: **500 tokens total** per request; docs recommend 20–50 key terms.
- Can be **replaced mid-stream** with a `Configure` message containing a `keyterms` array
  (streaming only). *Correction to our earlier review of the second blueprint: a `Configure`
  message does exist for this purpose, but the blueprint's `processors.keywords` format with
  weights was wrong.*

### 3.4 Connection behaviour
- No audio for ~10 seconds → connection closed with 1011. Send `{"type": "KeepAlive"}` every
  3–5 seconds during silence (e.g. while paused).
- Maximum connection duration and concurrency limits not found — test with a 60-minute session
  and check plan limits in the console.

### 3.5 Data terms — action required
- Deepgram runs a Model Improvement Program. Add **`mip_opt_out=true` to every request**. Opted-out
  requests are kept only as long as needed to process them.
- Deepgram's docs say to check pricing impact before opting out — **confirm whether opting out
  changes the price** (a third-party source suggests it may).
- Verify opt-out in Console → Usage → Logs (`mip_opt_out: true`).

### 3.6 Pricing and credits
Prices and the ~$200 signup credit come from third-party sources only. Confirm on Deepgram's
pricing page and in the console after signing up.

---

## 4. Gemini — details

### 4.1 Models and capabilities
| Feature | Batch `gemini-3.5-transcribe` | Live `gemini-3.5-transcribe-live` |
|---|---|---|
| Languages | 85+, auto-detect, mid-session code-mixing; Hindi `hi-IN` | Same |
| Speaker diarization | Yes, up to 8 speakers (3+ experimental) | **No** |
| Word timestamps | Yes (accuracy may drop) | **No** — utterance-level only |
| Custom vocabulary | Up to 1,000 terms (~100 best) | Same |
| Combining features | Custom vocabulary **cannot** be combined with diarization or word timestamps | — |
| Max length | 1 h per request; **30 min** with diarization or word timestamps | **10 min per session** |
| Modes | `VERBATIM` / `SMART` formatting | Same |

### 4.2 Implications
- **10-minute live sessions:** a 60-minute meeting needs at least 6 sessions per lane, with
  overlap at boundaries so words are not lost. Session resumption is not documented. This is a
  real engineering cost and a risk for the "≥ 60 min or reliable resumption" gate.
- **No live diarization:** live labels for the `them` lane would come only from Meet's
  active-speaker signal. That matches our design (PRD FR-SPK-03), with batch diarization afterwards.
- **Batch limits:** diarization requires chunks of ≤ 30 minutes, and we cannot use custom
  vocabulary in the same request as diarization.
- **Script control** is not documented — test whether Hindi comes back in Devanagari or Roman.

### 4.3 Data terms — important correction
- **Unpaid (free) tier:** Google uses prompts and responses to improve its products, and **human
  reviewers may read them**. The terms say: do not submit sensitive, confidential, or personal
  information to Unpaid Services.
- Our benchmark recordings contain real voices and names — that is personal information. So the
  **free tier must not be used for the benchmark either, even with consent.** Use a Cloud project
  with billing enabled (Paid Services), where Google does not use prompts or responses for training.
- Free tier is acceptable only for **fully synthetic audio** (e.g. text-to-speech test clips with
  no real people or personal details).
- Paid tier: prompts and responses logged for a limited period for abuse detection; may be stored
  or cached in any country.
- Must be 18+; not for services likely used by people under 18. EEA users: paid services only.

### 4.4 Pricing (official, per-minute estimates)
| Model | Audio input | Text output | ≈ per hour |
|---|---|---|---|
| `gemini-3.5-transcribe-live` | $0.005/min | $0.004/min | ~$0.54 |
| `gemini-3.5-transcribe` | $0.003/min | $0.002/min | ~$0.30 |

Google bases these per-minute figures on estimates of 25 audio tokens/second and 175 output
tokens/minute.

**Related (for summaries):** Gemini 3.8 Flash is $0.75 / $3.75 per 1M input/output tokens
**through 31 Dec 2026, rising to $1.50 / $7.50 from 1 Jan 2027** [Docs]. A 60-minute meeting
summary (~15k input, ~2k output tokens) costs about $0.02 now, ~$0.04 after the increase.

---

## 5. Preliminary gate check (benchmark plan §8.1)

| Gate | Sarvam | Deepgram | Gemini |
|---|---|---|---|
| Acceptable data terms | ⚠️ Possible after opt-out; business agreement preferred | ⚠️ Possible with `mip_opt_out`; check price impact | ✅ On paid tier only |
| Streaming Hindi–English code-switching | ✅ Documented | ⚠️ Unclear for general Nova-3 — test | ✅ Documented |
| ≥ 60 min sessions or reliable resumption | ❓ Test | ❓ Test | ⚠️ 10-min limit; reconnect logic needed |
| Word or segment timestamps | ✅ Chunk-level | ✅ Word-level | ✅ Utterance-level (live) |
| Diarization (streaming or batch) | ✅ Batch | ✅ (streaming expected) | ✅ Batch |

No provider is ruled out. All three go into Phase A of the benchmark.

---

## 6. Actions before the benchmark

| # | Action | Provider |
|---|---|---|
| 1 | Turn off training in account settings; screenshot it; set shortest content retention | Sarvam |
| 2 | Ask Sarvam about business customer agreement terms (training, retention, data location) | Sarvam |
| 3 | Top up credits (₹100 free is not enough) | Sarvam |
| 4 | Confirm whether `mip_opt_out=true` changes price; confirm signup credit in console | Deepgram |
| 5 | Add `mip_opt_out=true` to every benchmark request; verify in usage logs | Deepgram |
| 6 | Create a billing-enabled Google Cloud project for Gemini (no free tier with real voices) | Gemini |
| 7 | Check rate limits for each provider's plan | All |
| 8 | Check whether terms allow publishing benchmark results; keep internal until confirmed | All |
| 9 | Update the consent form: list Sarvam, Deepgram, Google as recipients and their retention terms | All |

---

## 7. Changes this research triggers elsewhere

- **AGENTS.md §10 pitfalls:** Deepgram `Configure` correction; Gemini free tier only for synthetic
  audio; Sarvam training opt-out.
- **PRD §14.5:** free tiers only with synthetic data (not "consented test data").
- **Benchmark plan:** Gemini runs on paid tier; Sarvam budget top-up; add the Deepgram and Sarvam
  model variants above to the configuration matrix.
- **D-01:** Sarvam's `translit` and `codemix` modes give a native Roman option and a native
  mixed-script fallback — evaluate both in Phase G.

---

## Sources

- Sarvam: [Realtime streaming STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming) ·
  [Streaming API (legacy)](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/streaming-api) ·
  [Saaras model](https://docs.sarvam.ai/api/getting-started/models/saaras) ·
  [Pricing](https://docs.sarvam.ai/api/getting-started/pricing) ·
  [Privacy policy](https://www.sarvam.ai/privacy-policy) ·
  [Trust center](https://www.sarvam.ai/trust-center)
- Deepgram: [Multilingual code-switching](https://developers.deepgram.com/docs/multilingual-code-switching) ·
  [Keyterm prompting](https://developers.deepgram.com/docs/keyterm) ·
  [Models & languages](https://developers.deepgram.com/docs/models-languages-overview) ·
  [Keep alive](https://developers.deepgram.com/docs/keep-alive) ·
  [Model Improvement Program](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program) ·
  [Streaming troubleshooting](https://developers.deepgram.com/docs/stt-troubleshooting-websocket-data-and-net-errors) ·
  [Pricing (3rd-party)](https://convertaudiototext.com/blog/deepgram-nova-3-explained)
- Gemini: [Gemini 3.5 Transcribe model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe) ·
  [Live transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe) ·
  [Pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
  [Gemini API terms](https://ai.google.dev/gemini-api/terms)
