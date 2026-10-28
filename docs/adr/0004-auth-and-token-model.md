# ADR-0004: Authentication and token model

| Field | Value |
|---|---|
| Status | **Proposed** — needs approval from both developers |
| Date | 2026-10-28 |
| Related | [ARCHITECTURE §13](../ARCHITECTURE.md) · [PRD FR-ONB-02, §18](../PRD.md) · [ADR-0002](0002-backend-stack-and-hosting.md) |

## 1. Context

The Chrome extension (service worker, offscreen document, side panel, extension pages) and, from
beta, a web app need to authenticate users with **Google sign-in** using only `openid email profile`
(PRD FR-ONB-02), call our REST API, and open a **session-scoped** WebSocket to the gateway. No vendor
API key may reach the client. Refresh tokens must rotate with theft detection (ARCHITECTURE §13).

## 2. Decision drivers

1. Minimal Google scopes and a fast OAuth verification.
2. Works in an MV3 extension (service worker has no DOM, may be stopped at any time).
3. Our backend controls sessions, revocation, and the stream-token format.
4. Small amount of custom security code, built on well-tested libraries.
5. Same model later for the web app and desktop app.

## 3. Options

| Option | Summary | Verdict |
|---|---|---|
| **A. `chrome.identity.launchWebAuthFlow` + Authorization Code with PKCE → our backend → our tokens** | Extension opens Google's consent page; backend exchanges the code, verifies the ID token, issues our access/refresh tokens | **Recommended** |
| B. `chrome.identity.getAuthToken` | Returns a Google *access* token for Google APIs tied to the Chrome profile; not an identity proof for our backend; Chrome-only | Rejected |
| C. Google Identity Platform / Firebase Auth as the token issuer | Managed users and refresh tokens; we would still mint our own stream tokens; extra vendor coupling | Kept as fallback |
| D. Platform auth from another provider (e.g. Supabase Auth) | Not on our chosen platform (ADR-0002) | Rejected |

## 4. Decision (proposed): Option A

### 4.1 Sign-in flow
```
Extension (onboarding page or service worker)
  1. create code_verifier + state; call chrome.identity.launchWebAuthFlow(
       https://accounts.google.com/o/oauth2/v2/auth?client_id=…&response_type=code
       &scope=openid%20email%20profile&code_challenge=…&code_challenge_method=S256
       &redirect_uri=https://<extension-id>.chromiumapp.org/oauth2&state=…)
  2. receive code (check state)
  3. POST /v1/auth/google { code, codeVerifier, redirectUri }
Backend
  4. exchange code with Google (confidential web client secret in Secret Manager)
  5. verify the ID token (issuer, audience, expiry, email_verified)
  6. find/create user + personal workspace
  7. return { accessToken, refreshToken, expiresAt }
```
The Google OAuth client is a **Web application** client with the `chromiumapp.org` redirect URI
registered per extension ID (one for alpha, one for the store build).

### 4.2 Tokens
| Token | Format | Lifetime | Stored (client) | Notes |
|---|---|---|---|---|
| Access token | JWT, ES256, `kid` header, claims `sub`, `wsid`, `scope`, `exp` | 15 min | memory + `chrome.storage.session` | Verified by API and gateway via JWKS |
| Refresh token | Opaque 256-bit random | 30 days, sliding | `chrome.storage.local` | Stored **hashed** (SHA-256) server-side with a family ID |
| Stream token | JWT, `aud=gateway`, claims `sid` (session), `lanes`, `jti`, `exp` | 10 min to connect | memory in the offscreen document | Single use at connect; reconnects request a fresh one |

### 4.3 Rotation and revocation
- `POST /v1/auth/refresh` returns a new access token **and** a new refresh token; the old one is
  marked used.
- If a used refresh token is presented again, the **whole family is revoked** (theft signal) and
  the user must sign in again.
- `POST /v1/auth/logout` revokes the family. Account deletion revokes all families.
- Signing keys live in Secret Manager (or Cloud KMS), rotated every 90 days; JWKS keeps the previous
  key until all tokens signed with it expire.

### 4.4 Stream tokens
- Issued by `POST /v1/sessions` (first connect) and `POST /v1/sessions/{id}/stream-token`
  (reconnects, e.g. after the 60-minute Cloud Run limit).
- The gateway checks `aud`, `exp`, `sid` matches the `hello.sessionId`, and that `jti` is unused
  (Redis, TTL = token lifetime).

### 4.5 Web app (beta) and desktop app (Phase 2)
- Web app: same backend; refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to
  the API path, access token in memory, CSRF token on state-changing requests.
- Desktop app: same flow with a loopback redirect URI + PKCE; refresh token in the OS keychain.

### 4.6 Libraries
`jose` (JWT/JWKS) on the server and in the gateway; Google token endpoint called directly over
HTTPS. No custom crypto. [Verify current versions at implementation time.]

## 5. Consequences

- **Permission:** the extension now uses `identity` (PRD §18 updated from "if used" to used).
- **API:** adds `POST /v1/sessions/{id}/stream-token` (ARCHITECTURE §12.1).
- **Data:** `refresh_token_families` and `refresh_tokens` tables (hash, family, used_at, expires_at,
  revoked_at); used-JTI cache in Redis.
- **Risk:** storing the refresh token in `chrome.storage.local` is readable by anyone with access to
  the user's profile on disk; mitigated by rotation, reuse detection, 30-day expiry, and revocation.

## 6. Verification before acceptance

| # | Check | Owner |
|---|---|---|
| 1 | `launchWebAuthFlow` from the MV3 service worker and from the onboarding page (both work?) | Anirudh (with S1-01 skeleton) |
| 2 | Google OAuth client type and redirect URI rules for `chromiumapp.org` | Anirudh |
| 3 | Basic-scope consent screen needs only brand verification, not sensitive-scope review | Gaurav |
| 4 | `jose` ES256 + JWKS performance in Cloud Run cold starts | Anirudh |

## 7. Sources
- [Chrome identity API IDL](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/identity.idl)
- [Building an extension with Google OAuth to a Cloud Run backend (dev.to)](https://dev.to/saloni28/how-i-built-a-chrome-extension-that-connects-securely-to-a-flask-backend-with-google-oauth-cloud-1307)
- [Auth0 community: MV3 + PKCE with launchWebAuthFlow](https://community.auth0.com/t/chrome-extension-manifest-v3-using-auth0-in-a-secure-manner/125433)
