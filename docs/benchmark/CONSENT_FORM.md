# Participant Consent Form — Speech-to-Text Benchmark (S0-01)

> **Draft for internal use.** Have it reviewed before the first session if any participant is not
> a team member. Print or send as a fillable PDF; keep signed copies with the benchmark data, not in
> git. Form IDs (`CF-001`, …) go into the clip manifest (`consentRefs`).

**Form ID:** CF-____  **Participant name:** ______________________  **Date:** ____________

## What this is

We are building a meeting-notes product and need to test which speech-to-text service understands
Hindi, English, and Hinglish best. We will record short practice meetings and send the audio to a
few speech-to-text companies to compare their transcripts.

## What we record

- Your voice and everything you say during the practice meeting (about 10–60 minutes).
- Your name as it appears in the meeting and as spoken by others.
- Optionally, a separate recording of your own microphone made on your device.

Please do not share confidential, personal, or financial information during the session; use the
topic card and invented details.

## Who receives the audio

| Company | Purpose | What they do with it |
|---|---|---|
| Sarvam AI (India) | Transcription test | We turn off model training in our account. Their policy keeps content for a period we configure (default 30 days) and may process data outside India. |
| Deepgram (USA) | Transcription test | Every request is sent with Deepgram's opt-out from model improvement; opted-out data is kept only as long as needed to process it. |
| Google (Gemini API, paid tier) | Transcription test | On the paid tier Google does not use the content to improve its products; it logs it for a limited time for abuse detection and may store it in any country where it operates. |
| Our team (Anirudh, Gaurav) | Writing reference transcripts and scores | Stored in an encrypted folder only the two of us can access. Never put in source code repositories. |

We may also send transcripts (text, not audio) to an AI model to test summaries, under the same
paid, no-training terms.

## How long we keep it

Recordings and transcripts are kept until the benchmark is finished and the product's speech
provider is chosen, and **deleted no later than ____________ (date)** unless you agree in writing to
let us keep them for re-testing new models.

## Your choices

- Taking part is voluntary. You can stop the recording at any time.
- You can withdraw later: email ______________________ and we will delete your recordings and
  transcripts from our storage within 30 days, and ask the providers to delete what they hold
  where they allow it.
- Results are used internally. If we ever publish benchmark numbers, they will not include your
  voice, name, or what you said.

## Consent

- [ ] I agree to be recorded for this benchmark as described above.
- [ ] I agree that my audio may be sent to the companies listed above.
- [ ] (Optional) I agree that my recordings may be kept after the benchmark for re-testing new
      speech models, until I ask for deletion.

Signature: ______________________   Date: ____________

Recorded by (team member): ______________________
