# MeetYou Chrome extension

Stage 1 MV3 extension for Google Meet: two-lane audio capture (S1-02), 16 kHz PCM16 framing in an
AudioWorklet (S1-03), IndexedDB write-first buffer and stream client (S1-04), recording state
machine (S1-06) and the Meet tab video recorder (S1-13).

## Commands

- `pnpm --filter @meetyou/extension build` bundles every entry point with esbuild into
  `extension/dist` (capture and local buffering only, no gateway).
- `MINUTES_GATEWAY_URL=http://127.0.0.1:8787 pnpm --filter @meetyou/extension build` also streams
  to the local gateway (`backend/apps/gateway`).
- `pnpm --filter @meetyou/extension typecheck` validates the TypeScript sources.
- `pnpm --filter @meetyou/extension test` runs unit tests.

Entry points (`scripts/build.mjs`): the service worker, offscreen document, side panel and
onboarding page are ES modules; the content script and the audio worklet are classic scripts.

## Load locally

1. Run a build command.
2. Open `chrome://extensions`, enable Developer mode, and select **Load unpacked**.
3. Choose `extension/dist`. After every rebuild, press the extension's reload button.
4. Open a `https://meet.google.com/...` tab and click the toolbar icon to open the side panel.
   The icon click is what lets Chrome grant tab capture (a browser-opened panel does not).

The side panel's "Capture check" section is a developer control (start/stop/pause, lane meters,
gateway link, live transcript lines, local video download). It is replaced by the DESIGN.md UI in
S4.

The manifest has no backend host permission yet; the local gateway answers with CORS for dev. It
requests microphone access only from the visible onboarding page; the offscreen document does not
request permissions.
