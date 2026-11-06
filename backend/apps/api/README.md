# @meetyou/api

Fastify REST API service (ARCHITECTURE §12, S2-08, S2-09).

## Overview

The API service provides REST endpoints over HTTPS for the Chrome extension, library web app,
and internal integrations:
- **Authentication & Tenancy:** Integrates with `@meetyou/auth` and `@meetyou/db` (`db.inWorkspace(workspaceId, ...)`).
- **Standard Error Format:** Guarantees all errors follow `{ error: { code, message, retryable } }` (`ErrorBody`).
- **Idempotency Keys:** Supports `Idempotency-Key` header on mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) with response caching and in-flight conflict rejection.
- **Cursor Pagination:** Utilities for encoding, decoding, and slicing paginated lists matching `page<T>`.
- **OpenAPI 3.1 & Swagger:** Auto-generated interactive documentation at `/docs` and raw spec at `/openapi.json`.
- **Health Checks:** Liveness and DB readiness checks at `/health` and `/v1/health`.

## Scripts

```bash
# Run unit & integration tests
pnpm test

# Typecheck
pnpm typecheck

# Start local server
pnpm dev
```

