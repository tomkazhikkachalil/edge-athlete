import { describe, it, expect } from 'vitest';
import { THEME_INIT_SCRIPT } from '../theme-script';
import { THEME_PREFS_KEY } from '../theme-storage-keys';
import { resolveTheme, sanitizeThemePrefs, type ResolvedTheme } from '../theme-prefs';

/**
 * THEME_INIT_SCRIPT duplicates resolveTheme() in inline ES5 so first paint
 * can resolve the theme before React loads. This suite pins the two
 * implementations together: the script is executed via new Function with
 * stubbed globals (node-only — no jsdom needed, the script touches exactly
 * localStorage, window.matchMedia, document.documentElement.dataset and
 * Date) and must agree with resolveTheme across the whole matrix.
 */

// The script calls bare `new Date()`; shadowing the Date parameter with this
// class freezes "now" without touching real timers.
function makeFrozenDate(fixedNow: Date): DateConstructor {
  return class extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixedNow.getTime());
      else super(...(args as [number]));
    }
  } as DateConstructor;
}

function runScript(stored: string | null, now: Date, systemPrefersDark: boolean): ResolvedTheme {
  const documentStub = { documentElement: { dataset: {} as Record<string, string> } };
  const localStorageStub = {
    getItem: (key: string) => (key === THEME_PREFS_KEY ? stored : null),
  };
  const windowStub = {
    matchMedia: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && systemPrefersDark,
    }),
  };
  new Function('localStorage', 'window', 'document', 'Date', THEME_INIT_SCRIPT)(
    localStorageStub,
    windowStub,
    documentStub,
    makeFrozenDate(now)
  );
  return documentStub.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const aug5 = (h: number, m = 0) => new Date(2026, 7, 5, h, m);
const aug6 = (h: number, m = 0) => new Date(2026, 7, 6, h, m);

describe('THEME_INIT_SCRIPT agrees with resolveTheme', () => {
  const overnight = { start: 1200, end: 420 };
  const daytime = { start: 540, end: 1020 };

  // Every stored payload the mirror can legally contain (it writes only
  // sanitized prefs), across times chosen to hit both sides of every window
  // and both fates of an override.
  const cases: Array<{ name: string; prefs: unknown; now: Date; sys: boolean }> = [
    { name: 'no prefs at night', prefs: {}, now: aug5(23), sys: true },
    { name: 'off at night', prefs: { mode: 'off' }, now: aug5(23), sys: true },
    { name: 'on at noon', prefs: { mode: 'on' }, now: aug5(12), sys: false },
    { name: 'system, OS dark', prefs: { mode: 'system' }, now: aug5(12), sys: true },
    { name: 'system, OS light', prefs: { mode: 'system' }, now: aug5(23), sys: false },
    { name: 'scheduled default, evening', prefs: { mode: 'scheduled' }, now: aug5(23), sys: false },
    { name: 'scheduled default, after midnight', prefs: { mode: 'scheduled' }, now: aug6(3), sys: false },
    { name: 'scheduled default, noon', prefs: { mode: 'scheduled' }, now: aug5(12), sys: false },
    { name: 'scheduled default, start boundary', prefs: { mode: 'scheduled' }, now: aug5(20), sys: false },
    { name: 'scheduled default, end boundary', prefs: { mode: 'scheduled' }, now: aug6(7), sys: false },
    {
      name: 'scheduled custom same-day window, inside',
      prefs: { mode: 'scheduled', schedule: daytime },
      now: aug5(10),
      sys: false,
    },
    {
      name: 'scheduled custom same-day window, outside',
      prefs: { mode: 'scheduled', schedule: daytime },
      now: aug5(18),
      sys: false,
    },
    {
      name: 'override to light, still active late evening',
      prefs: {
        mode: 'scheduled',
        schedule: overnight,
        override: { theme: 'light', setAt: aug5(21).toISOString() },
      },
      now: aug5(23, 59),
      sys: false,
    },
    {
      name: 'override to light, still active pre-dawn',
      prefs: {
        mode: 'scheduled',
        schedule: overnight,
        override: { theme: 'light', setAt: aug5(21).toISOString() },
      },
      now: aug6(6, 59),
      sys: false,
    },
    {
      name: 'override expired at the end boundary',
      prefs: {
        mode: 'scheduled',
        schedule: overnight,
        override: { theme: 'light', setAt: aug5(21).toISOString() },
      },
      now: aug6(7),
      sys: false,
    },
    {
      name: 'override expired, next evening resumes dark',
      prefs: {
        mode: 'scheduled',
        schedule: overnight,
        override: { theme: 'light', setAt: aug5(21).toISOString() },
      },
      now: aug6(21),
      sys: false,
    },
    {
      name: 'daytime override to dark, active before window',
      prefs: {
        mode: 'scheduled',
        schedule: overnight,
        override: { theme: 'dark', setAt: aug5(14).toISOString() },
      },
      now: aug5(19, 59),
      sys: false,
    },
    {
      name: 'daytime override to dark, expired at window start',
      prefs: {
        mode: 'scheduled',
        schedule: overnight,
        override: { theme: 'dark', setAt: aug5(14).toISOString() },
      },
      now: aug5(20),
      sys: false,
    },
  ];

  for (const { name, prefs, now, sys } of cases) {
    it(name, () => {
      const sanitized = sanitizeThemePrefs(prefs);
      // The mirror only ever stores sanitized prefs — assert the case IS
      // its own sanitized form, so the equivalence claim stays honest.
      expect(sanitized).toEqual(prefs);
      expect(runScript(JSON.stringify(sanitized), now, sys)).toBe(
        resolveTheme(sanitized, now, sys)
      );
    });
  }

  it('falls back to light on missing key, garbage JSON, and throwing storage', () => {
    expect(runScript(null, aug5(23), true)).toBe('light');
    expect(runScript('{not json', aug5(23), true)).toBe('light');
    expect(runScript('"a string"', aug5(23), true)).toBe('light');
    expect(runScript(JSON.stringify([1, 2]), aug5(23), true)).toBe('light');

    const documentStub = { documentElement: { dataset: {} as Record<string, string> } };
    new Function('localStorage', 'window', 'document', 'Date', THEME_INIT_SCRIPT)(
      { getItem: () => { throw new Error('storage disabled'); } },
      { matchMedia: () => ({ matches: true }) },
      documentStub,
      makeFrozenDate(aug5(23))
    );
    expect(documentStub.documentElement.dataset.theme).toBeUndefined();
  });
});
