# ADR-0011: Video (meeting screen) recording in Phase 1

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-11-01). The items marked [Verify] are checked in the S1 capture spike; a failed check reopens this ADR |
| Date | 2026-11-01 |
| Supersedes | PRD §3.3 non-goal "Video recording, screen recording, or clips" (the video part only; clips stay in Phase 3) |
| Related | [ADR-0001](0001-stt-provider.md) · [ADR-0003](0003-audio-transport-format.md) · [ADR-0005](0005-job-queue-and-outbox.md) · FEATURES K1 · ARCHITECTURE §4.4, §11.4 |

## 1. Context

Product direction (2026-11-01): along with audio, the **video of the meeting — what is on the
screen — is recorded too**. Until now video was a Phase 3 item. Users want to replay what was
shown (slides, a shared screen, a demo) next to the transcript. Competing extensions (Scribbl,
Bluedot) already record tab video.

Constraints:
- No bot.
- Weak Indian home connections: audio must never suffer because of video.
- The Chrome Web Store needs minimal permissions.
- DPDP: faces and screens are personal data.

## 2. Options

| Option | What is captured | Extra prompt | Notes |
|---|---|---|---|
| **A. Meet tab video** via the same `tabCapture` stream we already open for the `them` lane | Meet tab as rendered: participant grid, anyone's presented screen, captions | None — same user gesture | Own presentation shows Meet's "You are presenting" view, not the shared content |
| B. Whole screen / window via `getDisplayMedia` | Anything the user picks | Chrome picker every time | Captures notifications and other apps; heavier |
| C. Cloud bot | Meet's own layout | Host admits the bot | Out of scope (no bot) |

## 3. Decision

### 3.1 What is recorded

- **Default: Option A** — the Meet tab video, recorded together with the audio.
- **P1: Option B** as a per-meeting choice, "Record my whole screen". Users need this when they
  present their own screen, because the Meet tab does not show their shared content.
- **Setting `recordVideo`, default on.** The side panel shows a per-meeting toggle before
  recording starts.
  - Pause and resume apply to audio and video together.
  - When retention is "Delete immediately", video is off. The UI explains why: video only exists
    to be replayed.

### 3.2 Capture and encoding (offscreen document)

```
tabCapture stream ──► video track ─────────────────────────────┐
                 └──► audio (them) ─┐                          ▼
mic (me) ───────────────────────────┴─► WebAudio mix ──► MediaRecorder (video + mixed audio)
                                     (existing lanes still go to STT unchanged)    │ timeslice 10 s
                                                                                   ▼
                                                     IndexedDB video_buffer (write first)
                                                                                   │
                                                            uploader (lowest priority)
                                                                                   ▼
                                                       Cloud Storage via signed PUT URLs
```

**Constraints and container**
- Tab video is limited to 1280×720 (`maxWidth`/`maxHeight`) at 15 fps.
- The recorder uses `video/mp4;codecs=avc1,opus` when `MediaRecorder.isTypeSupported` says yes,
  otherwise `video/webm;codecs=vp9,opus`. [Verify] which Chrome versions support each, and whether
  the hardware encoder is used.

**Bitrate**

| Quality | Video | Mixed audio | Per hour |
|---|---|---|---|
| Standard | ~1 Mbps | 48 kbps | ≈ 470 MB |
| Data saver | 854×480, 10 fps, 400 kbps | 48 kbps | ≈ 200 MB |

Data saver switches on automatically when the upload backlog exceeds 2 minutes of video, and
switches back once the backlog clears.

**Sync with the transcript**
- The mixed audio inside the video file is only for playback.
- STT keeps using the two clean lanes (ADR-0001, ADR-0003), so speaker attribution is unchanged.
- Each recorder run is a **video part** with `startMs` on the session clock (ARCHITECTURE §5.5).
  Player time `t` maps to session time `part.startMs + t`, so transcript click-to-seek works on video.
- A restart (crash, extension reload, pause/resume) starts a new part.

### 3.3 Upload: never in the way of audio

- Video does **not** go over the realtime WebSocket. Fragments are uploaded with **one signed PUT
  per 10-second fragment** (`…/video/{partId}/{index}.frag`).
  - Idempotent: a retry overwrites the same object.
  - No resumable-session state to keep.
  - About 360 objects per hour.
- The uploader runs one request at a time.
  - It **pauses while the audio WebSocket is reconnecting** or the audio backlog is above 5 s.
  - It keeps going after the meeting ends.
  - The side panel shows "Uploading video — 40%".
