import { describe, expect, it } from 'vitest';
import { startsOnFor } from '../rounds-server';

describe('startsOnFor — the one writer of starts_on', () => {
  it('is the earliest round, null with none', () => {
    expect(startsOnFor([{ scheduled_on: '2026-10-05' }, { scheduled_on: '2026-10-03' }])).toBe('2026-10-03');
    expect(startsOnFor([])).toBeNull();
  });
});
