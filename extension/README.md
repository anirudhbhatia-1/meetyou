# MeetYou Chrome extension

This package is the Stage 1 MV3 skeleton for the Google Meet extension.

## Commands

- `pnpm --filter @meetyou/extension build` creates an unpacked extension in `extension/dist`.
- `pnpm --filter @meetyou/extension typecheck` validates the TypeScript sources.
- `pnpm --filter @meetyou/extension test` runs unit tests.

## Load locally

1. Run the build command.
2. Open `chrome://extensions`, enable Developer mode, and select **Load unpacked**.
3. Choose `extension/dist`.
4. Open a `https://meet.google.com/...` tab. The toolbar action can open the Meet-only side panel.

The manifest intentionally has no backend API host permission until S1-10 establishes the staging
domain. It requests microphone access only from the visible onboarding page; the offscreen document
does not request permissions.
