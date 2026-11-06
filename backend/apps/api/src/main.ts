import { Db, createPgPool } from '@meetyou/db';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

async function main() {
  const config = loadConfig();

  let db: Db | undefined;
  if (config.databaseUrl) {
    const pool = createPgPool(config.databaseUrl);
    db = new Db(pool);
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
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal API server startup error:', err);
  process.exit(1);
});
