import { describe, expect, it } from 'vitest';
import { publicDisplayName, isPublicProfile, publicHandle, isDeparted } from '../public-names';

const base = {
  first_name: 'Casey',
  last_name: 'Zimmerman',
  full_name: 'Casey Zimmerman',
  visibility: 'public',
  email: 'casey@example.com',
  supervision_state: 'self', departed_at: null,
};

describe('publicDisplayName', () => {
  it('shows the full name for a public, claimed profile', () => {
    expect(publicDisplayName(base)).toBe('Casey Zimmerman');
  });

  it('masks a private profile to "First L."', () => {
    expect(publicDisplayName({ ...base, visibility: 'private' })).toBe('Casey Z.');
  });

  it('masks an unclaimed stub even when marked public', () => {
    expect(
      publicDisplayName({ ...base, email: 'abc123@stubs.invalid' })
    ).toBe('Casey Z.');
  });

  it('masks when visibility is null (never default-open)', () => {
    expect(publicDisplayName({ ...base, visibility: null })).toBe('Casey Z.');
  });

  it('handles a missing last name without a dangling initial', () => {
    expect(
      publicDisplayName({ ...base, visibility: 'private', last_name: null, full_name: null })
    ).toBe('Casey');
  });

  it('falls back to full_name parts when first/last are absent', () => {
    expect(
      publicDisplayName({
        first_name: null,
        last_name: null,
        full_name: 'Jordan Lee',
        visibility: 'private',
        email: null,
        supervision_state: null, departed_at: null,
      })
    ).toBe('Jordan');
  });

  it('falls back to full_name for a public profile with empty name columns', () => {
    expect(
      publicDisplayName({ ...base, first_name: null, last_name: null, full_name: 'Casey Zimmerman' })
    ).toBe('Casey Zimmerman');
  });

  it('masks a SUPERVISED profile even when a guardian set it public — the R4 gap', () => {
    expect(publicDisplayName({ ...base, supervision_state: 'supervised', departed_at: null })).toBe('Casey Z.');
  });

  it('shows the full name when supervision_state is null (legacy adult rows)', () => {
    expect(publicDisplayName({ ...base, supervision_state: null, departed_at: null })).toBe('Casey Zimmerman');
  });

  it('degrades to "Athlete" when nothing is available', () => {
    expect(
      publicDisplayName({
        first_name: null,
        last_name: null,
        full_name: null,
        visibility: null,
        email: null,
        supervision_state: null, departed_at: null,
      })
    ).toBe('Athlete');
  });
});

// Phase 8 P2 — the public-profile predicate and the linkable handle.
describe('isPublicProfile / publicHandle', () => {
  const base = { first_name: 'Alex', last_name: 'Adams', full_name: null, visibility: 'public', email: 'alex@example.com', supervision_state: null, departed_at: null };
  it('public + claimed + unsupervised → public; any miss → not', () => {
    expect(isPublicProfile(base)).toBe(true);
    expect(isPublicProfile({ ...base, visibility: 'private' })).toBe(false);
    expect(isPublicProfile({ ...base, email: 'x@stubs.invalid' })).toBe(false);
    expect(isPublicProfile({ ...base, supervision_state: 'supervised', departed_at: null })).toBe(false);
  });
  it('the handle links only for a public profile that has one', () => {
    expect(publicHandle({ ...base, handle: 'alex' })).toBe('alex');
    expect(publicHandle({ ...base, handle: null })).toBeNull();
    expect(publicHandle({ ...base })).toBeNull();
    expect(publicHandle({ ...base, visibility: 'private', handle: 'alex' })).toBeNull();
    expect(publicHandle({ ...base, supervision_state: 'supervised', departed_at: null, handle: 'alex' })).toBeNull();
  });
});

// Departed accounts (238, Sep 24 2026) — Tom: a departed person's results
// show the FULL name, "the way a printed results sheet would"; the row is
// never public, never linked.
describe('a departed tombstone', () => {
  const departed = { ...base, visibility: 'private', departed_at: '2026-09-24T12:00:00Z', email: 'x@departed.invalid' };

  it('shows the full name even though the tombstone is private', () => {
    expect(publicDisplayName(departed)).toBe('Casey Zimmerman');
    expect(publicDisplayName({ ...departed, visibility: null })).toBe('Casey Zimmerman');
  });

  it('falls back to full_name, then "Athlete"', () => {
    expect(publicDisplayName({ ...departed, first_name: null, last_name: null })).toBe('Casey Zimmerman');
    expect(publicDisplayName({ ...departed, first_name: null, last_name: null, full_name: null })).toBe('Athlete');
  });

  it('a masked minor tombstone reads "Athlete" (the engine renamed it)', () => {
    expect(publicDisplayName({ ...departed, first_name: 'Athlete', last_name: null, full_name: 'Athlete', supervision_state: 'supervised' })).toBe('Athlete');
  });

  it('is never a public profile and never links', () => {
    expect(isPublicProfile({ ...departed, visibility: 'public' })).toBe(false);
    expect(publicHandle({ ...departed, visibility: 'public', handle: 'casey' })).toBeNull();
  });

  it('isDeparted reads the stamp only', () => {
    expect(isDeparted(departed)).toBe(true);
    expect(isDeparted(base)).toBe(false);
    expect(isDeparted({ departed_at: '' })).toBe(false);
    expect(isDeparted({})).toBe(false);
  });
});
