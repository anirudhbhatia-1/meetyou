# Privacy Policy — DRAFT (S0-18)

> **Draft for legal review (S6-05). Not legal advice and not yet in force.** Replace every
> `[placeholder]`. Product name "Minutes" is a working name (PRD D-09). Keep this text in sync with
> PRD §17 and the in-product privacy screens (DESIGN §15.3).

**Last updated:** [date] · **Applies to:** the Minutes Chrome extension, web app, and related services
provided by **[Company legal name]**, [registered address] ("we", "us").

## 1. Summary
- Minutes records meetings **only when you press Start**. No bot joins your calls.
- We record two audio lanes: **your microphone** and **the meeting tab**, and turn them into a
  transcript and notes. Unless you turn it off, we also record **the video of the meeting tab** (what
  is on screen) so you can replay it.
- By default **audio and video are deleted 7 days** after each meeting; you can choose "delete after
  notes" (no video is recorded with this setting) or 30 days. Transcripts and notes stay until you
  delete them.
- We **never use your data to train AI models**, and we only use providers that agree not to train
  on it.
- You can export or delete your data at any time.

## 2. What we collect
| Data | Source | Why |
|---|---|---|
| Account: name, email, Google account ID | Google sign-in (`openid email profile` only) | Sign you in; identify your workspace |
| Meeting audio (your mic, meeting tab) | Recorded after you press Start | Transcribe the meeting |
| Meeting video (the meeting tab as you see it: participants' video, shared screens, captions; or, if you choose it, your whole screen) | Recorded after you press Start, when "Record video" is on (default on; can be turned off per meeting or in Settings) | Let you replay what was shown next to the transcript. Video is not used for transcription or summaries |
| Transcripts, your notes, summaries, action items | Created by you and by our processing | Provide your notes |
| Meeting metadata: title, participant display names, time | Read from the meeting page | Label speakers and organise notes |
| Consent log: when a notice was posted, its text | Our extension | Show you and others that disclosure happened |
| Settings and preferences | You | Run the product the way you chose |
| Usage counts and diagnostics (no meeting content) | Our apps | Reliability, cost, and product decisions; you can opt out of analytics |

We do **not** read your calendar, Gmail, or browsing history, and we do not create voiceprints.
We do **not** run face recognition on video, and we do not infer emotions from audio or video.

## 3. How we use data
To provide transcription, notes, search, and exports; to keep the service secure and reliable; to
measure costs and quality using counts that contain no meeting content; to comply with law. We do
not sell personal data or use it for advertising.

## 4. Other people in your meetings
Recordings include other participants' voices and names and, when video is on, their faces and
anything they share on screen. You are responsible for telling them and getting consent where the
law requires it. Minutes helps by offering a notice in the meeting chat (which says audio and screen
are recorded when video is on) and keeping a consent log. If someone objects, "Stop and delete" removes everything from that call.

## 5. Service providers (sub-processors)
We share data only with providers that process it on our behalf under contracts or terms that
prohibit training on it. Current list: [SUBPROCESSORS.md](SUBPROCESSORS.md). We will update the list
before adding a provider. Meeting audio goes to our speech-to-text provider; meeting video is
**never** sent to speech-to-text or AI summary providers and stays in our own storage.

## 6. Where data is stored
Our primary storage is Google Cloud in **Mumbai, India** (`asia-south1`), including meeting audio
and video. Video is held temporarily on your computer until it has been uploaded, then removed
from your computer. Some providers may process data in other countries (see the sub-processor list). In
particular, meeting audio is sent for transcription to Google Cloud Speech-to-Text, which processes
it in Google's United States or European Union multi-region, outside India; the audio and
transcript are stored back in Mumbai. [Describe transfer safeguards after review.]

## 7. Retention
| Data | Kept for |
|---|---|
| Meeting audio and video | Your setting: deleted after notes are ready, 7 days (default), or 30 days. One setting covers both. With "deleted after notes are ready", video is not recorded |
| Transcripts, notes, summaries | Until you delete them or your account |
| Account data | Until you delete your account |
| Backups | Up to 30 days, then overwritten |
| Logs (no meeting content) | 30 days |

## 8. Your rights
Depending on where you live (including under India's Digital Personal Data Protection Act, 2023 and,
where applicable, the GDPR) you can: access your data, correct it, erase it, export it, withdraw
consent, and nominate a person to exercise your rights. Use **Settings → Privacy & data** or contact
us. We respond within [30] days.

**Grievance officer / contact:** [name], [email], [address].

## 9. Security
Encryption in transit and at rest, workspace isolation, short-lived access tokens, signed expiring
links for audio and video, and no meeting content in logs. No system is perfectly secure; we will notify you
and authorities as required if a breach affects your data.

## 10. Children
Minutes is not for people under 18.

## 11. Changes
We will notify you in the product before material changes take effect.
