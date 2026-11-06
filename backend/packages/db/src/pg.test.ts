import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachPoolErrorHandlers, createPgPool } from './pg.ts';

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
