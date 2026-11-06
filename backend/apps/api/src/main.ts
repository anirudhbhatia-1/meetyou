import { Db, createPgPool } from '@meetyou/db';
import { startTracing } from '@meetyou/tracing';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

async function main() {
  const config = loadConfig();
  const tracing = startTracing('api');

  if (config.env === 'staging' || config.env === 'production') {
    if (!config.databaseUrl) {
      throw new Error(`DATABASE_URL is required in ${config.env}`);
    }
    if (!config.authSigningJwks) {
      throw new Error(`AUTH_SIGNING_JWKS is required in ${config.env}`);
    }
  }

  let db: Db | undefined;
  if (config.databaseUrl) {
    const pool = createPgPool(config.databaseUrl);
    db = new Db(pool);
    // Refuse a role that bypasses row-level security (ARCHITECTURE §11.3, STAGING_SETUP §6).
    await db.assertRowSecurityEnforced();
  }

  const app = await buildApp({
    db,
    config,
  });

  const address = await app.listen({
    port: config.port,
    host: config.host,
  });

  app.log.info({ address, env: config.env }, 'MeetYou API server started');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down API server...');
    await app.close();
    if (db) {
      await db.destroy();
    }
    await tracing.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal API server startup error:', err);
  process.exit(1);
});
