# Provider Pre-flight Runbook (S0-02)

Step-by-step actions from [STT_PREFLIGHT.md §6](../STT_PREFLIGHT.md) that a person must do in each
vendor's console before any benchmark audio is sent. These involve accounts, payments, and keys,
so they are done by a team member, not an agent. Tick each item and note the date.

> Keys go into your shell environment or a password manager — **never** into a file in the repo,
> chat, or a document. See `tools/stt-benchmark/README.md` for the variable names.

## Sarvam AI

- [ ] Create or sign in to the Sarvam dashboard account used for the project.
- [ ] **Turn off training on our content** in account settings; take a screenshot and store it with
      the benchmark data (the policy says content is used for training unless you opt out).
- [ ] Set **content retention** to the shortest available period.
- [ ] Check the remaining credit (₹100 free on sign-up ≈ 200 minutes) and **top up** enough for the
      benchmark (estimate: Sarvam share of ~60–80 audio hours across runs at ₹0.49–0.59/min).
- [ ] Note rate limits / concurrent connections shown on the "Credits & Rate Limits" page.
- [ ] Email Sarvam asking about business-customer terms: training, retention, data location.
- [ ] Create an API key; export `SARVAM_API_KEY` and `SARVAM_TRAINING_OPT_OUT_CONFIRMED=true`.

## Deepgram

- [ ] Create or sign in to the Deepgram console account.
- [ ] Confirm the sign-up credit amount in the console (third-party sources say ~$200).
- [ ] Find the pricing note for **`mip_opt_out`** (the docs say to check pricing impact) and record
      whether opting out changes the price.
- [ ] Note the plan's concurrency limit.
- [ ] Create an API key; export `DEEPGRAM_API_KEY`.
- [ ] After the first run, open **Usage → Logs** and confirm requests show `mip_opt_out: true`.

## Google Gemini

- [ ] Create a Google Cloud project for the benchmark with **billing enabled** (this is also the
      project family ADR-0002 uses).
- [ ] Create an API key restricted to the Generative Language API, in that project.
- [ ] Confirm in Google AI Studio that the key shows as **paid tier** (not free).
- [ ] Note the project's rate limits for `gemini-3.5-transcribe` and `-live`.
- [ ] Export `GEMINI_API_KEY` and `GEMINI_BILLING_ENABLED=true`.

## All providers

- [ ] Check each provider's terms for **publishing benchmark results**; keep results internal by
      default.
- [ ] Update the [consent form](CONSENT_FORM.md) with the final provider list and retention terms.
- [ ] Record outcomes (dates, limits, prices, answers) in STT_PREFLIGHT.md and HANDOFF.md.
- [ ] Run `bench measure-latency` from Google Cloud Shell in `asia-south1` (ADR-0002 check 4).
