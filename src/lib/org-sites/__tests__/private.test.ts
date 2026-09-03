import { describe, expect, it } from 'vitest';
import { MEMBERS_ONLY_MODULE_KEYS, isMembersOnly, publicSubpageKeys } from '../private';

describe('private clubs (V4)', () => {
  it('members-only modules on a private site; nothing on a public one', () => {
    for (const key of MEMBERS_ONLY_MODULE_KEYS) {
      expect(isMembersOnly({ visibility: 'private' }, key)).toBe(true);
      expect(isMembersOnly({ visibility: 'public' }, key)).toBe(false);
    }
    for (const key of ['hero', 'contact', 'courses', 'schedule', 'news', 'documents', 'register']) {
      expect(isMembersOnly({ visibility: 'private' }, key)).toBe(false);
    }
  });
  it('the sitemap keeps the public subpages only on a private site', () => {
    const keys = ['news', 'standings', 'schedule', 'teams', 'gallery', 'courses', 'leaders', 'divisions', 'documents'];
    expect(publicSubpageKeys('private', keys)).toEqual(['news', 'schedule', 'courses', 'documents']);
    expect(isMembersOnly({ visibility: 'private' }, 'staff')).toBe(true);
    expect(publicSubpageKeys('public', keys)).toEqual(keys);
  });
});
