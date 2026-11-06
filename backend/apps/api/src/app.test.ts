import { beforeAll, describe, expect, it } from 'vitest';
import { TokenService, generateSigningJwk, loadKeyRing } from '@meetyou/auth';
import { createTestDb } from '@meetyou/db/testing';

import { buildApp } from './app.ts';
import { BadRequestError } from './errors.ts';
import { decodeCursor, encodeCursor, paginate, parseLimit } from './utils/pagination.ts';

describe('API Service Scaffold (S2-08)', () => {
  let tokens: TokenService;

  beforeAll(async () => {
    // Generate test signing key once for the test suite
    const key = await generateSigningJwk('test-api-key');
    const ring = await loadKeyRing([key]);
    tokens = new TokenService(ring);
  }, 15000);

  it('serves health checks on /health and /v1/health', async () => {
    const app = await buildApp({ tokens, config: { env: 'test' } });

    const rootRes = await app.inject({ method: 'GET', url: '/health' });
    expect(rootRes.statusCode).toBe(200);
    const rootBody = JSON.parse(rootRes.body);
    expect(rootBody.status).toBe('ok');
    expect(rootBody.version).toBe('0.1.0');
    expect(rootBody.db).toBe('skipped');
    expect(typeof rootBody.uptimeSeconds).toBe('number');

    const v1Res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(v1Res.statusCode).toBe(200);
    expect(JSON.parse(v1Res.body).status).toBe('ok');
  }, 10000);

  it('publishes OpenAPI 3.1 specification at /openapi.json and UI at /docs', async () => {
    const app = await buildApp({ tokens, config: { env: 'test' } });

    const specRes = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(specRes.statusCode).toBe(200);
    const spec = JSON.parse(specRes.body);
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.title).toBe('MeetYou REST API');
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();

    const docsRes = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(docsRes.statusCode);
  }, 10000);

  describe('Standard Error Formatting (ARCHITECTURE §12.2)', () => {
    it('formats 404 not found routes into standard ErrorBody', async () => {
      const app = await buildApp({ tokens, config: { env: 'test' } });

      const res = await app.inject({ method: 'GET', url: '/non-existent-route' });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({
        error: {
          code: 'not_found',
          message: 'route not found',
          retryable: false,
        },
      });
    });

    it('formats custom AppError instances into standard ErrorBody', async () => {
      const app = await buildApp({ tokens, config: { env: 'test' } });

      app.get('/test/custom-error', async () => {
        throw new BadRequestError('custom invalid field');
      });

      const res = await app.inject({ method: 'GET', url: '/test/custom-error' });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({
        error: {
          code: 'bad_request',
          message: 'custom invalid field',
          retryable: false,
        },
      });
    });

    it('sanitizes unhandled 500 errors into internal_error with retryable: true', async () => {
      const app = await buildApp({ tokens, config: { env: 'test' } });

      app.get('/test/boom', async () => {
        throw new Error('secret database failure password=123');
      });

      const res = await app.inject({ method: 'GET', url: '/test/boom' });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        error: {
          code: 'internal_error',
          message: 'internal server error',
          retryable: true,
        },
      });
      // Ensure raw error message / stack is not leaked
      expect(res.body).not.toContain('secret database failure');
    });
  });

  describe('Authentication & Tenancy Integration', () => {
    it('rejects unauthenticated requests on protected endpoints with 401 missing_token', async () => {
      const app = await buildApp({ tokens, config: { env: 'test' } });

      app.get('/test/protected', { preHandler: app.requireAuth }, async (req) => {
        return { user: req.user };
      });

      const res = await app.inject({ method: 'GET', url: '/test/protected' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({
        error: {
          code: 'missing_token',
          message: 'missing_token',
          retryable: false,
        },
      });
    });

    it('rejects invalid or forged tokens with 401 invalid_token', async () => {
      const app = await buildApp({ tokens, config: { env: 'test' } });

      app.get('/test/protected-2', { preHandler: app.requireAuth }, async (req) => {
        return { user: req.user };
      });

      const res = await app.inject({
        method: 'GET',
        url: '/test/protected-2',
        headers: {
          authorization: 'Bearer forged.invalid.token',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({
        error: {
          code: 'invalid_token',
          message: 'invalid_token',
          retryable: false,
        },
      });
    });

    it('authenticates valid tokens and scopes request to workspaceId', async () => {
      const { token } = await tokens.issueAccessToken({
        userId: 'usr_01JCV111111111111111111111',
        workspaceId: 'ws_01JCV222222222222222222222',
        scope: 'user',
      });

      const app = await buildApp({ tokens, config: { env: 'test' } });

      app.get('/test/me', { preHandler: app.requireAuth }, async (req) => {
        return {
          userId: req.userId,
          workspaceId: req.workspaceId,
        };
      });

      const res = await app.inject({
        method: 'GET',
        url: '/test/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        userId: 'usr_01JCV111111111111111111111',
        workspaceId: 'ws_01JCV222222222222222222222',
      });
    });
  });

  describe('Idempotency Keys', () => {
    it('returns cached response on duplicated Idempotency-Key', async () => {
      const app = await buildApp({ tokens, config: { env: 'test' } });

      let executionCount = 0;
      app.post('/test/mutate', async () => {
        executionCount += 1;
        return { count: executionCount };
      });

      const key = 'idem_key_12345';

      // 1st request
      const res1 = await app.inject({
        method: 'POST',
        url: '/test/mutate',
        headers: { 'idempotency-key': key },
      });
      expect(res1.statusCode).toBe(200);
      expect(JSON.parse(res1.body)).toEqual({ count: 1 });
      expect(res1.headers['x-idempotent-replay']).toBeUndefined();

      // 2nd request with same idempotency key
      const res2 = await app.inject({
        method: 'POST',
        url: '/test/mutate',
        headers: { 'idempotency-key': key },
      });
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res2.body)).toEqual({ count: 1 });
      expect(res2.headers['x-idempotent-replay']).toBe('true');
      expect(executionCount).toBe(1); // handler was not run again!
    });
  });

  describe('Pagination Utilities', () => {
    it('encodes and decodes cursor strings', () => {
      const payload = { id: 'item_01000', createdAtMs: 1730000000000 };
      const encoded = encodeCursor(payload);
      expect(typeof encoded).toBe('string');
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    it('bounds limit safely', () => {
      expect(parseLimit(undefined)).toBe(20);
      expect(parseLimit('50')).toBe(50);
      expect(parseLimit('500')).toBe(100); // capped at MAX_PAGE_LIMIT
      expect(parseLimit(-5)).toBe(20);
    });

    it('paginates a list and computes nextCursor', () => {
      const data = [{ id: '1' }, { id: '2' }, { id: '3' }];
      // Slicing 2 items with 3 returned (limit + 1)
      const page1 = paginate(data, 2, (item) => ({ id: item.id }));
      expect(page1.items).toEqual([{ id: '1' }, { id: '2' }]);
      expect(page1.nextCursor).toBeDefined();

      const decoded = decodeCursor(page1.nextCursor);
      expect(decoded?.id).toBe('2');

      // Last page (less than limit + 1)
      const page2 = paginate([{ id: '3' }], 2, (item) => ({ id: item.id }));
      expect(page2.items).toEqual([{ id: '3' }]);
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe('Database Health and Tenancy Integration', () => {
    it('verifies DB connectivity in health check when db is configured', async () => {
      const testDb = await createTestDb();
      const app = await buildApp({
        tokens,
        db: testDb.db,
        config: { env: 'test' },
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.db).toBe('ok');

      await testDb.close();
    }, 20000);
  });
});
