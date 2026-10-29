import { test, expect } from './helpers/test';
import { apiAs, loadQaUser } from './helpers/qa-user';

// The sport picker (Tom's spec, Oct 27 2026; migration 285): search first,
// no "General Post", nothing pre-selected, Favourites under the search once
// the account has one, All Sports alphabetical; a star on each row keeps a
// favourite ON THE ACCOUNT (a fresh page — another device — shows it gold);
// tapping the gold star removes it. The composer's "Remove sport" is the way
// back to a General post.
//
// Rowing is the sport no other spec searches for: the QA user is shared, and
// header-create's phone test counts exactly ONE golf button after a search.

const CLEAR = { data: { sports: [] as string[] } };

for (const tag of ['', ' @mobile']) {
  test(`the sport picker: search first, no General, a star keeps a favourite on the account${tag}`, async ({ page }) => {
    const api = await apiAs('state.json');
    const me = loadQaUser('user.json');
    const picker = page.locator('div[class*="z-[60]"]');
    const openPicker = async () => {
      await page.goto('/feed');
      await page.getByRole('button', { name: 'Create', exact: true }).first().click();
      await page.locator('[data-create-sport]').click();
      await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible({ timeout: 15_000 });
    };
    try {
      expect((await api.patch('/api/settings/favourite-sports', CLEAR)).ok()).toBe(true);
      await openPicker();
      // No General option, no pre-selection, no Favourites yet; All Sports alphabetical.
      await expect(picker.getByText('General Post')).toHaveCount(0);
      await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(0);
      await expect(picker.locator('[data-sport-favourites]')).toHaveCount(0);
      await expect(picker.locator('[data-sport-row]').first()).toContainText('Baseball');
      // A star tap: gold, and the Favourites section appears with that sport.
      const star = picker.locator('[data-sport-favourite="rowing"]');
      await star.click();
      await expect(picker.locator('[data-sport-favourites] [data-sport-favourite="rowing"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(picker.locator('[data-sport-favourites]').getByRole('button', { name: /rowing/i })).toBeVisible();
      // The star never picked the sport: the picker is still open.
      await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible();
      // Search filters both sections; nothing found is said, not blank.
      const search = picker.getByPlaceholder('Search sports...');
      await search.fill('row');
      await expect(picker.locator('[data-sport-row]')).toHaveCount(2); // Rowing in Favourites and in All Sports
      await search.fill('zzz');
      await expect(picker.getByText('No sports found')).toBeVisible();
      // Persisted on the account: a fresh page shows it gold.
      await expect.poll(async () => {
        const res = await api.get(`/api/profile?id=${me.id}`);
        const body = await res.json() as { profile?: { favourite_sports?: unknown } };
        return body.profile?.favourite_sports;
      }).toEqual(['rowing']);
      await openPicker();
      await expect(picker.locator('[data-sport-favourites]')).toBeVisible();
      // The gold star again: removed, the section goes.
      await picker.locator('[data-sport-favourites] [data-sport-favourite="rowing"]').click();
      await expect(picker.locator('[data-sport-favourites]')).toHaveCount(0);
      await expect(picker.locator('[data-sport-favourite="rowing"]')).toHaveAttribute('aria-pressed', 'false');
      // A row tap picks the sport and advances; "Remove sport" is the way back to General.
      await picker.getByPlaceholder('Search sports...').fill('golf');
      await picker.getByRole('button', { name: /golf/i }).click();
      await expect(page.locator('[data-step-flow="golf-round"]')).toBeVisible();
      await page.locator('[data-post-type-clear]').click();
      await expect(page.getByText('General Post', { exact: true })).toBeVisible();
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
    expect(ok.headers()['cache-control']).toContain('no-store');
    const theirs = await viewer.get(`/api/profile?id=${me.id}`);
    expect(JSON.stringify(await theirs.json())).not.toContain('favourite_sports');
  } finally {
    await mine.patch('/api/settings/favourite-sports', CLEAR);
    await mine.dispose();
    await viewer.dispose();
  }
});
