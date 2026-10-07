import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// Golf near-me program PR B (Oct 2026): the composer's "Near me" — one fix on
// the tap, the catalog sorted by distance with km chips, and "Playing at X?"
// offered first when the player is standing on a course. Self-seeded (the
// catalog lives on production only; staging holds no courses): a QA course at
// an isolated coordinate, removed in `finally`. The provider's proximity stays
// dormant on Free (the response says so).

const SPOT: [number, number] = [61.2, -30.4]; // mid-Atlantic — nothing else within 1 km anywhere

async function phoneContext(browser: Browser, at: [number, number]) {
  return browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 375, height: 740 },
    geolocation: { latitude: at[0], longitude: at[1] },
    permissions: ['geolocation'],
  });
}

test('composer: Near me sorts the picker by distance and offers the course you are standing on @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const name = `QA Near Links ${stamp}`;
  let courseId = '';
  const ctx = await phoneContext(browser, SPOT);
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({ external_source: 'qa-e2e', external_id: `near-${stamp}`, name, city: 'Nowhere', lat: SPOT[0] + 0.002, lng: SPOT[1], total_par: 72, holes_count: 18 })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    // The route: a location request with no text answers the seeded course
    // first with its distance, and the provider stayed dormant (Free).
    const res = await api.get(`/api/golf/courses?q=&limit=20&near=${SPOT[0]},${SPOT[1]}&radius=50`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const body = (await res.json()) as { courses: Array<{ id: string; distanceKm?: number }>; providerNearby: boolean };
    expect(body.providerNearby).toBe(false);
    expect(body.courses[0]?.id).toBe(courseId);
    expect(body.courses[0]?.distanceKm ?? 0).toBeLessThan(1);

    const page = await ctx.newPage();
    await page.goto('/feed');
    await page.getByRole('button', { name: /what's on your mind/i }).click();
    await page.getByRole('button', { name: /general post/i }).click();
    const sportSelector = page.locator('div[class*="z-[60]"]');
    await sportSelector.getByPlaceholder('Search sports...').fill('golf');
    await sportSelector.getByRole('button', { name: /golf/i }).first().click();

    await page.locator('[data-course-near-me]').click();
    const offer = page.locator('[data-course-nearby-offer]');
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expect(offer).toContainText(`Playing at ${name}?`);
    await expect(offer).toContainText(/0\.\d km/);
    await expect(page.locator('[data-course-near-me]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-course-km]').first()).toBeVisible();

    await offer.click();
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByPlaceholder(/search for a golf course/i)).toHaveValue(name);
    await expect(page.locator('[data-course-nearby-offer]')).toHaveCount(0);
  } finally {
    await ctx.close();
    if (courseId) await admin.from('golf_courses').delete().eq('id', courseId);
    await api.dispose();
  }
});
