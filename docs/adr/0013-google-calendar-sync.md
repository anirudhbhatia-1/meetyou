# ADR-0013: Google Calendar sync (opt-in, read-only)

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-11-18): Google Calendar API, opt-in from Settings, with Up next, names before the call, titles from the calendar and notes before the call |
| Date | 2026-11-18 |
| Changes | FEATURES B2 moves from Phase 2 into the product now (first version); ADR-0004's "sign-in asks for `openid email profile` only" stays true — calendar access is a separate, later consent |
| Related | [ADR-0004](0004-auth-and-token-model.md) (Google sign-in, PKCE) · [ADR-0005](0005-job-queue-and-outbox.md) (queue) · [ADR-0012](0012-azure-hosting.md) (Key Vault) · DESIGN §10.1, §15.7 · FEATURES B2 |

> Google facts were read on developers.google.com and support.google.com on 2026-11-18 (§6).
> **[Verify]** marks what still needs a check on staging.

## 1. Context

Anirudh chose calendar sync from the comparison with the open-source Yogurt recorder. It gives
four things in its first version: **Up next** on Home, **names before the call** (keyterms and
naming from the invite), **titles from the calendar**, and **notes before the call** that anchor
the summary. The sign-in screen promised "We don't read your calendar"; that stays true for
sign-in, and calendar access becomes its own opt-in step.

## 2. Decision

1. **Google Calendar API, read-only events.** Scope
   `https://www.googleapis.com/auth/calendar.events.readonly` (plus `openid email` to show which
   account). Requested only when the user presses **Connect** in Settings; never at sign-in.
2. **Consent flow.** The web app runs Google's authorization request with PKCE
   (`access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `login_hint`) and
   redirects to `/calendar/callback`; the API exchanges the code with the client secret
   (`POST /v1/calendar/connect`), as sign-in does. Granular consent: if the returned `scope` lacks
   the calendar scope, nothing is stored (`403 calendar_scope_denied`).
3. **Refresh token sealed.** AES-256-GCM (`auth/sealed.ts`), the connection ID as associated
   data, keys from `CALENDAR_TOKEN_KEYS` (`id:base64,…`, first seals, all open) in Key Vault. The
   token never leaves the API and worker, is never logged, and is revoked at Google on
   disconnect and on account deletion (`POST https://oauth2.googleapis.com/revoke`). A reconnect
   with the **same** Google account does not revoke the old token: revoking works on the whole
   grant and would kill the new one too. A reconnect with another account revokes the old grant,
   deletes the old account's events and waits for a fresh sync. A token whose sealing key is gone
   sets `needs_reconnect` (`key_missing`).
4. **Polling a window, not sync tokens.** Google does not allow `timeMin`/`timeMax` with a
   `syncToken`, so each run of `calendar.sync` asks `events.list` (primary calendar,
   `singleEvents=true`, `orderBy=startTime`, `eventTypes=default`) for yesterday to three days
   ahead and upserts what it gets. `synced_at` marks the events the latest poll returned; an
   event that moved away or was deleted stops showing but keeps its notes until housekeeping
   (14 days after it ended). Push channels (`events.watch`) are later work.
5. **Scheduling without a cross-workspace scan.** Each run re-queues itself 15 min ± 25 %
   later (Google advises jitter instead of fixed polling); `GET /v1/calendar/upcoming` queues a run
   when the last sync is older than 30 min, so a broken chain heals when the user opens Home. A
   revoked grant (`invalid_grant`, or 401 from the API) sets `needs_reconnect` and stops the chain.
6. **Data.** Migration `0012`: `calendar_connections` (one per user), `calendar_events` (title,
   times, Meet code, attendees with name, email, self, organizer; meeting rooms dropped),
   `calendar_event_notes`, and `meetings.calendar_event_id`. All with `workspace_id` and RLS.
   Disconnect deletes the connection, its events and their notes; recordings stay.
7. **Linking a recording.** `POST /v1/sessions` matches the user's event with the same Meet code
   on now (±30 min) that the latest poll still returned (a moved instance of a recurring series
   shares the code): the meeting takes the event's title (the AI title never replaces it), the
   notes before the call are copied into the meeting at session time 0 and returned in
   `StartSessionResponse.notes`, which the extension stores so the side panel starts with them
   (its first save keeps them). The gateway adds the invite's names (or the email's name part) and
   company names (work email domains) to the Deepgram keyterms from the first second, capped at
   12 names and 4 companies so names seen live still fit; the post-meeting pass uses the same
   terms. Export ("Download all my data") includes `calendar.json` (events, attendees, notes
   before the call; never the token).

