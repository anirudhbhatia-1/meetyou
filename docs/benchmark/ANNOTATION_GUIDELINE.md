# Annotation Guideline — Reference Transcripts (S0-03)

| Field | Value |
|---|---|
| Version | 1.0 (2026-10-28) |
| Used by | S0-04 (clips 1–10, Gaurav), S0-05 (clips 11–20, Anirudh) |
| Spelling list | [`tools/stt-benchmark/data/hinglish-canonical.json`](../../tools/stt-benchmark/data/hinglish-canonical.json) |
| File format | [`tools/stt-benchmark/examples/reference.example.json`](../../tools/stt-benchmark/examples/reference.example.json), schema in `tools/stt-benchmark/src/schemas.ts` (`Reference`) |

The goal is a **verbatim** reference per lane that every provider is scored against. Consistency
matters more than elegance: two annotators must produce the same file for the same audio.

---

## 1. One file per clip lane

`refs/<clipId>.me.json` and `refs/<clipId>.them.json` in the benchmark data folder (never in git).
Times are **seconds from the start of that lane's WAV**.

## 2. What to write

| Rule | Example |
|---|---|
| Write what was said, not what was meant | "kal ka deployment push kar dete hain" (not "Let's deploy tomorrow") |
| Roman script for Hindi words (decision D-01) | "theek hai", not "ठीक है" |
| English words in standard English spelling | "deployment", "invoice", "sprint" |
| Names as people write them | "Rahul Mehta", "Razorpay", "Acme Foods" |
| Numbers that are values → digits | "15 lakh", "2.5 crore", "40000", "15 November", "5 baje" |
| "ek" used as an article stays a word | "ek cheez" (the normalizer treats both sides the same) |
| Currency symbols: leave out | "40000 rupaye" (if "rupaye" was spoken), otherwise "40000" |
| Repetitions and false starts: keep | "main main bol raha tha" |
| Cut-off words: write the audible part + `-` | "deplo-" |
| Do not add punctuation beyond what helps reading; it is removed before scoring | — |

## 3. Canonical Hinglish spelling

Use the canonical spelling from the list (`canonical` field). Examples:

| Write | Not |
|---|---|
| nahi | nahin, nhi, nahee |
| bahut | bohot, bahot, bht |
| accha | acha, achha, achchha |
| theek | thik |
| zyada | jyada, zyaada |
| kyun / kyunki | kyon, kyuki |
| hamara | humara |
| mein (= in) | me, mai |
| toh | to (when it means "so/then") |

If a word is missing from the list, choose the most common spelling, add it to the list in a PR,
and tell the other annotator. **Ambiguous** forms in the list (e.g. "me", "to", "or") are never
auto-rewritten; write the canonical form when the Hindi meaning is intended.

## 4. Word tags

Each word is an object `{ text, lang, start?, end?, filler?, unclear? }`.

| Field | How to set it |
|---|---|
| `lang` | `hi` for Hindi words (incl. Hindi function words in English sentences), `en` for English words, `other` for anything else (names may be `hi` or `en` by origin; be consistent) |
| `start`, `end` | Word times when you can see them in the waveform; at minimum, times for the first and last word of each turn and for every word inside a marked entity |
| `filler: true` | "um", "uh", "hmm", and Hindi used as filler ("matlab…", "haan haan" as back-channel). Fillers are excluded from WER |
| `unclear: true` | Words you cannot hear reliably even after three listens. Excluded from scoring |

## 5. Entities

`entities: [{ type, startWord, endWord }]` — indexes into `words` (inclusive). Mark every:

| Type | Examples |
|---|---|
| `person` | "Rahul Mehta", "Neha" |
| `org` | "Razorpay", "Acme Foods" |
| `number` | "15", "2.5" (with their unit word if part of the value: "15 percent") |
| `money` | "15 lakh", "40000 rupaye", "2.5 crore" |
| `date` | "15 November", "next Monday", "kal shaam 5 baje" |
| `term` | product and technical terms from the clip's vocabulary list: "staging", "API" |

## 6. Speaker turns (`them` lane)

`turns: [{ speaker, start, end }]` — one entry per continuous stretch of one person speaking.
Use the participant's first name in lowercase as `speaker`. Overlapping speech = overlapping turns.
Use each participant's own local recording (RECORDING_GUIDE §5) to place turn boundaries precisely.

## 7. Non-speech regions

`nonSpeech: [{ start, end }]` — every silence or noise-only stretch of **≥ 2 seconds** (the topic
cards include at least one 10-second pause). Used to measure hallucinations.

## 8. Process (bias control — STT_BENCHMARK_PLAN §4.3)

1. Start from each participant's **clean local recording**, not from the mixed lane.
2. If you use a machine draft, use a tool that is **not** one of the benchmarked providers.
3. Correct the draft by listening to the whole clip at least once at normal speed.
4. The other annotator reviews the file and the audio; disagreements are resolved by listening
   together, and the guideline or spelling list is updated if the rule was unclear.
5. Clips `hx-001` and `hx-011` are annotated by **both** people independently. Score one against the
   other with the scorer; agreement must be **< 5% WER**, otherwise fix the guideline first.

## 9. Checklist per file

- [ ] Every word has `lang`; fillers and unclear words tagged
- [ ] Canonical spellings used
- [ ] Entities marked with word times
- [ ] Turns cover all speech on the `them` lane
- [ ] Non-speech regions ≥ 2 s marked
- [ ] File validates: `node -e` with the `Reference` schema, or simply run `bench score` (invalid files fail loudly)
- [ ] Reviewed by the other annotator
