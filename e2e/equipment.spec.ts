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
    // Four more drivers so the category overflows the desktop shelf
    // (SHELF_VISIBLE_COUNT = 4) and "See all 5" appears.
    for (let i = 1; i <= 4; i++) {
      const extra = await api.post('/api/equipment', {
        data: { profileId: userA.id, sportKey: 'golf', category: 'driver', brand: 'PING', model: `QA Filler ${stamp}-${i}` },
      });
      expect(extra.ok(), await readErrorBody(extra)).toBe(true);
    }
    // A lone-category item (sparse packing: <3 items → the combined
    // "More gear" shelf, NOT a full-width category block).
    const ball = await api.post('/api/equipment', {
      data: { profileId: userA.id, sportKey: 'golf', category: 'ball', brand: 'Titleist', model: `QA Ball ${stamp}` },
    });
    expect(ball.ok(), await readErrorBody(ball)).toBe(true);
    // A second sport, to prove the rail's sport filter.
    const cleats = await api.post('/api/equipment', {
      data: { profileId: userA.id, sportKey: 'soccer', category: 'cleats', brand: 'Nike', model: `QA Cleats ${stamp}` },
    });
    expect(cleats.ok(), await readErrorBody(cleats)).toBe(true);
  } finally {
    await api.dispose();
  }

  // A labeled item: renders as its own ★ set shelf above the categories,
  // with a rail entry. (Requires migration 064 — group_label column.)
  const api2 = await apiAs('state.json');
  try {
    const res = await api2.post('/api/equipment', {
      data: {
        profileId: userA.id, sportKey: 'golf', category: 'putter',
        brand: 'Scotty Cameron', model: `QA Set Putter ${stamp}`,
        groupLabel: 'Tournament bag',
      },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
  } finally {
    await api2.dispose();
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

  // Store-browse chrome at the default 1280 viewport: the category rail is
  // visible; its Driver entry jumps to the category block; the overflowing
  // shelf offers "See all 5" which expands to a grid in place.
  const rail = page.getByRole('navigation', { name: 'Equipment sections' });
  await expect(rail).toBeVisible();

  // Custom set: ★ shelf above the categories + violet rail entry; the
  // labeled putter is re-filed OUT of a Putter category (set replaces it).
  await expect(page.getByRole('heading', { name: 'Tournament bag' })).toBeVisible();
  await expect(page.getByText(`QA Set Putter ${stamp}`).first()).toBeVisible();
  await expect(rail.getByRole('button', { name: /Tournament bag/ })).toBeVisible();
  await expect(rail.getByRole('button', { name: /^Putter/ })).toHaveCount(0);

  // Sparse packing: the lone ball lives in the combined "More gear" shelf,
  // and its rail entry jumps THERE (no full-width Ball category block).
  await expect(page.getByRole('heading', { name: 'More gear' })).toBeVisible();
  await expect(page.locator('#equip-golf-ball')).toHaveCount(0);
  await rail.getByRole('button', { name: /^Ball/ }).click();
  await expect(page.locator('#equip-golf-more-gear')).toBeInViewport({ timeout: 10_000 });

  // Rail = sport selector: filter to Golf, soccer section disappears;
  // All Sports brings it back.
  const soccerSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Soccer', exact: true }),
  });
  await expect(soccerSection).toHaveCount(1);
  await rail.getByRole('button', { name: 'Golf', exact: true }).click();
  await expect(soccerSection).toHaveCount(0);
  await expect(rail.getByRole('button', { name: 'Soccer', exact: true })).toBeVisible();
  await rail.getByRole('button', { name: 'All Sports', exact: true }).click();
  await expect(soccerSection).toHaveCount(1);

  // Collapsible rail groups: collapsing Golf hides its category entries.
  await rail.getByRole('button', { name: 'Collapse Golf' }).click();
  await expect(rail.getByRole('button', { name: /^Driver/ })).toHaveCount(0);
  await rail.getByRole('button', { name: 'Expand Golf' }).click();
  await expect(rail.getByRole('button', { name: /^Driver/ })).toBeVisible();
  await rail.getByRole('button', { name: /^Driver/ }).click();
  await expect(page.locator('#equip-golf-driver')).toBeInViewport({ timeout: 10_000 });
  const seeAll = page.getByRole('button', { name: 'See all 5' });
  await expect(seeAll).toBeVisible();
  await seeAll.click();
  await expect(page.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();

  // Search narrows; garbage empties.
  const searchBox = page.getByLabel('Search equipment');
  await searchBox.fill(model);
  await expect(page.getByText(model).first()).toBeVisible();
  await searchBox.fill('zzz-no-such-gear');
  await expect(page.getByText('No gear matches')).toBeVisible();
  await searchBox.fill('');

  // Retire via the card action → History, current year bucket. Five cards
  // exist, so scope the Retire click to the card holding OUR model (the card
  // root is the rounded, overflow-hidden div).
  await page
    .locator('div.relative.rounded-lg.overflow-hidden')
    .filter({ hasText: model })
    .getByRole('button', { name: 'Retire', exact: true })
    .click();
  await expect(page.getByText(model)).toBeHidden({ timeout: 15_000 });
  await page.locator('section').getByRole('button', { name: /history/i }).first().click();
  await expect(page.getByText(model).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: String(new Date().getFullYear()), exact: true })
  ).toBeVisible();

  // Seasons time machine: the current-year chip shows the retired item again
  // (in-bag-during-year includes retired-since gear); "Now" hides it back
  // into History. Collapse History first — otherwise the item stays visible
  // in Now view through the still-open History section.
  await page.locator('section').getByRole('button', { name: /history/i }).first().click();
  await expect(page.getByText(model)).toBeHidden();
  const year = String(new Date().getFullYear());
  await page.getByRole('tab', { name: year, exact: true }).click();
  await expect(page.getByText(`In the Bag — ${year}`).first()).toBeVisible();
  await expect(page.getByText(model).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Now', exact: true }).click();
  await expect(page.getByText(model)).toBeHidden({ timeout: 10_000 });
});
