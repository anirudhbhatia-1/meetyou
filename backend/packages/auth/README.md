# @meetyou/auth (S2-02)

Sign-in and tokens per [ADR-0004](../../../docs/adr/0004-auth-and-token-model.md). Framework-free:
the API service (S2-08) maps these functions to routes.

| Piece | What it does |
|---|---|
| `AuthService.signInWithGoogle` | `POST /v1/auth/google`: exchanges the PKCE authorization code with Google, verifies the ID token (signature, issuer, audience, expiry, verified email), finds or creates the user and personal workspace, returns our tokens |
| `AuthService.refresh` | `POST /v1/auth/refresh`: rotates the refresh token; a replayed (already used) token revokes its whole family |
| `AuthService.logout` | `POST /v1/auth/logout`: revokes the family (idempotent) |
| `authenticate(header, tokens)` | `Authorization: Bearer …` → `{ userId, workspaceId }`; then query with `Db.inWorkspace(workspaceId, …)` |
| `TokenService` | ES256 JWTs with `kid`: access (`aud=api`, 15 min) and stream (`aud=gateway`, 10 min, `jti`) tokens; `jwks` for `/.well-known/jwks.json` |
| `loadKeyRing` / `generateSigningJwk` | Signing keys from private P-256 JWKs (Secret Manager); the first signs, all verify (rotation) |

Errors are `AuthError` with a client-safe `code` and an HTTP `status` (401 or 403). No token
value is ever logged or put in an error message. Refresh tokens are stored only as SHA-256 hashes
(`@meetyou/db`, migration 0002).

Configuration for the API service: Google OAuth client ID and secret (Secret Manager), the exact
allowed redirect URIs (`https://<extension-id>.chromiumapp.org/oauth2` per build), and the signing
JWKs.

## Not yet

- TODO(S2-04): the gateway verifies stream tokens with `TokenService.verifyStreamToken`, checks
  `sessionId` against `hello`, and spends `jti` in Redis (it still uses dev tokens).
- TODO(S4-03): extension sign-in with `chrome.identity.launchWebAuthFlow` (re-add the `identity`
  permission then) and ADR-0004 checks 1–3 against a real Google client.
- TODO(S2-08): web-app refresh cookie and CSRF token (ADR-0004 §4.5).
