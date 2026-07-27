import { describe, it, expect } from 'vitest';
import {
  splitFullName,
  deriveNamesFromMetadata,
  deriveAvatarUrl,
} from '../oauth-profile';

describe('splitFullName', () => {
  it('splits a simple two-part name', () => {
    expect(splitFullName('Tom Kazhikkachalil')).toEqual({
      first: 'Tom',
      last: 'Kazhikkachalil',
    });
  });

  it('puts middle names into last', () => {
    expect(splitFullName('Mary Jane Watson Parker')).toEqual({
      first: 'Mary',
      last: 'Jane Watson Parker',
    });
  });

  it('handles a single word', () => {
    expect(splitFullName('Cher')).toEqual({ first: 'Cher', last: '' });
  });

  it('trims and collapses whitespace', () => {
    expect(splitFullName('  Tom   K  ')).toEqual({ first: 'Tom', last: 'K' });
  });

  it('handles empty input', () => {
    expect(splitFullName('')).toEqual({ first: '', last: '' });
  });
});

describe('deriveNamesFromMetadata', () => {
  it('prefers given_name/family_name (Google shape) over full_name', () => {
    expect(
      deriveNamesFromMetadata(
        { given_name: 'Tom', family_name: 'K', full_name: 'Wrong Name' },
        'x@y.com'
      )
    ).toEqual({ firstName: 'Tom', lastName: 'K' });
  });

  it('splits full_name when structured names are absent', () => {
    expect(
      deriveNamesFromMetadata({ full_name: 'Tom Kazhikkachalil' }, 'x@y.com')
    ).toEqual({ firstName: 'Tom', lastName: 'Kazhikkachalil' });
  });

  it('falls back to name when full_name is absent', () => {
    expect(deriveNamesFromMetadata({ name: 'Tom K' }, 'x@y.com')).toEqual({
      firstName: 'Tom',
      lastName: 'K',
    });
  });

  it('falls back to the email local part with empty metadata (Apple re-auth)', () => {
    expect(deriveNamesFromMetadata({}, 'tom.k@gmail.com')).toEqual({
      firstName: 'tom.k',
      lastName: '',
    });
  });

  it('returns empty strings when nothing is available', () => {
    expect(deriveNamesFromMetadata(null, null)).toEqual({
      firstName: '',
      lastName: '',
    });
    expect(deriveNamesFromMetadata(undefined, undefined)).toEqual({
      firstName: '',
      lastName: '',
    });
  });

  it('ignores whitespace-only full_name', () => {
    expect(deriveNamesFromMetadata({ full_name: '   ' }, 'a@b.com')).toEqual({
      firstName: 'a',
      lastName: '',
    });
  });
});

describe('deriveAvatarUrl', () => {
  it('prefers avatar_url over picture', () => {
    expect(
      deriveAvatarUrl({ avatar_url: 'https://a/x.png', picture: 'https://b/y.png' })
    ).toBe('https://a/x.png');
  });

  it('falls back to picture', () => {
    expect(deriveAvatarUrl({ picture: 'https://b/y.png' })).toBe('https://b/y.png');
  });

  it('returns null when neither exists', () => {
    expect(deriveAvatarUrl({})).toBeNull();
    expect(deriveAvatarUrl(null)).toBeNull();
  });
});
