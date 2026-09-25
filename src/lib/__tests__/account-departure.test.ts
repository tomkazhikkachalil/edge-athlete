import { describe, it, expect } from 'vitest';
import {
  DEPARTED_EMAIL_DOMAIN,
  DEPARTED_KEEP_COLUMNS,
  DEPARTED_NULL_COLUMNS,
  DEPARTED_SET_COLUMNS,
  MASKED_NAME,
  NO_TIES,
  departedEmailFor,
  departedProfilePatch,
  departureMode,
  hasTies,
  isDepartedEmail,
  type TiedCounts,
} from '../account-departure';
import { tableColumns } from './helpers/live-schema';

// Departed accounts (migration 238, Sep 24 2026): the mode decision and the
// strip, pinned. Tom's decisions: an adult with results others depend on
// stays under the FULL name; a supervised athlete stays as "Athlete" only
// when the guardian signed a consent version that says so (v3 onward) — a
// v2 signature promised erasure and keeps it; anyone with nothing tied is
// erased as before.

const ADULT = { email: 'a@example.com', supervision_state: 'self' };
const MINOR = { email: 'x@minors.invalid', supervision_state: 'supervised' };
const STUB = { email: 'pending-1@stubs.invalid', supervision_state: 'supervised' };
const ONE_ENTRY: TiedCounts = { ...NO_TIES, entries: 1 };

describe('departureMode', () => {
  it('an adult with nothing tied is erased', () => {
    expect(departureMode(ADULT, NO_TIES, null)).toBe('erase');
  });

  it('an adult with ANY tied row becomes a tombstone', () => {
    for (const k of Object.keys(NO_TIES) as Array<keyof TiedCounts>) {
      expect(departureMode(ADULT, { ...NO_TIES, [k]: 1 }, null), k).toBe('tombstone');
    }
  });

  it('a v2-consented minor is erased even with results (the signed promise)', () => {
    expect(departureMode(MINOR, ONE_ENTRY, 'minors-consent-v2')).toBe('erase');
  });

  it('a v3-consented minor with results is masked', () => {
    expect(departureMode(MINOR, ONE_ENTRY, 'minors-consent-v3')).toBe('masked');
  });

  it('a minor with an unknown or missing consent version keeps the stricter promise', () => {
    expect(departureMode(MINOR, ONE_ENTRY, null)).toBe('erase');
    expect(departureMode(MINOR, ONE_ENTRY, 'v1')).toBe('erase');
  });

  it('a v3 minor with nothing tied is erased', () => {
    expect(departureMode(MINOR, NO_TIES, 'minors-consent-v3')).toBe('erase');
  });

  it('a roster stub is always erased (it is already name-only)', () => {
    expect(departureMode(STUB, ONE_ENTRY, 'minors-consent-v3')).toBe('erase');
    expect(departureMode({ ...STUB, supervision_state: 'self' }, ONE_ENTRY, null)).toBe('erase');
  });

  it('hasTies is any non-zero count', () => {
    expect(hasTies(NO_TIES)).toBe(false);
    expect(hasTies({ ...NO_TIES, cardsOnOthersRounds: 2 })).toBe(true);
  });
});

describe('the departed email', () => {
  it('is the reserved unroutable domain', () => {
    expect(departedEmailFor('abc')).toBe(`abc@${DEPARTED_EMAIL_DOMAIN}`);
    expect(isDepartedEmail('ABC@DEPARTED.INVALID')).toBe(true);
    expect(isDepartedEmail('a@stubs.invalid')).toBe(false);
    expect(isDepartedEmail(null)).toBe(false);
  });
});

describe('departedProfilePatch', () => {
  const now = new Date('2026-09-24T12:00:00Z');

  it('a tombstone keeps the name and sets the fixed columns', () => {
    const p = departedProfilePatch('id-1', 'tombstone', now);
    expect(p.departed_at).toBe('2026-09-24T12:00:00.000Z');
    expect(p.email).toBe('id-1@departed.invalid');
    expect(p.visibility).toBe('private');
    expect(p.messaging_permission).toBe('nobody');
    expect(p.recruiting_status).toBe('closed');
    expect(p.deletion_requested_at).toBeNull();
    for (const c of ['first_name', 'last_name', 'full_name', 'display_name', 'middle_name']) {
      expect(c in p, c).toBe(false);
    }
  });

  it('nulls exactly the personal columns — the handle is released', () => {
    const p = departedProfilePatch('id-1', 'tombstone', now);
    for (const c of DEPARTED_NULL_COLUMNS) expect(p[c], c).toBeNull();
    expect(p.handle).toBeNull();
    const written = Object.keys(p).sort();
    expect(written).toEqual([...DEPARTED_SET_COLUMNS, ...DEPARTED_NULL_COLUMNS].sort());
  });

  it('a masked tombstone is renamed "Athlete" everywhere a name lives', () => {
    const p = departedProfilePatch('id-1', 'masked', now);
    expect(p.first_name).toBe(MASKED_NAME);
    expect(p.full_name).toBe(MASKED_NAME);
    expect(p.display_name).toBe(MASKED_NAME);
    expect(p.last_name).toBeNull();
    expect(p.middle_name).toBeNull();
  });

  it('never writes a column the profiles table does not have', () => {
    const live = new Set(tableColumns('profiles'));
    for (const c of Object.keys(departedProfilePatch('id-1', 'masked', now))) expect(live.has(c), c).toBe(true);
  });
});

describe('the strip covers every profiles column', () => {
  // A column added to profiles later must be classified here: kept, set or
  // nulled. An unclassified column would survive on a tombstone unseen —
  // a personal field left behind after the person asked to go.
  it('KEEP ∪ SET ∪ NULL is exactly the live column set', () => {
    const live = tableColumns('profiles');
    const classified = [...DEPARTED_KEEP_COLUMNS, ...DEPARTED_SET_COLUMNS, ...DEPARTED_NULL_COLUMNS];
    expect(new Set(classified).size).toBe(classified.length); // no column in two lists
    expect([...classified].sort()).toEqual(live);
  });
});
