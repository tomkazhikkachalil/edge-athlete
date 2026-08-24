import { test, expect } from '@playwright/test';

/**
 * Location-aware course search on Explore (migrations 104–107, Aug 24 2026).
 *
 * Anonymous surface, no fixtures: the seeded/imported catalog is the same
 * Supabase project in every environment. Proves the things the prod probes
 * proved, in the UI: multi-token queries, accent folding, the Country →
 * Region facets, and Near me (emulated geolocation at downtown Ottawa).
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function openGolf(page: import('@playwright/test').Page) {
  await page.goto('/explore');
  await page.getByRole('tab', { name: /golf/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Golf Courses' })).toBeVisible();
}

test('explore courses: typed location queries find courses by city, province and country', async ({ page }) => {
  await openGolf(page);
  const search = page.getByPlaceholder('Course, club, city, region or country');

  await search.fill('kanata ontario');
  await expect(page.getByRole('button', { name: /^Kanata Golf Club/ })).toBeVisible({ timeout: 10_000 });

  await search.fill('montreal');
  await expect(page.getByText(/Montréal, Quebec · Canada/).first()).toBeVisible({ timeout: 10_000 });

  await search.fill('eagle creek ottawa');
  await expect(page.getByRole('button', { name: /^Eagle Creek Golf Club/ }).first()).toContainText('Ottawa, Ontario · Canada', {
    timeout: 10_000,
  });
});

test('explore courses: Country → Region facets narrow the catalog', async ({ page }) => {
  await openGolf(page);
  const country = page.getByRole('combobox', { name: 'Country' });
  await expect(country).toBeVisible();
  // Facets load async; Canada is in the top countries by count.
  await expect(country.locator('option', { hasText: /Canada \(/ })).toHaveCount(1, { timeout: 10_000 });
  await country.selectOption('CA');
  const region = page.getByRole('combobox', { name: 'Region' });
  await expect(region.locator('option', { hasText: /Ontario \(\d+\)/ })).toHaveCount(1, { timeout: 10_000 });
  await region.selectOption('ON');
  // Every rendered card is an Ontario course.
  const cards = page.locator('button[aria-expanded]').filter({ hasText: /·/ });
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  const n = await cards.count();
  for (let i = 0; i < n; i++) await expect(cards.nth(i)).toContainText('Ontario · Canada');
});

test('explore courses: Near me sorts by distance with km chips', async ({ browser }) => {
  const ctx = await browser.newContext({
    geolocation: { latitude: 45.4215, longitude: -75.6972 }, // downtown Ottawa
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  try {
    await openGolf(page);
    // Explore has TWO Near me buttons (athletes, courses) — scope to the section.
    const courses = page.getByRole('region', { name: 'Golf Courses' });
    await courses.getByRole('button', { name: 'Near me' }).click();
    await expect(courses.getByRole('button', { name: 'Near me' })).toHaveAttribute('aria-pressed', 'true');
    const chips = page.locator('button[aria-expanded] span', { hasText: /^\d+(\.\d)? km$/ });
    await expect(chips.first()).toBeVisible({ timeout: 10_000 });
    const kms = (await chips.allInnerTexts()).map(t => parseFloat(t));
    expect(kms.length).toBeGreaterThanOrEqual(3);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    expect(kms[0]).toBeLessThan(15); // Royal Ottawa / Champlain are ~6 km out
  } finally {
    await ctx.close();
  }
});

test('header search: a course result deep-links into Explore with the card open', async ({ page }) => {
  await page.goto('/explore');
  // The header's Search button opens the ⌘K dialog; the course kind rides the same box.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const box = page.getByRole('dialog', { name: 'Search' }).getByRole('combobox').first();
  await box.fill('eagle creek ottawa');
  const course = page.getByRole('option', { name: /Eagle Creek Golf Club/ }).first();
  await expect(course).toBeVisible({ timeout: 10_000 });
  await course.click();
  await expect(page).toHaveURL(/\/explore\?course=/);
  await expect(page.getByRole('button', { name: /^Eagle Creek Golf Club/ }).first()).toHaveAttribute('aria-expanded', 'true', {
    timeout: 15_000,
  });
});
