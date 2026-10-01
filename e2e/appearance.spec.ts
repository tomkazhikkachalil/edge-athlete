import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { adminClient, createQaUser, deleteQaUser, mintStorageState, type QaUser } from './helpers/qa-user';

// Appearance: the schedule works and is the default (Oct 1 2026).
//
// Reported on production: Light and Dark worked; Scheduled and Match system
// "did nothing". Both saved — but Settings was only told to redraw when the
// RESOLVED theme flipped, so picked in the daytime (or on a matching device)
// the option never showed as selected and the hours never appeared. And a
// time field saved on every change and was disabled while saving, so typing
// lost focus after one digit.
//
// The rules pinned here: nothing stored = the schedule (dark 6 PM – 9 AM by
// the device's clock); a choice shows as selected even when the theme does
// not move; the hours can be typed; the top-menu switch PINS the theme and
// the hours come back when Schedule is chosen again.
//
// NO fake clock: a shifted Date makes the Supabase client think its session
// expired. The default is asserted against the real hour, and both sides of a
// window are reached by moving the HOURS around now instead. Its own user —
// the shared QA users are pinned to light (helpers/qa-user.ts QA_THEME_PREFS).

let user: QaUser | null = null;
let state: Awaited<ReturnType<typeof mintStorageState>> | null = null;

test.beforeAll(async () => {
  user = await createQaUser({ displayName: 'Edge QA Theme', firstName: 'Edge', lastName: 'Theme', themePrefs: null });
  state = await mintStorageState(user);
});

test.afterAll(async () => {
  if (user) await deleteQaUser(user.id);
});

const DAY = 1440;
const DEFAULT = { start: 18 * 60, end: 9 * 60 };
const inWindow = (s: { start: number; end: number }, m: number) =>
  s.start <= s.end ? m >= s.start && m < s.end : m >= s.start || m < s.end;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** A window that contains `now` with 90 minutes to spare each side, and one that starts two hours ahead. */
const around = (now: number) => ({ start: (now - 90 + DAY) % DAY, end: (now + 90) % DAY });
const ahead = (now: number) => ({ start: (now + 120) % DAY, end: (now + 240) % DAY });

async function open(browser: Browser, opts: { colorScheme?: 'light' | 'dark' } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: state!, colorScheme: opts.colorScheme ?? 'light' });
  return { ctx, page: await ctx.newPage() };
}
const setPrefs = async (prefs: Record<string, unknown> | null) => {
  const { error } = await adminClient().from('profiles').update({ theme_prefs: prefs }).eq('id', user!.id);
  if (error) throw new Error(`appearance: could not set theme_prefs: ${error.message}`);
};
const storedPrefs = async () =>
  (await adminClient().from('profiles').select('theme_prefs').eq('id', user!.id).single()).data?.theme_prefs as Record<string, unknown> | null;
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'light');
const minutesNow = (page: Page) => page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
const option = (page: Page, label: string) =>
  page.locator('button[aria-pressed]').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
const startField = (page: Page) => page.getByLabel('Dark from');
const endField = (page: Page) => page.getByLabel('Until');

