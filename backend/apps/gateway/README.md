# Gateway (S1-05, local dev)

Realtime capture gateway (ARCHITECTURE §6): accepts the extension's WebSocket, stores audio in
durable 10-second chunks, acknowledges frames only after the write, resumes after reconnects, and
forwards each lane to one STT stream for live interim and final results.

## Run locally

From the repository root:

```bash
node backend/apps/gateway/src/main.ts
```

With live transcription through Deepgram (paid API; dev/testing use decided 2026-11-03,
`mip_opt_out=true` is always sent):

```bash
STT_PROVIDER=deepgram node --env-file=.env.bench backend/apps/gateway/src/main.ts
```

Then build the extension against it:

```bash
MINUTES_GATEWAY_URL=http://127.0.0.1:8787 pnpm --filter @meetyou/extension build
```

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV` | `local` | Only `local` and `ci` start: dev sessions have no sign-in |
| `PORT` | `8787` | Listens on 127.0.0.1 only |
| `DATA_DIR` | `backend/apps/gateway/.data` | Chunk storage (gitignored; holds real voices during dev) |
| `STT_PROVIDER` | `none` | `deepgram` for live transcripts; `none` calls no vendor |
| `DEEPGRAM_API_KEY` | — | Needed for `deepgram`; keep it in `.env.bench`, never in code |
| `DISPLAY_TEXT` | `as_provided` | `roman_rules` turns Devanagari into Roman Hinglish (D-01) |
| `REDIS_URL` | — | Shared session state for several instances (S2-04); in-memory when unset |
| `DATABASE_URL` | — | Segments, usage, meetings in Postgres (application role); files when unset |
| `DEV_WORKSPACE_ID` | — | Needed with `DATABASE_URL`: the workspace dev sessions record into |
| `STREAM_TOKEN_JWKS` | — | Public JWKS of the API, to accept real (JWT) stream tokens |
| `GCS_AUDIO_BUCKET` | — | Cloud Storage bucket (deployed); local disk under `DATA_DIR` when unset |
| `ALLOWED_ORIGINS` | — | Exact WebSocket origins (the pinned extension), deployed |
| `HOST` | `127.0.0.1` / `0.0.0.0` | Loopback locally, all interfaces when deployed |

With `APP_ENV=staging` or `production` the gateway has no dev endpoints and refuses to start
unless `DATABASE_URL`, `REDIS_URL`, `STREAM_TOKEN_JWKS`, `GCS_AUDIO_BUCKET` and
`ALLOWED_ORIGINS` are set (docs/STAGING_SETUP.md §9.1). Image: `Dockerfile.gateway`.

## Tools (S1-11 measurements)

| Command (repo root) | What it does |
|---|---|
| `node backend/apps/gateway/src/check-session.ts [sessionId] [--join]` | Loss check of a recorded session from `.data` (latest if no ID): missing frames, duplicates, pause gaps, usage and cost, uploaded video parts and missing fragments. `--join` writes each part as a playable `video/{partId}.mp4` in `.data`. Exit code 1 on loss |
| `node backend/apps/gateway/src/load-test.ts [sessions] [seconds] [opus\|pcm16]` | Starts a gateway with STT off on a temp dir and measures CPU/RSS under N synthetic sessions (§26.2 Q6) |
| `node backend/apps/gateway/src/record-fixture.ts [out.json]` | Records the synthetic standup (shared/fixtures) through the real gateway with a scripted STT provider (S2-13) |
| `POST /v1/dev/sessions/{id}/video:finalize` | Runs `video.finalize` now with the fragments that arrived (otherwise automatic once an ended session has every fragment) |
| `node --env-file=.env.bench backend/apps/gateway/src/backlog-speed.ts <wav> [seconds] [speed] [pcm16\|ogg_opus]` | Streams a public 16 kHz WAV to Deepgram faster than real time (§26.2 Q5). Paid API; Ogg mode needs ffmpeg |

## What is here and what is not yet

- `POST /v1/dev/sessions` and `POST /v1/dev/sessions/{id}/stream-token` stand in for the API
  (`POST /v1/sessions`, ADR-0004). Tokens are random, single use, 10 minutes, sent as the
  `token.<value>` subprotocol next to `minutes.v1`.
- Video (ADR-0011 §3.3): `POST /v1/dev/sessions/{id}/video/fragments:sign` (contract
  `SignVideoFragmentsRequest`) returns one URL per fragment, `PUT /v1/dev/video/{token}` stores it
  at `…/video/{partId}/{index}.frag`. URLs last 15 minutes, are bound to the content type, take at
  most 8 MB, and a retry overwrites the same file. They stand in for Cloud Storage signed URLs
  (S2-14).
  `GET /v1/dev/sessions/{id}/video` lists uploaded parts and `GET …/video/{partId}` plays one
  (fragments joined); the side panel's "Show last video" uses them.
- Storage follows ARCHITECTURE §11.4 on local disk:
  `ws/{workspaceId}/meetings/{sessionId}/audio/{lane}/{chunkStartMs}.opus` (or `.pcm16`) plus a
  `.json` manifest written last (commit marker), each fsynced.
- Opus is not decoded (ADR-0003 §3.1): packets are wrapped in Ogg for storage and for STT.
- Cost per session (AGENTS §3 rule 10): `usage.json` next to the chunks — stored audio per lane,
  STT minutes per lane, bytes, connections, estimated cost from the provider's list price.
- S2 (2026-11-06): transcript assembler (`assembler.ts`), results to Postgres or files
  (`sinks.ts`), session registry with Redis takeover (`registry.ts`), JWT stream tokens, STT
  `health` and batch-later marking, glossary key terms, video part timing, `video.finalize`
  (`@meetyou/video`; in-process locally via `local-finalizer.ts`).
- Not yet: the Cloud Storage chunk store and V4 signed URLs (staging), Memorystore, the API's
  `/sessions` and `/meetings/{id}/video` (S2-09, Gaurav). Each is marked `TODO` in the code.
- Logs carry IDs, counts and codes only (AGENTS §7).
