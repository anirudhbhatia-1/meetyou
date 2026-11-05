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

## Tools (S1-11 measurements)

| Command (repo root) | What it does |
|---|---|
| `node backend/apps/gateway/src/check-session.ts [sessionId] [--join]` | Loss check of a recorded session from `.data` (latest if no ID): missing frames, duplicates, pause gaps, usage and cost, uploaded video parts and missing fragments. `--join` writes each part as a playable `video/{partId}.mp4` in `.data`. Exit code 1 on loss |
| `node backend/apps/gateway/src/load-test.ts [sessions] [seconds] [opus\|pcm16]` | Starts a gateway with STT off on a temp dir and measures CPU/RSS under N synthetic sessions (§26.2 Q6) |
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
- Not yet: Cloud Storage (after S1-10), Redis session state, JWT stream tokens, transliteration
  of segment text, storing segments and events, health messages, a usage table, video finalize
  (concat + faststart MP4, S2-14). Each is marked
  `TODO` in the code.
- Logs carry IDs, counts and codes only (AGENTS §7).
