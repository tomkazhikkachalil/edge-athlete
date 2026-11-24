import { test, expect } from './helpers/test';
import { apiAs } from './helpers/qa-user';

// The header "+" on pages without their own composer mount (explore, live,
// messages, calendar, settings…) used to router.push('/athlete') — it
// silently navigated instead of composing. It now hands off to the feed's
// ?create=1 deep link, the same battle-tested path the rounds page and the
// onboarding CTA use. This guards the handoff end-to-end from two such pages.
// Events program: the button is now "Create" and opens the sheet; Post is the
// same handoff as before. Create menu redesign (Oct 13 2026): the sheet is
// Post · Sport · Event · Record Activity. Nov 20 2026: six doors on one screen,
// Post · Sport · Workout · Activity · Event · Full game, no second step — the
// Sport and Workout/Activity tests below are @smoke so CI protects the menu.
for (const route of ['/sports/explore', '/messages']) {
  test(`header + on ${route} opens the composer via /feed?create=1`, async ({ page }) => {
    await page.goto(route);
    // Desktop viewport (1280×800): the "+ Create" button is in the header
    // directly — no drawer needed.
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.locator('[data-create-post]').click();

    // The feed consumes ?create=1 and strips it from the URL, so asserting
    // the query races the cleanup — assert the OUTCOME: we're on /feed with
    // the composer modal open (its heading, not the inline feed bar).
    await expect(page).toHaveURL(/\/feed/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible({ timeout: 15_000 });
  });
}

// Quick links to the sport's dedicated pages (SportQuickLinks): declared by
// the sport adapter, mounted on the own profile. Before this, the rounds and
// trends pages were reachable only by direct URL — the component that carried
// their nav links (MultiSportActivity) was imported by nothing.
test('own profile shows adapter-declared sport quick links', async ({ page }) => {
  // Admin-created QA users have no declared sport; declare golf the way Edit
  // Profile does, so resolveSportKey has something to resolve.
  const api = await apiAs('state.json');
  const res = await api.put('/api/profile', { data: { profileData: { sport: 'Golf' } } });
  expect(res.ok()).toBeTruthy();

  try {
    await page.goto('/athlete');
    const rounds = page.getByRole('link', { name: /view all rounds/i });
    const trends = page.getByRole('link', { name: /trends/i }).first();
    await expect(rounds).toBeVisible({ timeout: 15_000 });
    await expect(trends).toBeVisible();

    // Reachable, not just countable: the link must actually take the click.
    await rounds.click();
    await expect(page).toHaveURL(/\/app\/sport\/golf\/rounds/);
    await expect(page.getByRole('heading', { name: /my rounds/i })).toBeVisible({ timeout: 15_000 });
  } finally {
    // Undo the declaration: the QA user is SHARED across specs running in
    // parallel, and a declared sport flips the feed composer's default to
    // golf — which HIDES the caption textarea and broke media-editor /
    // media-reedit whenever this test ran first (caught Aug 25, capture
    // round). A sported user is this test's fixture, not the suite's.
    const undo = await api.put('/api/profile', { data: { profileData: { sport: null } } });
    expect(undo.ok()).toBeTruthy();
    await api.dispose();
  }
});

// The sheet's second door: Event → the creation wizard (Events program).
test('header Create → Event opens the wizard', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('[data-create-event]').click();
  await expect(page).toHaveURL(/\/sports\/events\/new/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible({ timeout: 15_000 });
});

// Six doors in Tom's order (Nov 20 2026): Post · Sport · Workout · Activity · Event · Full game, on one screen.
// Tile grid (Nov 23 2026): the same doors under this sheet's titles, each with an info button beside it.
const DOORS = [
  ['post', 'Post'],
  ['sport', 'Sport session'],
  ['workout', 'Gym workout'],
  ['recording', 'Live activity'],
  ['event', 'Event & leaderboard'],
  ['full-game', 'Game highlights'],
] as const;

test('header Create shows Post, Sport session, Gym workout, Live activity, Event & leaderboard and Game highlights in that order — nothing else; Sport opens the composer with the sport picker @smoke', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const sheet = page.locator('[data-create-sheet]');
  await expect(sheet).toBeVisible();
  // Two sibling buttons per door: the option, then its info button. The ORDER is the rule.
  await expect(sheet.getByRole('button')).toHaveCount(DOORS.length * 2);
  for (const [i, [hook, title]] of DOORS.entries()) {
    const option = sheet.getByRole('button').nth(i * 2);
    await expect(option).toHaveAttribute(`data-create-${hook}`, '');
    await expect(option).toHaveAccessibleName(title);
    await expect(option).toHaveAttribute('aria-pressed', 'false');
    const info = sheet.getByRole('button').nth(i * 2 + 1);
    await expect(info).toHaveAccessibleName(`About ${title}`);
    await expect(info).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.locator('[data-larger-window="create"]').getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(sheet.locator('[data-create-record-activity], [data-create-back]')).toHaveCount(0);
  await expect(sheet.locator('[data-create-activity]')).toHaveCount(0);
  await expect(sheet.getByText(/import/i)).toHaveCount(0);

  // Sport → the feed's composer, with "Select Sport" already open; golf → the live-round setup.
  await sheet.locator('[data-create-sport]').click();
  await expect(page).toHaveURL(/\/feed/, { timeout: 15_000 });
  const picker = page.locator('div[class*="z-[60]"]');
  await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible({ timeout: 15_000 });
  await picker.getByPlaceholder('Search sports...').fill('golf');
  await picker.getByRole('button', { name: /golf/i }).first().click();
  // The round as steps (Oct 28 2026): step 1 is the round type, Playing now
  // pre-selected; the course field is step 2.
  const flow = page.locator('[data-step-flow="golf-round"]');
  await expect(flow).toBeVisible({ timeout: 15_000 });
  await expect(flow.locator('[data-step-header]')).toHaveText(/Step 1 of 7 · Round type/);
  await expect(page.getByText('Playing now')).toBeVisible();
  await flow.locator('[data-step-next]').click();
  await expect(page.getByPlaceholder(/search for a golf course/i)).toBeVisible({ timeout: 15_000 });
});

// Oct 22 2026, Tom's iPhone: after a cold open, Create → Sport zoomed the
// screen to the far left — the picker's search field auto-focused from the
// composer's lazily loaded chunk, after the tap. On a touch screen (the
// android project) the picker now opens with NOTHING focused; a fine pointer
// (mobile / webkit-mobile, emulation off) keeps the auto-focus; everywhere the
// field is 16 px, the grid in view and the page at scale 1. (Real iOS focus-zoom cannot be played in this harness;
// this pins the two causes. Tom's phone is the proof.)
test('Create → Sport on a phone: no field focused, the search at 16 px, the grid in view, scale 1 @mobile', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).first().click();
  await page.locator('[data-create-sport]').click();
  await expect(page).toHaveURL(/\/feed/, { timeout: 15_000 });
  const picker = page.locator('div[class*="z-[60]"]');
  await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible({ timeout: 15_000 });
  const search = picker.locator('[data-sport-search]');
  await expect(search).toBeVisible();
  // A touch screen: the field is NOT focused (no keyboard, no reveal) …
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({
    focusedIsSearch: document.activeElement?.hasAttribute('data-sport-search') ?? false,
    fontSize: getComputedStyle(document.querySelector('[data-sport-search]')!).fontSize,
    scale: window.visualViewport?.scale ?? 1,
    coarse: window.matchMedia('(pointer: coarse)').matches,
  }));
  // The mobile / webkit-mobile projects are phone-SIZED with emulation off (a
  // fine pointer — overflows are measured honestly); the android project
  // emulates touch (a coarse pointer). Each proves its own side of the rule.
  expect(state.focusedIsSearch, state.coarse ? 'the search is not auto-focused on a touch screen' : 'a fine pointer keeps the auto-focus').toBe(!state.coarse);
  // … and 16 px whether the guard matched by width or by pointer.
  expect(state.fontSize).toBe('16px');
  expect(state.scale).toBe(1);
  // The grid is in view; a tap on the field still works.
  await expect(picker.getByRole('button', { name: /golf/i }).first()).toBeVisible();
  await search.fill('golf');
  await expect(picker.getByRole('button', { name: /golf/i })).toHaveCount(1);
});

