import { describe, it, expect } from 'vitest';
import { THEME_INIT_SCRIPT } from '../theme-script';
import { THEME_PREFS_KEY } from '../theme-storage-keys';
import { THEME_COOKIE, THEME_RESOLVED_COOKIE, encodeThemeCookie } from '../theme-cookie';
import { THEME_COLOR } from '../theme-colors';
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

interface RunResult {
  theme: ResolvedTheme;
  /** What the script left in the localStorage mirror. */
  mirror: string | null;
  /** What it wrote into the theme-color metas (browser chrome). */
  metaColors: string[];
  /** Every document.cookie assignment the script made. */
  cookieWrites: string[];
}

interface MetaStub {
  content: string;
  setAttribute(name: string, value: string): void;
}

/** Stand-ins for the two media-scoped metas Next renders. */
function makeMetaStubs(): MetaStub[] {
  return [THEME_COLOR.light, THEME_COLOR.dark].map((initial): MetaStub => ({
    content: initial,
    setAttribute(_name, value) {
      this.content = value;
    },
  }));
}

function run(opts: {
  stored?: string | null;
  cookie?: string | null;
  now: Date;
  systemPrefersDark?: boolean;
}): RunResult {
  const metas = makeMetaStubs();
  const written: string[] = [];
  const documentStub = {
    // Reads return the prefs cookie; writes are captured, mirroring how a
    // real document.cookie setter appends rather than replaces.
    get cookie() {
      return opts.cookie ? `${THEME_COOKIE}=${opts.cookie}` : '';
    },
    set cookie(value: string) {
      written.push(value);
    },
    documentElement: { dataset: {} as Record<string, string | undefined> },
    querySelectorAll: () => metas,
  };
  let mirror = opts.stored ?? null;
  const localStorageStub = {
    getItem: (key: string) => (key === THEME_PREFS_KEY ? mirror : null),
    setItem: (key: string, value: string) => {
      if (key === THEME_PREFS_KEY) mirror = value;
    },
  };
  const windowStub = {
    matchMedia: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && (opts.systemPrefersDark ?? false),
    }),
    location: { protocol: 'http:' },
  };
  new Function('localStorage', 'window', 'document', 'Date', 'atob', THEME_INIT_SCRIPT)(
    localStorageStub,
    windowStub,
    documentStub,
    makeFrozenDate(opts.now),
    (b64: string) => Buffer.from(b64, 'base64').toString('binary')
  );
  return {
    theme: documentStub.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    mirror,
    metaColors: metas.map(m => m.content),
    cookieWrites: written,
  };
}

