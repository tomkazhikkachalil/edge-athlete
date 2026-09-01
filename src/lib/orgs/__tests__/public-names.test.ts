import { describe, expect, it } from 'vitest';
import { publicDisplayName } from '../public-names';

const base = {
  first_name: 'Casey',
  last_name: 'Zimmerman',
  full_name: 'Casey Zimmerman',
  visibility: 'public',
  email: 'casey@example.com',
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
      })
    ).toBe('Jordan');
  });

  it('falls back to full_name for a public profile with empty name columns', () => {
    expect(
      publicDisplayName({ ...base, first_name: null, last_name: null, full_name: 'Casey Zimmerman' })
    ).toBe('Casey Zimmerman');
  });

  it('degrades to "Athlete" when nothing is available', () => {
    expect(
      publicDisplayName({
        first_name: null,
        last_name: null,
        full_name: null,
        visibility: null,
        email: null,
      })
    ).toBe('Athlete');
  });
});
