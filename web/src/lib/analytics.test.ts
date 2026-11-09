import type { ProductEvent } from '@meetyou/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LibraryApi } from '../api/types.ts';
import { Analytics } from './analytics.ts';

function fakeApi() {
  const sent: ProductEvent[][] = [];
  const api = { sendEvents: (events: ProductEvent[]) => (sent.push(events), Promise.resolve()) };
  return { api: api as unknown as LibraryApi, sent };
}

describe('Analytics (S4-15)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches events and sends them after a short wait', () => {
    vi.useFakeTimers();
    const { api, sent } = fakeApi();
    const analytics = new Analytics(api);
    analytics.track('summary_opened', { meetingId: 'mtg_1' });
    analytics.track('export_started', {});
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(5_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.map((e) => e.name)).toEqual(['summary_opened', 'export_started']);
  });

  it('drops queued and new events once the user opts out', () => {
    vi.useFakeTimers();
    const { api, sent } = fakeApi();
    const analytics = new Analytics(api);
    analytics.track('export_started', {});
    analytics.setOptOut(true);
    analytics.track('export_started', {});
    vi.advanceTimersByTime(5_000);
    analytics.flush();
    expect(sent).toEqual([]);
  });
});
