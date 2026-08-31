import { describe, it, expect } from 'vitest';
import {
  validateEventInput,
  validateGuestInput,
  MAX_TITLE,
  MAX_GUESTS,
  MAX_EVENT_DAYS,
} from '../events';

const SELF = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

function validEvent(overrides: Record<string, unknown> = {}) {
  const starts = new Date(Date.now() + 86_400_000);
  const ends = new Date(starts.getTime() + 3_600_000);
  return {
    title: 'Team Practice',
    description: 'Bring both jerseys',
    location: 'Riverside Field',
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    all_day: false,
    timezone: 'America/New_York',
    category: 'practice',
    ...overrides,
  };
}

describe('validateEventInput scope linkage (119/146)', () => {
  it('accepts each scope column alone and normalizes the rest to null', () => {
    for (const key of ['league_id', 'club_id', 'division_id', 'team_id'] as const) {
      const result = validateEventInput(validEvent({ [key]: SELF }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event[key]).toBe(SELF);
        const others = (['league_id', 'club_id', 'division_id', 'team_id'] as const).filter(k => k !== key);
        for (const other of others) expect(result.event[other]).toBeNull();
      }
    }
  });

  it('rejects ANY two scopes together (one scope at most)', () => {
    expect(validateEventInput(validEvent({ league_id: SELF, club_id: OTHER })).ok).toBe(false);
    expect(validateEventInput(validEvent({ league_id: SELF, team_id: OTHER })).ok).toBe(false);
    expect(validateEventInput(validEvent({ division_id: SELF, team_id: OTHER })).ok).toBe(false);
  });

  it('rejects a malformed scope id', () => {
    expect(validateEventInput(validEvent({ division_id: 'not-a-uuid' })).ok).toBe(false);
    expect(validateEventInput(validEvent({ team_id: 'not-a-uuid' })).ok).toBe(false);
  });
});

describe('validateEventInput', () => {
  it('accepts and normalizes a valid event', () => {
    const result = validateEventInput(validEvent({ title: '  Team Practice  ', description: '  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.title).toBe('Team Practice');
      expect(result.event.description).toBeNull();
      expect(result.event.category).toBe('practice');
      expect(Date.parse(result.event.starts_at)).toBeLessThan(Date.parse(result.event.ends_at));
    }
  });

  it('requires a title and caps its length', () => {
    expect(validateEventInput(validEvent({ title: '' })).ok).toBe(false);
    expect(validateEventInput(validEvent({ title: 'x'.repeat(MAX_TITLE + 1) })).ok).toBe(false);
  });

  it('rejects bad or reversed times', () => {
    expect(validateEventInput(validEvent({ starts_at: 'nonsense' })).ok).toBe(false);
    const e = validEvent();
    expect(validateEventInput({ ...e, starts_at: e.ends_at, ends_at: e.starts_at }).ok).toBe(false);
    expect(validateEventInput({ ...e, ends_at: e.starts_at }).ok).toBe(false);
  });

  it('caps duration and distance from today', () => {
    const e = validEvent();
    const tooLong = new Date(Date.parse(e.starts_at) + (MAX_EVENT_DAYS + 1) * 86_400_000);
    expect(validateEventInput({ ...e, ends_at: tooLong.toISOString() }).ok).toBe(false);
    const farFuture = new Date(Date.now() + 6 * 365 * 86_400_000);
    expect(validateEventInput(validEvent({
      starts_at: farFuture.toISOString(),
      ends_at: new Date(farFuture.getTime() + 3_600_000).toISOString(),
    })).ok).toBe(false);
  });

  it('rejects invalid time zones', () => {
    expect(validateEventInput(validEvent({ timezone: 'Mars/Olympus' })).ok).toBe(false);
    expect(validateEventInput(validEvent({ timezone: '' })).ok).toBe(false);
  });

  it('all-day events must span local midnights in the event zone', () => {
    // Midnight in New York on 2026-07-30 is 04:00Z (EDT).
    const good = validateEventInput(validEvent({
      all_day: true,
      starts_at: '2026-07-30T04:00:00.000Z',
      ends_at: '2026-07-31T04:00:00.000Z',
      timezone: 'America/New_York',
    }));
    expect(good.ok).toBe(true);
    const bad = validateEventInput(validEvent({
      all_day: true,
      starts_at: '2026-07-30T00:00:00.000Z', // 8pm July 29 in NY — not midnight
      ends_at: '2026-07-31T00:00:00.000Z',
      timezone: 'America/New_York',
    }));
    expect(bad.ok).toBe(false);
  });

  it('rejects unknown categories', () => {
    expect(validateEventInput(validEvent({ category: 'party' })).ok).toBe(false);
  });
});

describe('validateGuestInput', () => {
  it('dedupes ids and lowercases emails', () => {
    const result = validateGuestInput(
      { profile_ids: [OTHER, OTHER], emails: ['A@B.co', 'a@b.co'] },
      SELF
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.guests.profileIds).toEqual([OTHER]);
      expect(result.guests.emails).toEqual(['a@b.co']);
    }
  });

  it('rejects inviting yourself, bad ids, and bad emails', () => {
    expect(validateGuestInput({ profile_ids: [SELF] }, SELF).ok).toBe(false);
    expect(validateGuestInput({ profile_ids: ['not-a-uuid'] }, SELF).ok).toBe(false);
    expect(validateGuestInput({ emails: ['nope'] }, SELF).ok).toBe(false);
  });

  it('enforces the combined guest cap including existing guests', () => {
    const emails = Array.from({ length: MAX_GUESTS + 1 }, (_, i) => `guest${i}@example.com`);
    expect(validateGuestInput({ emails }, SELF).ok).toBe(false);
    const okEmails = emails.slice(0, 10);
    expect(validateGuestInput({ emails: okEmails }, SELF, MAX_GUESTS - 5).ok).toBe(false);
    expect(validateGuestInput({ emails: okEmails }, SELF, MAX_GUESTS - 10).ok).toBe(true);
  });

  it('empty input is valid (guests optional)', () => {
    const result = validateGuestInput({}, SELF);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.guests.profileIds).toEqual([]);
  });
});
