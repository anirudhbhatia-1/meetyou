import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCors from '@fastify/cors';
import { TokenService, generateSigningJwk, loadKeyRing, type AuthService } from '@meetyou/auth';
import type { Db } from '@meetyou/db';
import type { LlmProvider } from '@meetyou/providers';
import { GcsBucket } from '@meetyou/storage';

import { loadConfig, type ApiConfig } from './config.ts';
import { handleFastifyError, handleNotFound } from './errors.ts';
import { authPlugin } from './middleware/auth.ts';
import { idempotencyPlugin, type IdempotencyStore } from './middleware/idempotency.ts';
import { swaggerPlugin } from './plugins/swagger.ts';
import { accountRoutes } from './routes/account.ts';
import { askRoutes } from './routes/ask.ts';
import { searchRoutes } from './routes/search.ts';
import { summaryRoutes } from './routes/summary.ts';
import { authRoutes } from './routes/auth.ts';
import { consentLogRoutes } from './routes/consent-log.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { meetingsRoutes } from './routes/meetings.ts';
import { notesRoutes } from './routes/notes.ts';
import { segmentsRoutes } from './routes/segments.ts';
import { sessionsRoutes } from './routes/sessions.ts';
import { settingsRoutes } from './routes/settings.ts';
import { videoRoutes } from './routes/video.ts';

export interface BuildAppOptions {
  tokens?: TokenService;
  db?: Db;
  config?: Partial<ApiConfig>;
  idempotencyStore?: IdempotencyStore;
  fastifyOptions?: FastifyServerOptions;
  /** Recordings bucket for video URLs; built from GCS_AUDIO_BUCKET when absent. */
  bucket?: GcsBucket;
  /** Tests replace the Google exchange; built from the config otherwise. */
  authService?: AuthService;
  /** "Ask this meeting" model; null or absent answers 503 `answers_unavailable`. */
  llm?: LlmProvider | null;
}

/**
 * Creates and configures the Fastify REST API instance (ARCHITECTURE §12, S2-08, S2-09).
 * Factory design allows in-memory fast testing with `app.inject()` and production startup.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...options.config };

  // Initialize or fallback TokenService
  let tokens = options.tokens;
  if (!tokens) {
    if (!config.authSigningJwks && (config.env === 'staging' || config.env === 'production')) {
      // An ephemeral key would break every token on restart and differ between instances.
      throw new Error(`api: ${config.env} needs AUTH_SIGNING_JWKS`);
    }
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
            // Cloud Logging reads `severity` and `message` (S2-11, ARCHITECTURE §20).
            messageKey: 'message',
            formatters: {
              level: (label: string) => ({
                severity: label === 'warn' ? 'WARNING' : label.toUpperCase(),
              }),
            },
            serializers: {
              req(req) {
                return {
                  method: req.method,
                  // No query string: cursors and search terms stay out of the logs (AGENTS §7).
                  url: req.url.split('?')[0],
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

  // 6. Routes (S2-08, S2-09)
  await app.register(healthRoutes, {
    db: options.db,
    version: '0.1.0',
  });

  await app.register(authRoutes, {
    tokens,
    db: options.db,
    config,
    ...(options.authService !== undefined ? { authService: options.authService } : {}),
  });

  await app.register(meRoutes);
  await app.register(accountRoutes);
  await app.register(settingsRoutes);
  await app.register(meetingsRoutes);
  await app.register(notesRoutes);
  await app.register(segmentsRoutes);
  await app.register(consentLogRoutes);
  await app.register(askRoutes, { llm: options.llm ?? null });
  await app.register(summaryRoutes);
  await app.register(searchRoutes);

  await app.register(sessionsRoutes, {
    tokens,
    config,
  });

  const bucket =
    options.bucket ??
    (config.gcsAudioBucket !== undefined ? new GcsBucket(config.gcsAudioBucket) : undefined);
  await app.register(videoRoutes, {
    ...(options.db !== undefined ? { db: options.db } : {}),
    ...(bucket !== undefined ? { bucket } : {}),
  });

  return app;
}
