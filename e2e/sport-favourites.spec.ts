import { test, expect } from './helpers/test';
import { apiAs, loadQaUser } from './helpers/qa-user';

// The sport picker (Tom's spec, Oct 27 2026; migration 285): search first,
// no "General Post", nothing pre-selected; a switch on each tile keeps a
// favourite ON THE ACCOUNT. The composer's "Remove sport" is the way back to
// a General post.
//
// One home per sport (Tom, Nov 25 2026): a sport has ONE tile. Favourited, it
// moves up into Favourites (in the order added, newest last) and leaves All
// Sports; switched off, it returns to its alphabetical place. The move is a
// ~200 ms slide. No favourites: no header, a one-line hint. A failed save
// puts the sport back and says so.
//
// The QA user is shared: golf is never favourited here (other specs pick it).

const CLEAR = { data: { sports: [] as string[] } };

for (const tag of ['', ' @mobile']) {
  test(`the sport picker: one home per sport, favourites in the order added, the slide, the hint, a failed save put back${tag}`, async ({ page }) => {
    const api = await apiAs('state.json');
    const me = loadQaUser('user.json');
    const picker = page.locator('div[class*="z-[60]"]');
    const favs = picker.locator('[data-sport-favourites]');
    const all = picker.locator('[data-sport-all]');
    const hint = picker.locator('[data-sport-favourites-hint]');
    const keysIn = (section: typeof favs) => section.locator('[data-sport-row]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.sportRow));
    const openPicker = async () => {
      await page.goto('/feed');
      await page.getByRole('button', { name: 'Create', exact: true }).first().click();
      await page.locator('[data-create-sport]').click();
      await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible({ timeout: 15_000 });
    };
    const stored = async () => {
      const res = await api.get(`/api/profile?id=${me.id}`);
      const body = await res.json() as { profile?: { favourite_sports?: unknown } };
      return body.profile?.favourite_sports;
    };
    try {
      expect((await api.patch('/api/settings/favourite-sports', CLEAR)).ok()).toBe(true);
      await openPicker();
      // No General option, nothing pre-selected. No favourites: no header, the hint instead.
      await expect(picker.getByText('General Post')).toHaveCount(0);
      await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(0);
      await expect(favs).toHaveCount(0);
      await expect(picker.getByRole('heading', { name: 'Favourites' })).toHaveCount(0);
      await expect(hint).toHaveText('Switch a sport on to pin it here.');
      await expect(all.locator('[data-sport-row]').first()).toContainText('Baseball');
      const total = await picker.locator('[data-sport-row]').count();
      expect(total).toBeGreaterThan(10);

      // Record every slide the picker starts (the Web Animations call).
      await page.evaluate(() => {
        const w = window as unknown as { __moves: { key: string; duration: unknown; from: string }[] };
        w.__moves = [];
        const real = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
          const key = (this as HTMLElement).dataset?.sportRow;
          if (key) {
            const first = Array.isArray(keyframes) ? String(keyframes[0]?.transform ?? '') : '';
            w.__moves.push({ key, duration: typeof options === 'object' ? options.duration : options, from: first });
          }
          return real.call(this, keyframes, options);
        };
      });
      const moves = () => page.evaluate(() => (window as unknown as { __moves: { key: string; duration: unknown; from: string }[] }).__moves);

      // A switch tap: the sport MOVES up (one tile, gone from All Sports), the hint goes.
      await picker.locator('[data-sport-favourite="rowing"]').click();
      await expect(favs.locator('[data-sport-row="rowing"]')).toBeVisible();
      await expect(favs.locator('[data-sport-favourite="rowing"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(all.locator('[data-sport-row="rowing"]')).toHaveCount(0);
      await expect(picker.locator('[data-sport-row="rowing"]')).toHaveCount(1);
      await expect(picker.locator('[data-sport-row]')).toHaveCount(total);
      await expect(hint).toHaveCount(0);
      // The move was shown: a 200 ms slide from where the tile was.
      const slid = (await moves()).find(m => m.key === 'rowing');
      expect(slid, 'the moved tile slides').toBeTruthy();
      expect(slid?.duration).toBe(200);
      expect(slid?.from).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/);
      // The switch never picked the sport: the picker is still open.
      await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible();

      // The newest favourite goes at the END (not alphabetical).
      await picker.locator('[data-sport-favourite="wrestling"]').click();
      await expect(favs.locator('[data-sport-row="wrestling"]')).toBeVisible();
      await picker.locator('[data-sport-favourite="baseball"]').click();
      await expect(favs.locator('[data-sport-row="baseball"]')).toBeVisible();
      expect(await keysIn(favs)).toEqual(['rowing', 'wrestling', 'baseball']);
      await expect(picker.locator('[data-sport-row]')).toHaveCount(total);
      await expect.poll(stored).toEqual(['rowing', 'wrestling', 'baseball']);

      // Search covers both lists and keeps the two sections; a section with no match hides.
      const search = picker.getByPlaceholder('Search sports');
      await search.fill('ing');
      expect(await keysIn(favs)).toEqual(['rowing', 'wrestling']);
      await expect(all.locator('[data-sport-row="boxing"]')).toBeVisible();
      await expect(all.locator('[data-sport-row="rowing"]')).toHaveCount(0);
      await search.fill('row');
      await expect(picker.locator('[data-sport-row]')).toHaveCount(1); // Rowing, once, in Favourites
      await expect(all).toHaveCount(0);
      await search.fill('box');
      await expect(favs).toHaveCount(0);
      await expect(hint).toHaveCount(0); // a search with no favourite match just hides the section
      await expect(all.locator('[data-sport-row]')).toHaveCount(1);
      await search.fill('zzz');
      await expect(picker.getByText('No sports found')).toBeVisible();

      // On the account, in that order: a fresh page shows the same list.
      await openPicker();
      await expect(favs).toBeVisible();
      expect(await keysIn(favs)).toEqual(['rowing', 'wrestling', 'baseball']);

      // Switched off: back in All Sports at its alphabetical place, not at the bottom.
      await favs.locator('[data-sport-favourite="baseball"]').click();
      await expect(all.locator('[data-sport-row="baseball"]')).toBeVisible();
      await expect(all.locator('[data-sport-favourite="baseball"]')).toHaveAttribute('aria-pressed', 'false');
      expect(await keysIn(favs)).toEqual(['rowing', 'wrestling']);
      const names = await all.locator('[data-sport-name]').allTextContents();
      expect(names[0]).toBe('Baseball');
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
      await expect.poll(stored).toEqual(['rowing', 'wrestling']);

      // A save that fails: the sport goes up, then is put back, and a small toast says so.
      await page.route('**/api/settings/favourite-sports', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
      await all.locator('[data-sport-favourite="boxing"]').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Could not save favourite' })).toBeVisible({ timeout: 15_000 });
      await expect(all.locator('[data-sport-row="boxing"]')).toBeVisible();
      await expect(favs.locator('[data-sport-row="boxing"]')).toHaveCount(0);
      expect(await keysIn(favs)).toEqual(['rowing', 'wrestling']);
      await page.unroute('**/api/settings/favourite-sports');
      expect(await stored()).toEqual(['rowing', 'wrestling']);

      // The last one out: the section goes and the hint is back.
      await favs.locator('[data-sport-favourite="rowing"]').click();
      await favs.locator('[data-sport-favourite="wrestling"]').click();
      await expect(favs).toHaveCount(0);
      await expect(hint).toBeVisible();
      await expect(picker.locator('[data-sport-row]')).toHaveCount(total);

      // A tile tap picks the sport and advances; "Remove sport" is the way back to General.
      await picker.getByPlaceholder('Search sports').fill('golf');
      await picker.getByRole('button', { name: /golf/i }).click();
      await expect(page.locator('[data-step-flow="golf-round"]')).toBeVisible();
      await page.locator('[data-post-type-clear]').click();
      await expect(page.getByText('General post', { exact: true })).toBeVisible();
      await expect(page.locator('[data-step-flow="golf-round"]')).toHaveCount(0);
    } finally {
      await api.patch('/api/settings/favourite-sports', CLEAR);
      await api.dispose();
    }
  });
}

test('favourites belong to the owner: the route sanitizes, a viewer never receives them', async () => {
  const me = loadQaUser('user.json');
  const mine = await apiAs('state.json');
  const viewer = await apiAs('state-b.json');
  try {
    const saved = await mine.patch('/api/settings/favourite-sports', { data: { sports: ['rowing', 'zzz', 'rowing', 42] } });
    expect(saved.status()).toBe(400); // a non-string is refused by the body schema
    const ok = await mine.patch('/api/settings/favourite-sports', { data: { sports: ['rowing', 'zzz', 'rowing'] } });
    expect(ok.ok()).toBe(true);
    expect(await ok.json()).toEqual({ sports: ['rowing'] });
    // The order sent is the order stored (the order added), never re-sorted.
    const ordered = await mine.patch('/api/settings/favourite-sports', { data: { sports: ['wrestling', 'rowing', 'baseball', 'rowing'] } });
    expect(await ordered.json()).toEqual({ sports: ['wrestling', 'rowing', 'baseball'] });
    expect(ok.headers()['cache-control']).toContain('no-store');
    const theirs = await viewer.get(`/api/profile?id=${me.id}`);
    expect(JSON.stringify(await theirs.json())).not.toContain('favourite_sports');
  } finally {
    await mine.patch('/api/settings/favourite-sports', CLEAR);
    await mine.dispose();
    await viewer.dispose();
  }
});
