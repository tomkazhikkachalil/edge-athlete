import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Equipment round-trip through the sport-profile layout: seed via API,
// verify Current Setup rendering + auto-imagery element, search, retire via
// the card action, verify it lands in History under the current year.
test('equipment: seed → In the Bag → search → retire → History', async ({ page }) => {
  const userA = loadQaUser('user.json');
  const stamp = Date.now();
  const model = `QA Driver ${stamp}`;

  const api = await apiAs('state.json');
  try {
    const res = await api.post('/api/equipment', {
      data: { profileId: userA.id, sportKey: 'golf', category: 'driver', brand: 'Titleist', model },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
  } finally {
    await api.dispose();
  }

  await page.goto('/athlete');
  await page.getByRole('button', { name: /equipment/i }).first().click();

  // Sport section + sport-appropriate setup label, and the card under it.
  // Scoped: the profile page has OTHER "Golf" headings (sport posts strip),
  // so anchor to the equipment <section> that carries the setup label.
  const golfSection = page.locator('section').filter({ has: page.getByText('In the Bag') });
  await expect(golfSection.getByRole('heading', { name: 'Golf', exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('In the Bag').first()).toBeVisible();
  await expect(page.getByText(model).first()).toBeVisible();
  // Auto imagery: with no photo the well holds the brand logo or, without a
  // token/logo, the category emoji — assert SOME imagery element exists in
  // the card's image well rather than logo.dev bytes (CI may lack the token).
  await expect(page.locator('.aspect-video').first().locator('img, span').first())
    .toBeVisible();

  // Search narrows; garbage empties.
  const searchBox = page.getByLabel('Search equipment');
  await searchBox.fill(model);
  await expect(page.getByText(model).first()).toBeVisible();
  await searchBox.fill('zzz-no-such-gear');
  await expect(page.getByText('No gear matches')).toBeVisible();
  await searchBox.fill('');

  // Retire via the card action → History, current year bucket.
  await page.getByRole('button', { name: 'Retire', exact: true }).first().click();
  await expect(page.getByText(model)).toBeHidden({ timeout: 15_000 });
  await page.getByRole('button', { name: /history/i }).first().click();
  await expect(page.getByText(model).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: String(new Date().getFullYear()), exact: true })
  ).toBeVisible();
});
