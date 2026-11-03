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

## What is here and what is not yet

- `POST /v1/dev/sessions` and `POST /v1/dev/sessions/{id}/stream-token` stand in for the API
  (`POST /v1/sessions`, ADR-0004). Tokens are random, single use, 10 minutes, sent as the
  `token.<value>` subprotocol next to `minutes.v1`.
- Storage follows ARCHITECTURE §11.4 on local disk:
  `ws/{workspaceId}/meetings/{sessionId}/audio/{lane}/{chunkStartMs}.pcm16` plus a `.json`
  manifest written last (commit marker), each fsynced.
- Not yet: Cloud Storage (after S1-10), Redis session state, JWT stream tokens, Opus decode
  (clients send PCM16), transliteration of segment text, storing segments and events, health
  messages. Each is marked `TODO` in the code.
- Logs carry IDs, counts and codes only (AGENTS §7).