test('nothing stored is the schedule: dark 6 PM – 9 AM by the device clock, and Settings shows it @mobile', async ({ browser }) => {
  await setPrefs(null);
  const { ctx, page } = await open(browser);
  try {
    await page.goto('/settings?tab=appearance');
    await expect(option(page, 'Schedule')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    for (const other of ['Light', 'Dark', 'Match system']) {
      await expect(option(page, other)).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(startField(page)).toHaveValue('18:00');
    await expect(endField(page)).toHaveValue('09:00');
    await expect(page.getByTestId('schedule-summary')).toHaveText('Dark from 6:00 PM to 9:00 AM, across midnight.');

    const now = await minutesNow(page);
    // Within a minute of 6 PM / 9 AM the page and this read can straddle the change.
    test.skip([DEFAULT.start, DEFAULT.end].some(b => Math.abs(now - b) <= 1), 'on a schedule boundary');
    expect(await theme(page)).toBe(inWindow(DEFAULT, now) ? 'dark' : 'light');
  } finally {
    await ctx.close();
  }
});

test('the hours can be typed: one save, the field keeps focus, and the theme follows both ways @mobile', async ({ browser }) => {
  await setPrefs(null);
  const { ctx, page } = await open(browser);
  try {
    await page.goto('/settings?tab=appearance');
    await expect(startField(page)).toHaveValue('18:00', { timeout: 20_000 });
    const now = await minutesNow(page);

    // A window around now → dark. The start field is typed and NOT left: the
    // save comes a moment after the last change, and focus stays in the field
    // (it used to be disabled mid-save, which dropped focus after one digit).
    const dark = around(now);
    // Leaving the first field commits it against the OTHER field's stored
    // hour; fill the end first unless that would momentarily equal 18:00.
    if (dark.end !== DEFAULT.start) {
      await endField(page).fill(hhmm(dark.end));
      await startField(page).fill(hhmm(dark.start));
    } else {
      await startField(page).fill(hhmm(dark.start));
      await startField(page).blur();
      await expect.poll(storedPrefs, { timeout: 20_000 }).toEqual({ schedule: { start: dark.start, end: DEFAULT.end } });
      await endField(page).fill(hhmm(dark.end));
      await startField(page).focus();
    }
    await expect.poll(storedPrefs, { timeout: 20_000 }).toEqual({ schedule: dark });
    await expect(startField(page)).toBeFocused();
    await expect.poll(() => theme(page), { timeout: 10_000 }).toBe('dark');
    await expect(option(page, 'Schedule')).toHaveAttribute('aria-pressed', 'true');

    // A window two hours ahead → light, committed by leaving the field.
    const light = ahead(now);
    await startField(page).fill(hhmm(light.start));
    await endField(page).fill(hhmm(light.end));
    await endField(page).blur();
    await expect.poll(storedPrefs, { timeout: 20_000 }).toEqual({ schedule: light });
    await expect.poll(() => theme(page), { timeout: 10_000 }).toBe('light');

    // The same hours twice is refused, and the stored hours show again.
    await startField(page).fill(hhmm(light.end));
    await startField(page).blur();
    await expect(page.getByText('Start and end times must differ')).toBeVisible();
    await expect(startField(page)).toHaveValue(hhmm(light.start));
    expect(await storedPrefs()).toEqual({ schedule: light });
  } finally {
    await ctx.close();
  }
});

test('a choice shows as selected even when the theme does not move — Match system and Schedule @mobile', async ({ browser }) => {
  const { ctx, page } = await open(browser, { colorScheme: 'light' });
  try {
    // Pinned light, with hours that do not contain now.
    await page.goto('/settings?tab=appearance');
    const now = await minutesNow(page);
    const hours = ahead(now);
    await setPrefs({ mode: 'off', schedule: hours });
    await page.reload();
    await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    await expect(startField(page)).toBeHidden();

    // Match system on a light device: the theme stays light. This is the
    // reported bug — the option must show as selected anyway.
    await option(page, 'Match system').click();
    await expect(option(page, 'Match system')).toHaveAttribute('aria-pressed', 'true');
    await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(storedPrefs, { timeout: 20_000 }).toEqual({ mode: 'system', schedule: hours });
    expect(await theme(page)).toBe('light');
    // …and it really follows the device, live.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => theme(page), { timeout: 10_000 }).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(page), { timeout: 10_000 }).toBe('light');

    // Schedule, outside its window: light before and after — selected, and
    // the hours appear, the SAME hours that rode along under the pin.
    await option(page, 'Schedule').click();
    await expect(option(page, 'Schedule')).toHaveAttribute('aria-pressed', 'true');
    await expect(startField(page)).toHaveValue(hhmm(hours.start));
    await expect(endField(page)).toHaveValue(hhmm(hours.end));
    await expect.poll(storedPrefs, { timeout: 20_000 }).toEqual({ mode: 'scheduled', schedule: hours });
    expect(await theme(page)).toBe('light');
  } finally {
    await ctx.close();
  }
});

test('the top-menu switch pins the theme and turns the schedule off; Schedule brings the hours back @mobile', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  try {
    await page.goto('/settings?tab=appearance');
    const hours = around(await minutesNow(page));
    await setPrefs({ mode: 'scheduled', schedule: hours });
    await page.reload();
    await expect(option(page, 'Schedule')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    await expect.poll(() => theme(page)).toBe('dark');

    await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect.poll(() => theme(page), { timeout: 10_000 }).toBe('light');
    // Pinned: the mode is Light, the hours are kept, and Settings shows it.
    await expect.poll(storedPrefs, { timeout: 20_000 }).toEqual({ mode: 'off', schedule: hours });
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'true');
    await expect(option(page, 'Schedule')).toHaveAttribute('aria-pressed', 'false');
    await expect(startField(page)).toBeHidden();

    // A fresh load is still light — inside the window it used to resume.
    await page.reload();
    await expect(option(page, 'Light')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    expect(await theme(page)).toBe('light');

    // Turning the schedule back on restores the hours, and the theme follows.
    await option(page, 'Schedule').click();
    await expect(startField(page)).toHaveValue(hhmm(hours.start));
    await expect.poll(() => theme(page), { timeout: 10_000 }).toBe('dark');
  } finally {
    await ctx.close();
  }
});
