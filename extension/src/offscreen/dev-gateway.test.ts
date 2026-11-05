import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDevSessionWithRetry } from './dev-gateway.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createDevSessionWithRetry', () => {
  it('retries a briefly unreachable gateway instead of recording local-only', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      if (calls < 3) return Promise.reject(new TypeError('Failed to fetch'));
      const body = { sessionId: 'ses_1', streamUrl: 'ws://127.0.0.1:8787/v1/stream' };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 201 }));
    });
    const errors: string[] = [];
    const session = createDevSessionWithRetry('http://127.0.0.1:8787', (c) => errors.push(c));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await session).toEqual({
      sessionId: 'ses_1',
      streamUrl: 'ws://127.0.0.1:8787/v1/stream',
    });
    expect(errors).toHaveLength(2);
  });

  it('gives up after the last attempt', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const session = createDevSessionWithRetry('http://127.0.0.1:8787', () => undefined, 2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await session).toBeNull();
  });
});
