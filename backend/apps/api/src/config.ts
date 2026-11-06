/**
 * API service configuration (ARCHITECTURE §12, §13).
 */

export interface ApiConfig {
  port: number;
  host: string;
  env: 'local' | 'staging' | 'production' | 'test';
  corsOrigins: (string | RegExp)[];
  databaseUrl?: string;
  authSigningJwks?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  allowedRedirectUris: string[];
  gatewayWsUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = parseInt(env.PORT ?? '8080', 10);
  const host = env.HOST ?? '0.0.0.0';
  const rawEnv = env.APP_ENV ?? env.NODE_ENV ?? 'local';
  const appEnv =
    rawEnv === 'production' || rawEnv === 'staging' || rawEnv === 'test' ? rawEnv : 'local';

  // Allowed CORS origins: extension, web app, and local tools
  const corsOrigins: (string | RegExp)[] = [
    // Local Vite dev server
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    // Chrome extension IDs
    /^chrome-extension:\/\/[a-z]{32}$/,
  ];

  if (env.CORS_ALLOWED_ORIGINS) {
    const extra = env.CORS_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    corsOrigins.push(...extra);
  }

  const allowedRedirectUris = env.ALLOWED_REDIRECT_URIS
    ? env.ALLOWED_REDIRECT_URIS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        // Pinned Extension ID redirect URI (ADR-0004 §4.1, STAGING_SETUP §4)
        'https://hjimcofnjnikbeepahmclaniopbnhbbe.chromiumapp.org/oauth2',
        // Local dev callback
        'http://localhost:5173/auth/callback',
      ];

  const gatewayWsUrl =
    env.GATEWAY_WS_URL ??
    (appEnv === 'staging'
      ? 'wss://meetyou-staging-gateway-7oflznia2a-el.a.run.app'
      : 'wss://gateway.meetyou.local');

  return {
    port: Number.isNaN(port) ? 8080 : port,
    host,
    env: appEnv,
    corsOrigins,
    databaseUrl: env.DATABASE_URL,
    authSigningJwks: env.AUTH_SIGNING_JWKS,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    allowedRedirectUris,
    gatewayWsUrl,
  };
}