- Fragments are deleted locally only after the PUT succeeds. Needs the `unlimitedStorage`
  permission, so a backlog of up to 1 hour (~470 MB) is not evicted.
- **Notes do not wait for video.** Transcript and summary are produced from audio as before. Video
  becomes available when it is ready.
- Bucket CORS allows only our extension origin. No extra host permission. [Verify] signed PUT from
  the offscreen document with bucket CORS.

### 3.4 Server processing

1. The API signs fragment URLs only for the caller's own active meeting.
   - Each URL expires after 15 minutes.
   - Each URL is bound to its content type and a maximum size of 8 MB.
2. When `session.ended` has arrived and all fragments of all parts are present (or 24 h have
   passed), the job queue (ADR-0005) runs `video.finalize` in the worker image (which includes ffmpeg):
   - Concatenate each part's fragments in order. A single recorder run concatenates into a valid
     stream.
   - Remux to **MP4 (H.264 + AAC), `faststart`**. The video is copied when it is already H.264, and
     transcoded only for the VP9 fallback.
   - Fill gaps between parts with a still frame and silence, so one file follows the session clock.
   - Write `playback.mp4` and a `poster.jpg`, then delete the fragments.
3. Playback uses a short-lived signed GET URL with HTTP range requests. Adaptive streaming (HLS) is
   Phase 3, together with clips.

### 3.5 Storage, retention, privacy

**Storage layout**
```
ws/{workspaceId}/meetings/{meetingId}/video/{partId}/{index}.frag   (temporary)
ws/{workspaceId}/meetings/{meetingId}/video/playback.mp4
ws/{workspaceId}/meetings/{meetingId}/video/poster.jpg
```
- Cloud Storage in `asia-south1`. Video never goes to the STT provider or the LLM.

**Retention**
- `retentionPolicy` (D-02) now covers **recordings — audio and video**. The 7-day default applies to both.
- The lifecycle backstop also covers the `video/` prefix.

**Consent**
- When video is on, the consent notice says audio **and screen** are being recorded.
- The pre-recording reminder mentions video.

**Rules that do not change**
- No face recognition.
- No emotion inference from video.
- No training on user data.

## 4. Consequences

**Permissions**
- Add `unlimitedStorage` (PRD §18).
- `tabCapture` already covers video.
- `getDisplayMedia` (P1) needs the `DISPLAY_MEDIA` offscreen reason. It is not a manifest permission.

**Bandwidth**
- Standard quality adds about 1 Mbps of upload during the meeting.
- On slow links, data saver and the post-meeting upload keep audio safe.
- [Verify] on a 2 Mbps hotspot that audio loss stays 0 (NFR-PERF-07, S1-11).

**CPU**
- H.264 encoding at 720p and 15 fps. [Verify] CPU and battery on a low-end Windows laptop. If the
  load is too high, data saver becomes the default on that device.

**Cost per meeting-hour**

| Item | Cost |
|---|---|
| Storage for 7 days | ≈ $0.003 |
| Finalize (copy remux) | < $0.01 CPU |
| Full replay (egress, ~$0.12/GB) | ≈ $0.06 |

[Verify] regional prices.

**Contracts**
- `video.part_started` / `video.part_stopped` events.
- `recordVideo` and `videoQuality` settings.
- `Meeting.video`.
- Fragment-signing and playback DTOs in `shared/contracts`.

**UI (DESIGN)**
- Video toggle in the pre-recording sheet.
- Upload state in the side panel.
- Player above the transcript in the meeting view, with click-to-seek.

**Legal**
- The privacy policy, consent explainer and terms add video/screen data.
- The sub-processor list is unchanged (Google Cloud already listed).

## 5. Verification (S1 capture spike, Anirudh)

| # | Check |
|---|---|
| 1 | `MediaRecorder` in the offscreen document records tab video + mixed audio for 60 min; which MIME types are supported — **partial 2026-11-04** (Anirudh's Chrome, M4 Mac): Chrome chose `video/mp4` (H.264 + Opus); a 33 s part plays at 1280×720, ~15 fps. The 60-minute run is pending |
| 2 | The captured Meet tab keeps rendering at 15 fps when the user switches to another tab or window |
| 3 | CPU, memory and battery with video on vs off (target: < 15% extra CPU on the reference laptop) |
| 4 | Audio loss stays 0 on a 2 Mbps link with video on; data saver kicks in |
| 5 | Signed PUT from the extension origin with bucket CORS; fragment concatenation + `faststart` remux |
| 6 | The player seeks to a segment's session time within ±0.5 s |
