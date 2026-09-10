import { describe, expect, it } from 'vitest';
import { MEMBERS_ONLY_MODULE_KEYS } from '@/lib/org-sites/private';
import { effectiveAudience, moduleEnabled } from '../audience';
import { WEB_WIDGET_KEYS, WIDGETS } from '../catalog';
import { place } from '../seeds';

// Hardening H1: the ONE audience rule every renderer asks at render time.
// The stored visibility is a floor (an instance can be narrower than the
// org policy) never a ceiling (the org's privacy always applies).

const PUBLIC = { visibility: 'public' as const };
const PRIVATE = { visibility: 'private' as const };

describe('effectiveAudience', () => {
  it('a public club: the stored value, verbatim', () => {
    expect(effectiveAudience(PUBLIC, place('standings', 0, 0))).toBe('public');
    expect(effectiveAudience(PUBLIC, place('standings', 0, 0, undefined, { visibility: 'members' }))).toBe('members');
    expect(effectiveAudience(PUBLIC, place('news', 0, 0, undefined, { visibility: 'staff' }))).toBe('staff');
  });

  it('a private club: every members-only module narrows to members even when the instance says public; other modules and content stay public; staff stays staff', () => {
    for (const key of WEB_WIDGET_KEYS) {
      const expected = (MEMBERS_ONLY_MODULE_KEYS as readonly string[]).includes(key) ? 'members' : 'public';
      expect(effectiveAudience(PRIVATE, place(key, 0, 0)), key).toBe(expected);
    }
    expect(effectiveAudience(PRIVATE, place('text', 0, 0))).toBe('public');
    expect(effectiveAudience(PRIVATE, place('standings', 0, 0, undefined, { visibility: 'staff' }))).toBe('staff');
  });
});

describe('moduleEnabled', () => {
  const site = { modules: [{ module_key: 'standings', enabled: true }, { module_key: 'news', enabled: false }] };
  it('a module-backed widget needs an ENABLED row; a content widget never does; a missing row is off', () => {
    expect(moduleEnabled(site, 'standings')).toBe(true);
    expect(moduleEnabled(site, 'news')).toBe(false);
    expect(moduleEnabled(site, 'teams')).toBe(false);
    expect(moduleEnabled(site, 'text')).toBe(true);
    expect(moduleEnabled(site, 'image')).toBe(true);
    expect(moduleEnabled(site, 'embed')).toBe(true);
    expect(WIDGETS.text.moduleKey).toBeNull();
  });
});
