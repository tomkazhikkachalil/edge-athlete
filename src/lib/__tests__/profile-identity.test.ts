import { describe, it, expect } from 'vitest';
import { diffIdentityFields, describeIdentityFields } from '../profile-identity';

describe('diffIdentityFields', () => {
  it('empty payload → no changes', () => {
    expect(diffIdentityFields({ bio: 'old' }, {})).toEqual([]);
  });

  it('changed fields are reported, unchanged ones are not', () => {
    expect(
      diffIdentityFields(
        { bio: 'old bio', location: 'Toronto', first_name: 'Emma' },
        { bio: 'new bio', location: 'Toronto', first_name: 'Emma' }
      )
    ).toEqual(['bio']);
  });

  it('fields absent from the payload are untouched even if old has values', () => {
    expect(diffIdentityFields({ bio: 'something' }, { location: 'Ottawa' })).toEqual(['location']);
  });

  it('null vs empty string vs undefined never reads as a change', () => {
    expect(diffIdentityFields({ bio: null }, { bio: '' })).toEqual([]);
    expect(diffIdentityFields({ bio: '' }, { bio: null })).toEqual([]);
    expect(diffIdentityFields({}, { bio: null })).toEqual([]);
  });

  it('null → value and value → null both count', () => {
    expect(diffIdentityFields({ bio: null }, { bio: 'hello' })).toEqual(['bio']);
    expect(diffIdentityFields({ bio: 'hello' }, { bio: null })).toEqual(['bio']);
  });

  it('non-identity fields in the payload are ignored', () => {
    expect(diffIdentityFields({}, { visibility: 'public', height_cm: 150 })).toEqual([]);
  });

  it('order is stable (IDENTITY_FIELDS order, not payload order)', () => {
    expect(
      diffIdentityFields({}, { social_tiktok: 'x', bio: 'b', first_name: 'a' })
    ).toEqual(['first_name', 'bio', 'social_tiktok']);
  });
});

describe('describeIdentityFields', () => {
  it('collapses the name parts and social platforms into one label each', () => {
    expect(describeIdentityFields(['first_name', 'last_name'])).toBe('name');
    expect(describeIdentityFields(['social_twitter', 'social_tiktok'])).toBe('social links');
  });

  it('joins with commas and a final "and"', () => {
    expect(describeIdentityFields(['first_name', 'bio', 'location'])).toBe(
      'name, bio and location'
    );
  });

  it('empty → empty string', () => {
    expect(describeIdentityFields([])).toBe('');
  });
});
