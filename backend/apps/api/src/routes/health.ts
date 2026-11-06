import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { Db } from '@meetyou/db';

export interface HealthRouteOptions {
  db?: Db;
  version?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  db: 'ok' | 'skipped' | 'error';
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, options) => {
  const { db, version = '0.1.0' } = options;

  const healthHandler = async () => {
    let dbStatus: 'ok' | 'skipped' | 'error' = 'skipped';

    if (db) {
      try {
        // Quick probe directly using sql without tenant scope
        // Note: Db doesn't have an unscoped method by design, but we can test via a dummy workspace probe
        // or check database readiness. In Db, inWorkspace requires valid ws_ ULID.
        // Let's check if we can verify readiness or catch errors safely.
        // Actually, Db has #kysely private. We can run inWorkspace on a probe workspace or check readiness.
        await db.inWorkspace('ws_01000000000000000000000000', async (tx) => {
          await sql`SELECT 1`.execute(tx);
        });
        dbStatus = 'ok';
      } catch (err) {
        fastify.log.warn({ err }, 'Health database check failed');
        dbStatus = 'error';
      }
    }

    const isHealthy = dbStatus !== 'error';

    const body: HealthResponse = {
      status: isHealthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version,
      db: dbStatus,
    };

    return body;
  };

  const schema = {
    tags: ['health'],
    summary: 'Service health and readiness check',
    description: 'Returns service liveness, uptime, version, and database connectivity status.',
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          uptimeSeconds: { type: 'number' },
          timestamp: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
          db: { type: 'string', enum: ['ok', 'skipped', 'error'] },
        },
        required: ['status', 'uptimeSeconds', 'timestamp', 'version', 'db'],
      },
      503: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['degraded'] },
          uptimeSeconds: { type: 'number' },
          timestamp: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
          db: { type: 'string', enum: ['error'] },
        },
        required: ['status', 'uptimeSeconds', 'timestamp', 'version', 'db'],
      },
    },
  };

  // Root health probe (e.g. for GCP Cloud Run container liveness probe)
  fastify.get('/health', { schema }, async (_request, reply) => {
    const result = await healthHandler();
    if (result.status === 'degraded') {
      reply.status(503);
    }
    return result;
  });

  // Versioned health probe (ARCHITECTURE §12)
  fastify.get('/v1/health', { schema }, async (_request, reply) => {
    const result = await healthHandler();
    if (result.status === 'degraded') {
      reply.status(503);
    }
    return result;
  });
};
