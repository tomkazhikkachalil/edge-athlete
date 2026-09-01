import { describe, expect, it } from 'vitest';
import { formatEventWhen } from '../format';

describe('formatEventWhen', () => {
  it('renders a timed event in its own zone with the zone name', () => {
    const out = formatEventWhen({
      starts_at: '2026-09-12T22:30:00Z',
      all_day: false,
      timezone: 'America/New_York',
    });
    expect(out).toContain('Sep 12');
    expect(out).toContain('6:30');
    expect(out).toContain('EDT');
  });

  it('renders an all-day event as a date only', () => {
    const out = formatEventWhen({
      starts_at: '2026-09-12T00:00:00Z',
      all_day: true,
      timezone: 'UTC',
    });
    expect(out).toContain('Sep 12, 2026');
    expect(out).not.toMatch(/\d:\d\d/);
  });

  it('defaults a missing zone to UTC', () => {
    const out = formatEventWhen({
      starts_at: '2026-09-12T22:30:00Z',
      all_day: false,
      timezone: null,
    });
    expect(out).toContain('10:30');
    expect(out).toContain('UTC');
  });

  it('degrades an unknown zone to UTC instead of throwing', () => {
    const out = formatEventWhen({
      starts_at: '2026-09-12T22:30:00Z',
      all_day: false,
      timezone: 'Not/AZone',
    });
    expect(out).toContain('Sep 12');
    expect(out).toContain('UTC');
  });

  it('returns empty for an unparseable timestamp', () => {
    expect(
      formatEventWhen({ starts_at: 'garbage', all_day: false, timezone: 'UTC' })
    ).toBe('');
  });
});