## 3. Consequences

- Users who never connect see no change. Those who do get Up next, better names and titles, and
  notes that anchor the summary before the call starts.
- **Google verification:** a calendar scope counts as sensitive. While the OAuth app is in
  **Testing** (≤ 100 listed test users) no verification is needed, but **test users' grants expire
  after 7 days**: on staging, expect "Reconnect" weekly. Before public users: Google's
  sensitive-scope verification (home page, privacy policy on the same domain, demo video, scope
  justification; up to ~10 days of review).
- New personal data: attendee names and emails of the user's invites. Stored in our region, never
  logged, deleted on disconnect; the privacy policy and DPDP notice must list it.
- One more secret (`CALENDAR_TOKEN_KEYS`) and one more OAuth redirect URI per environment.
- Polling costs one Calendar API call per connected user per ~15 min (quota: 600 per user per
  minute, 10,000 per project per minute): fine for staging and beta; push channels before scale.

## 4. Setup (staging)

1. Google Cloud project of the OAuth client: enable the **Google Calendar API**; on the consent
   screen add the scope `.../auth/calendar.events.readonly`; add testers as **test users**.
2. OAuth client: add the redirect URI `https://<web origin>/calendar/callback`; add the same to
   the API's `ALLOWED_REDIRECT_URIS`.
3. Key Vault: `CALENDAR_TOKEN_KEYS` = `k1:<base64 of 32 random bytes>`
   (`openssl rand -base64 32`), referenced by the **api** and **worker** apps; the worker also
   needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Run migration `0012`. Connect a calendar in Settings and check Home's Up next.

## 5. Verification (staging) [Verify]

- Consent with `prompt=consent` returns a refresh token for the web OAuth client; the granted
  `scope` includes the calendar scope.
- `calendar.sync` runs, re-queues itself (graphile-worker `replace` mode with the running job's
  key), and Up next fills within a minute of connecting.
- A recording started on a calendar Meet call gets the event title, the notes before the call in
  the side panel, and spelled names in the live transcript.
- After 7 days (Testing mode) the row shows Reconnect, and reconnecting works.
- Disconnect revokes the grant (the app disappears from myaccount.google.com/permissions).

## 6. Sources (read 2026-11-18)

- OAuth 2.0 for web server apps (authorization params, token exchange, refresh, revoke,
  granular consent): developers.google.com/identity/protocols/oauth2/web-server
- Refresh token expiration and `invalid_grant`, Testing-mode 7-day expiry:
  developers.google.com/identity/protocols/oauth2 · support.google.com/cloud/answer/15549945
- Scopes: developers.google.com/identity/protocols/oauth2/scopes ·
  developers.google.com/workspace/calendar/api/auth
- Sensitive scope verification:
  developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- events.list and incremental sync (syncToken restrictions, 410):
  developers.google.com/workspace/calendar/api/v3/reference/events/list ·
  developers.google.com/workspace/calendar/api/guides/sync
- Event resource (attendees, conferenceData, hangoutLink):
  developers.google.com/workspace/calendar/api/v3/reference/events
- Push notifications: developers.google.com/workspace/calendar/api/guides/push
- Quotas and polling advice: developers.google.com/workspace/calendar/api/guides/quota
