import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_PREFS_KEY } from '../theme-storage-keys';

// The evaluator is a module singleton that touches window / document /
// fetch only inside try/catch, so it runs in node with three stubs: a
// localStorage (the device mirror — how these tests observe the prefs), a
// matchMedia, and fetch (the PATCH, resolved by hand).
//
// Two races, both found on Oct 1 2026 by a save held on the wire:
//   1. two saves overlapping — the OLDER one could arrive last and win;
//   2. the profile arriving mid-save — the server's not-yet-updated prefs
//      were adopted over the edit just made.

interface Pending { body: unknown; respond: (ok: boolean) => void }
let sent: Pending[] = [];
let store: Map<string, string>;

const mirror = () => JSON.parse(store.get(THEME_PREFS_KEY) ?? '{}');
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0)); // noon: the default schedule is light
  sent = [];
  store = new Map();
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    location: { protocol: 'http:' },
  });
  vi.stubGlobal('fetch', (_url: string, init: { body: string }) =>
    new Promise(resolve => {
      sent.push({ body: JSON.parse(init.body), respond: ok => resolve({ ok, status: ok ? 200 : 500 }) });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('saveThemePrefs — saves reach the server one at a time, in order', () => {
  it('a second save is not SENT until the first has answered', async () => {
    const { saveThemePrefs } = await import('../use-theme');
    const first = saveThemePrefs({ schedule: { start: 600, end: 700 } });
    const second = saveThemePrefs({ schedule: { start: 600, end: 800 } });
    await flush();
    // The device shows the latest edit at once…
    expect(mirror()).toEqual({ schedule: { start: 600, end: 800 } });
    // …but only the FIRST request is on the wire.
    expect(sent.map(s => s.body)).toEqual([{ schedule: { start: 600, end: 700 } }]);

    sent[0].respond(true);
    expect(await first).toBe(true);
    await flush();
    expect(sent.map(s => s.body)).toEqual([{ schedule: { start: 600, end: 700 } }, { schedule: { start: 600, end: 800 } }]);
    sent[1].respond(true);
    expect(await second).toBe(true);
    expect(mirror()).toEqual({ schedule: { start: 600, end: 800 } });
  });

  it('a failed save rolls back — unless a newer edit has been made since, which stands', async () => {
    const { saveThemePrefs } = await import('../use-theme');
    const alone = saveThemePrefs({ mode: 'on' });
    await flush();
    sent[0].respond(false);
    expect(await alone).toBe(false);
    expect(mirror()).toEqual({}); // back to what it was

    const older = saveThemePrefs({ mode: 'on' });
    const newer = saveThemePrefs({ mode: 'system' });
    await flush();
    sent[1].respond(false);
    expect(await older).toBe(false);
    expect(mirror()).toEqual({ mode: 'system' }); // the newer edit is NOT rolled back
    await flush();
    sent[2].respond(true);
    expect(await newer).toBe(true);
    expect(mirror()).toEqual({ mode: 'system' });
  });
});

describe('adoptServerThemePrefs — a server read never undoes an edit in flight', () => {
  it('adopts the account\'s prefs when nothing is being saved (the cross-device sync)', async () => {
    const { adoptServerThemePrefs } = await import('../use-theme');
    adoptServerThemePrefs({ mode: 'on' });
    expect(mirror()).toEqual({ mode: 'on' });
  });

  it('is ignored while a save is pending, and for a short grace after it settles', async () => {
    const { saveThemePrefs, adoptServerThemePrefs } = await import('../use-theme');
    const save = saveThemePrefs({ mode: 'scheduled', schedule: { start: 600, end: 700 } });
    await flush();

    // The profile arrives mid-save, carrying what the server still has.
    adoptServerThemePrefs({ mode: 'off' });
    expect(mirror()).toEqual({ mode: 'scheduled', schedule: { start: 600, end: 700 } });

    sent[0].respond(true);
    expect(await save).toBe(true);
    // A read that STARTED before the save can still land now.
    adoptServerThemePrefs({ mode: 'off' });
    expect(mirror()).toEqual({ mode: 'scheduled', schedule: { start: 600, end: 700 } });

    // Later loads adopt as before.
    vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 11));
    adoptServerThemePrefs({ mode: 'off' });
    expect(mirror()).toEqual({ mode: 'off' });
  });
});
