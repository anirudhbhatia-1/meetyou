import { describe, expect, it } from 'vitest';

import { namesLabel, whenLabel } from './Calendar.tsx';

describe('Up next labels (DESIGN §10.1)', () => {
  it('shows the first three names, then a count', () => {
    expect(namesLabel(['A', 'B'])).toBe('A, B');
    expect(namesLabel(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C +2');
  });

  it('shows a range today and "Tomorrow" otherwise, on a 24-hour clock', () => {
    const now = new Date(2026, 10, 18, 9, 0);
    expect(
      whenLabel(
        {
          startsAt: new Date(2026, 10, 18, 16, 0).toISOString(),
          endsAt: new Date(2026, 10, 18, 16, 30).toISOString(),
        },
        now,
      ),
    ).toBe('16:00–16:30');
    expect(
      whenLabel(
        {
          startsAt: new Date(2026, 10, 19, 9, 30).toISOString(),
          endsAt: new Date(2026, 10, 19, 9, 45).toISOString(),
        },
        now,
      ),
    ).toBe('Tomorrow 09:30');
  });
});
