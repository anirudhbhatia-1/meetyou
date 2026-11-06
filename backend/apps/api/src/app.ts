import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCors from '@fastify/cors';
import { TokenService, generateSigningJwk, loadKeyRing } from '@meetyou/auth';
import type { Db } from '@meetyou/db';

import { loadConfig, type ApiConfig } from './config.ts';
import { handleFastifyError, handleNotFound } from './errors.ts';
import { authPlugin } from './middleware/auth.ts';
import { idempotencyPlugin, type IdempotencyStore } from './middleware/idempotency.ts';
import { swaggerPlugin } from './plugins/swagger.ts';
import { healthRoutes } from './routes/health.ts';

export interface BuildAppOptions {
  tokens?: TokenService;
  db?: Db;
  config?: Partial<ApiConfig>;
  idempotencyStore?: IdempotencyStore;
  fastifyOptions?: FastifyServerOptions;
}

/**
 * Creates and configures the Fastify REST API instance (ARCHITECTURE §12, S2-08).
 * Factory design allows in-memory fast testing with `app.inject()` and production startup.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...options.config };

  // Initialize or fallback TokenService
  let tokens = options.tokens;
  if (!tokens) {
    if (config.authSigningJwks) {
      const parsed = JSON.parse(config.authSigningJwks);
      const ring = await loadKeyRing(parsed);
      tokens = new TokenService(ring);
    } else {
      // Ephemeral signing key for local dev and tests
      const testKey = await generateSigningJwk('dev-key-1');
      const ring = await loadKeyRing([testKey]);
      tokens = new TokenService(ring);
    }
  }

  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.env === 'production' ? 'info' : 'debug',
            serializers: {
              req(req) {
                return {
                  method: req.method,
                  url: req.url,
                  path: req.routeOptions?.url,
                  parameters: req.params,
                };
              },
            },
          },
    ...options.fastifyOptions,
  });

  // 1. CORS
  await app.register(fastifyCors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-Match'],
    exposedHeaders: ['ETag', 'X-Idempotent-Replay'],
    credentials: true,
  });

  // 2. OpenAPI / Swagger Documentation
  await app.register(swaggerPlugin, {
    enabled: true,
  });

  // 3. Authentication & Workspace Tenancy
  await app.register(authPlugin, {
    tokens,
    db: options.db,
  });

  // 4. Idempotency Key Middleware
  await app.register(idempotencyPlugin, {
    store: options.idempotencyStore,
  });

  // 5. Global Error & Not Found Handlers (ARCHITECTURE §12.2)
  app.setErrorHandler(handleFastifyError);
  app.setNotFoundHandler(handleNotFound);

  // 6. Routes
  await app.register(healthRoutes, {
    db: options.db,
    version: '0.1.0',
  });

  return app;
}
