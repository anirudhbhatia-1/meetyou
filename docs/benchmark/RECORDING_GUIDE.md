# Recording Guide — Benchmark Sessions (S0-01)

How to record the 20 core clips and 2 long sessions so that the audio matches our production lanes
(`me` = host microphone, `them` = Meet audio). No custom software is needed.

## 1. Before the session

- [ ] Every participant has signed the [consent form](CONSENT_FORM.md); note the form IDs.
- [ ] Pick a topic card from [TOPIC_CARDS.md](TOPIC_CARDS.md) and share it 10 minutes before.
- [ ] Decide the local setup for this clip (headset / AirPods / laptop mic + speakers) to hit the
      composition targets (STT_BENCHMARK_PLAN §3.2). Track counts in the metadata sheet.
- [ ] Host machine: OBS Studio installed and configured (§2). Do a 30-second test recording.
- [ ] Each participant: ready to record their own microphone locally (§5).

## 2. OBS setup on the host machine (two tracks)

[Verify on each OS before the first session.]

1. **Settings → Output → Output Mode: Advanced → Recording:** format **MKV** (safe if OBS crashes),
   audio tracks **1** and **2** ticked, encoder any (video is not needed; you can record a black scene).
2. **Settings → Audio:** sample rate **48 kHz**.
3. Sources in the scene:
   - **Mic/Aux** = the host's microphone → in **Advanced Audio Properties** assign to **Track 1 only**.
   - **Application audio capture** (macOS: "macOS Audio Capture" / "Application Audio Capture";
     Windows: "Application Audio Capture") targeting **Google Chrome** → **Track 2 only**.
     If per-application capture is unavailable, use desktop audio capture and close every other
     sound source (music, Slack).
4. Disable all filters (noise suppression etc.) — we want raw audio.
5. In Chrome's Meet settings, keep Meet's own noise cancellation at its default and note it in the
   metadata sheet.

## 3. During the session

1. Everyone joins the Meet call. Start OBS recording and every participant's local recording.
2. **Sync clap:** one person says "sync" and claps once, clearly. Used to align all files.
3. Follow the topic card naturally — speak as you normally would, Hinglish welcome.
4. Include the card's required items: names, numbers, money, dates, terms, one interruption, one
   10-second pause.
5. Stop after the target length (≈10 minutes; long sessions 60 minutes).

## 4. After the session

1. Export the two tracks from the MKV:
   ```bash
   ffmpeg -i session.mkv -map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le audio/hx-001.me.wav
   ffmpeg -i session.mkv -map 0:a:1 -ac 1 -ar 16000 -c:a pcm_s16le audio/hx-001.them.wav
   ```
   Keep the original 48 kHz files as `originals/hx-001.*`.
2. Collect participants' local recordings into `local/hx-001.<name>.<ext>`.
3. Fill one row in the [clip metadata sheet](templates/clip-metadata.csv) and add the clip to
   `manifest.json` (example: `tools/stt-benchmark/examples/manifest.example.json`).
4. Move everything into the encrypted benchmark data folder. Delete copies from Downloads/Desktop.

## 5. Participant local recordings

Any of: QuickTime / Voice Memos (macOS), Voice Recorder (Windows), phone voice recorder placed near
the speaker. Start before the sync clap. These clean tracks make reference transcripts and speaker
turns faster and more accurate (ANNOTATION_GUIDELINE §6, §8).

## 6. Naming

| Item | Pattern |
|---|---|
| Clip ID | `hx-001` … `hx-020` (core), `hx-101`, `hx-102` (long) |
| Lanes | `audio/<id>.me.wav`, `audio/<id>.them.wav` |
| References | `refs/<id>.me.json`, `refs/<id>.them.json` |
