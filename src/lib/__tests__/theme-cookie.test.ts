import { describe, it, expect } from 'vitest';
import { encodeThemeCookie, decodeThemeCookie } from '../theme-cookie';
import { DEFAULT_SCHEDULE, type ThemePrefs } from '../theme-prefs';

describe('theme cookie encoding', () => {
  it('round-trips every prefs shape', () => {
    const shapes: ThemePrefs[] = [
      {},
      { mode: 'on' },
      { mode: 'off' },
      { mode: 'system' },
      { mode: 'scheduled', schedule: DEFAULT_SCHEDULE },
      { mode: 'scheduled', schedule: { start: 1290, end: 400 },
        override: { theme: 'light', setAt: '2026-08-06T01:00:00.000Z' } },
    ];
    for (const prefs of shapes) {
      expect(decodeThemeCookie(encodeThemeCookie(prefs))).toEqual(prefs);
    }
  });

  it('emits a cookie-safe value: no =, ;, or comma', () => {
    const value = encodeThemeCookie({
      mode: 'scheduled',
      schedule: { start: 1290, end: 400 },
      override: { theme: 'dark', setAt: '2026-08-06T01:02:03.456Z' },
    });
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('distinguishes ABSENT (null) from EMPTY prefs ({})', () => {
    // absent = no server truth, use the device mirror;
    // empty  = the account was read and has no preference, which must win.
    expect(decodeThemeCookie(undefined)).toBeNull();
    expect(decodeThemeCookie('')).toBeNull();
    expect(decodeThemeCookie(encodeThemeCookie({}))).toEqual({});
  });

  it('returns null for tampered or non-object payloads rather than throwing', () => {
    for (const raw of ['not!base64', 'YWJj', encodeThemeCookie({}).slice(0, 2), btoa('[1,2]'), btoa('"str"'), btoa('null')]) {
      expect(decodeThemeCookie(raw)).toBeNull();
    }
  });

  it('sanitizes what it decodes — a tampered cookie cannot inject junk', () => {
    const evil = btoa(JSON.stringify({ mode: 'chaos', schedule: { start: -5, end: 9999 }, evil: 'x' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeThemeCookie(evil)).toEqual({});
  });
});
