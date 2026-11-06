import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachPoolErrorHandlers, createPgPool, poolMax } from './pg.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Postgres pool error handling', () => {
  it('logs a dropped idle connection by code instead of crashing the process', async () => {
    const pool = createPgPool('postgres://user:secret@127.0.0.1:1/db');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // An 'error' event without a listener would throw here.
    pool.emit('error', Object.assign(new Error('Connection terminated'), { code: '57P01' }));
    expect(logged).toHaveBeenCalledWith(
      JSON.stringify({ event: 'pg.connection_error', scope: 'pool', code: '57P01' }),
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret');
    await pool.end();
  });

  it('also guards each client the pool connects', () => {
    const pool = new EventEmitter() as unknown as Parameters<typeof attachPoolErrorHandlers>[0];
    attachPoolErrorHandlers(pool);
    const client = new EventEmitter();
    (pool as unknown as EventEmitter).emit('connect', client);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.emit('error', new Error('read ECONNRESET'));
    expect(logged).toHaveBeenCalledWith(
      JSON.stringify({ event: 'pg.connection_error', scope: 'client', code: 'Error' }),
    );
  });
});

describe('pool size per instance (PG_POOL_MAX)', () => {
  it('uses a valid value and falls back to 10 otherwise', async () => {
    expect(poolMax('4')).toBe(4);
    expect(poolMax(undefined)).toBe(10);
    expect(poolMax('0')).toBe(10);
    expect(poolMax('abc')).toBe(10);
    expect(poolMax('500')).toBe(10);
    const pool = createPgPool('postgres://localhost/none', 3);
    expect(pool.options.max).toBe(3);
    await pool.end();
  });
});