test('header Create → Workout and Activity open straight from the sheet: Activity is the recorder, Workout the start screen @smoke', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const sheet = page.locator('[data-create-sheet][data-create-step="root"]');
  await expect(sheet.locator('[data-create-workout]')).toBeVisible();
  await sheet.locator('[data-create-recording]').click();
  await expect(page).toHaveURL(/\/activities\/record$/, { timeout: 15_000 });
  await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });
  // Workout is the start SCREEN (Program E2) — nothing starts until its Start.
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('[data-create-workout]').click();
  await expect(page).toHaveURL(/\/app\/workout\/start$/, { timeout: 15_000 });
  await expect(page.locator('[data-workout-start]')).toBeVisible({ timeout: 20_000 });
});

// Tile grid with info (Tom's spec, Nov 23 2026): the info button swaps an
// option's content in place — it never opens the flow, never changes the
// option's box or moves another one, one is open at a time, and every one is
// closed when the sheet opens again. Run at the phone projects' width, at
// 320 px (the smallest phone on the floor) and at 390 px (the mockup).
test('Create: an info button shows the text in place — no navigation, no box moves, one open at a time, closed on reopen; a pick shows as selected @mobile', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/messages');
  const openSheet = async () => {
    await page.getByRole('button', { name: 'Create', exact: true }).first().click();
    await expect(page.locator('[data-create-sheet]')).toBeVisible();
  };
  const boxes = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-create-option]')).map((el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  }));
  const base = page.viewportSize()!;
  for (const width of [base.width, 320, 390]) {
    await page.setViewportSize({ width, height: base.height });
    await openSheet();
    const sheet = page.locator('[data-create-sheet]');
    const rest = await boxes();
    expect(rest).toHaveLength(DOORS.length);
    for (const [hook, title] of DOORS) {
      const box = sheet.locator(`[data-create-option="${hook}"]`);
      const info = sheet.getByRole('button', { name: `About ${title}`, exact: true });
      await info.scrollIntoViewIfNeeded();
      const before = await boxes();
      await info.click();
      await expect(info).toHaveAttribute('aria-expanded', 'true');
      await expect(box.locator('[data-create-info-text]')).toBeVisible();
      // Only one is open: every other info button reads collapsed.
      await expect(sheet.locator('[data-create-info][aria-expanded="true"]')).toHaveCount(1);
      // Nothing moved and nothing grew — and the text fits its fixed box.
      expect(await boxes(), `${title} at ${width}px`).toEqual(before);
      const fit = await box.evaluate((el) => {
        const outer = el.getBoundingClientRect();
        const text = el.querySelector('[data-create-info-text]')!.getBoundingClientRect();
        const btn = el.querySelector('[data-create-info]')!.getBoundingClientRect();
        return { inside: text.top >= outer.top && text.bottom <= outer.bottom + 0.5 && text.left >= outer.left && text.right <= outer.right + 0.5, target: Math.min(btn.width, btn.height) };
      });
      expect(fit.inside, `${title}'s info text fits its box at ${width}px`).toBe(true);
      expect(fit.target, `${title}'s info button is a 44 px target`).toBeGreaterThanOrEqual(44);
      // The info button is not the option: still on this page, the sheet still open.
      await expect(page).toHaveURL(/\/messages/);
      await expect(sheet).toBeVisible();
    }
    // A second tap swaps back to the title.
    const last = sheet.getByRole('button', { name: 'About Game highlights', exact: true });
    await last.click();
    await expect(last).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet.locator('[data-create-option="full-game"] [data-create-title]')).toBeVisible();
    // No sideways scroll at this width; long titles stay inside their tile.
    const layout = await page.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      titles: Array.from(document.querySelectorAll('[data-create-option]')).every((el) => {
        const o = el.getBoundingClientRect();
        const t = el.querySelector('[data-create-title]')!.getBoundingClientRect();
        return t.left >= o.left && t.right <= o.right + 0.5 && t.top >= o.top && t.bottom <= o.bottom + 0.5;
      }),
    }));
    expect(layout, `layout at ${width}px`).toEqual({ sideways: false, titles: true });
    // Reopen: everything is closed again.
    await sheet.getByRole('button', { name: 'About Post', exact: true }).click();
    await page.locator('[data-larger-window="create"]').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await openSheet();
    await expect(page.locator('[data-create-info][aria-expanded="true"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-create-sheet]')).toHaveCount(0);
  }
  await page.setViewportSize(base);

  // A pick: the info text closes, the option reads selected (pressed), Post
  // drops its solid fill, and the flow opens.
  await openSheet();
  const sheet = page.locator('[data-create-sheet]');
  await sheet.getByRole('button', { name: 'About Gym workout', exact: true }).click();
  await expect(sheet.locator('[data-create-option="post"]')).toHaveAttribute('data-solid', '');
  const event = sheet.locator('[data-create-event]');
  await event.scrollIntoViewIfNeeded();
  await event.click();
  await expect(event).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('[data-create-option="event"]')).toHaveAttribute('data-selected', '');
  await expect(sheet.locator('[data-create-info][aria-expanded="true"]')).toHaveCount(0);
  await expect(sheet.locator('[data-create-option="post"]')).not.toHaveAttribute('data-solid', '');
  await expect(page).toHaveURL(/\/sports\/events\/new/, { timeout: 15_000 });
});