function runScript(stored: string | null, now: Date, systemPrefersDark: boolean): ResolvedTheme {
  return run({ stored, now, systemPrefersDark }).theme;
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

  it('runs the same matrix from the COOKIE, ignoring the mirror entirely', () => {
    // The stale mirror says "always dark"; the cookie is server truth and must
    // win outright — this is the swap-removal contract.
    const staleMirror = JSON.stringify({ mode: 'on' });
    for (const { name, prefs, now, sys } of cases) {
      const sanitized = sanitizeThemePrefs(prefs);
      const { theme, mirror } = run({
        stored: staleMirror,
        cookie: encodeThemeCookie(sanitized),
        now,
        systemPrefersDark: sys,
      });
      expect(theme, name).toBe(resolveTheme(sanitized, now, sys));
      // and the cookie's value is written back, so the runtime evaluator
      // starts from server truth and has nothing to correct
      expect(JSON.parse(mirror as string), name).toEqual(sanitized);
    }
  });

  it('points the browser-chrome metas at the resolved theme, not the OS', () => {
    // Both metas get the SAME colour: Next renders them scoped to
    // prefers-color-scheme, which browsers match against the OS, so leaving
    // one alone would let a light-OS phone keep a violet bar on a dark app.
    const dark = run({ cookie: encodeThemeCookie({ mode: 'on' }), now: aug5(12) });
    expect(dark.theme).toBe('dark');
    expect(dark.metaColors).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);

    const light = run({ cookie: encodeThemeCookie({ mode: 'off' }), now: aug5(23) });
    expect(light.theme).toBe('light');
    expect(light.metaColors).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });

  it('publishes the resolved theme as a cookie for the web manifest', () => {
    // The manifest is read by the OS outside the page, so a cookie is the
    // only channel that can carry the resolved theme to its splash colour.
    const dark = run({ cookie: encodeThemeCookie({ mode: 'on' }), now: aug5(12) });
    const darkWrite = dark.cookieWrites.find(c => c.startsWith(`${THEME_RESOLVED_COOKIE}=`));
    expect(darkWrite).toBeDefined();
    expect(darkWrite).toContain(`${THEME_RESOLVED_COOKIE}=dark`);
    expect(darkWrite).toContain('Path=/');
    expect(darkWrite).toContain('SameSite=Lax');

    const light = run({ cookie: encodeThemeCookie({ mode: 'off' }), now: aug5(23) });
    expect(light.cookieWrites.find(c => c.startsWith(`${THEME_RESOLVED_COOKIE}=`)))
      .toContain(`${THEME_RESOLVED_COOKIE}=light`);
  });

  it('falls back to the mirror when the cookie is absent or corrupt', () => {
    const darkMirror = JSON.stringify({ mode: 'on' });
    expect(run({ stored: darkMirror, cookie: null, now: aug5(12) }).theme).toBe('dark');
    expect(run({ stored: darkMirror, cookie: 'not!base64', now: aug5(12) }).theme).toBe('dark');
    // valid base64, truncated JSON inside — the parse throws, so the mirror stands
    const truncated = btoa('{"mode":"o').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(run({ stored: darkMirror, cookie: truncated, now: aug5(12) }).theme).toBe('dark');
    // An EMPTY cookie is server truth meaning "no preference" — it must beat a
    // stale dark mirror rather than being treated as absent.
    expect(run({ stored: darkMirror, cookie: encodeThemeCookie({}), now: aug5(12) }).theme).toBe('light');
  });

  it('clears a previously-stamped attribute when it resolves to light', () => {
    const documentStub = {
      cookie: `${THEME_COOKIE}=${encodeThemeCookie({ mode: 'off' })}`,
      documentElement: { dataset: { theme: 'dark' } as Record<string, string | undefined> },
      querySelectorAll: () => makeMetaStubs(),
    };
    new Function('localStorage', 'window', 'document', 'Date', 'atob', THEME_INIT_SCRIPT)(
      { getItem: () => null, setItem: () => {} },
      { matchMedia: () => ({ matches: false }), location: { protocol: 'http:' } },
      documentStub,
      makeFrozenDate(aug5(12)),
      (b64: string) => Buffer.from(b64, 'base64').toString('binary')
    );
    expect(documentStub.documentElement.dataset.theme).toBeUndefined();
  });

  it('falls back to light on missing key, garbage JSON, and throwing storage', () => {
    expect(runScript(null, aug5(23), true)).toBe('light');
    expect(runScript('{not json', aug5(23), true)).toBe('light');
    expect(runScript('"a string"', aug5(23), true)).toBe('light');
    expect(runScript(JSON.stringify([1, 2]), aug5(23), true)).toBe('light');

    const documentStub = { cookie: '', documentElement: { dataset: {} as Record<string, string | undefined> }, querySelectorAll: () => makeMetaStubs() };
    new Function('localStorage', 'window', 'document', 'Date', 'atob', THEME_INIT_SCRIPT)(
      { getItem: () => { throw new Error('storage disabled'); }, setItem: () => {} },
      { matchMedia: () => ({ matches: true }), location: { protocol: 'http:' } },
      documentStub,
      makeFrozenDate(aug5(23)),
      (b64: string) => Buffer.from(b64, 'base64').toString('binary')
    );
    expect(documentStub.documentElement.dataset.theme).toBeUndefined();
  });
});
