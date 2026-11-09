import { describe, expect, it } from 'vitest';

import { ProductEvent, ProductEventsRequest } from './analytics.ts';

const at = '2026-11-09T10:00:00.000Z';

describe('product analytics events (PRD §19.6)', () => {
  it('accepts typed IDs, counts and enums', () => {
    expect(
      ProductEvent.safeParse({ name: 'summary_opened', at, props: { meetingId: 'mtg_01ABC' } })
        .success,
    ).toBe(true);
    expect(
      ProductEvent.safeParse({ name: 'recording_stopped', at, props: { durationMs: 60_000 } })
        .success,
    ).toBe(true);
  });

  it('rejects free text, extra fields and unknown events', () => {
    const bad = [
      { name: 'summary_opened', at, props: { meetingId: 'Weekly sync with Rahul' } },
      { name: 'summary_opened', at, props: { meetingId: 'mtg_1', title: 'Weekly sync' } },
      { name: 'summary_opened', at, props: { meetingId: 'mtg_1' }, text: 'hi' },
      { name: 'notes_shared', at, props: { meetingId: 'mtg_1', action: 'email', format: 'plain' } },
      { name: 'transcript_typed', at, props: {} },
      { name: 'export_started', at: 'yesterday', props: {} },
    ];
    for (const value of bad) expect(ProductEvent.safeParse(value).success).toBe(false);
  });

  it('bounds a batch', () => {
    const one = { name: 'export_started', at, props: {} };
    expect(ProductEventsRequest.safeParse({ client: 'web', events: [one] }).success).toBe(true);
    expect(ProductEventsRequest.safeParse({ client: 'web', events: [] }).success).toBe(false);
    const many = Array.from({ length: 26 }, () => one);
    expect(ProductEventsRequest.safeParse({ client: 'web', events: many }).success).toBe(false);
  });
});
