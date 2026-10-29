import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { startWeatherMock, type WeatherMock } from './helpers/weather-mock';

// Weather at the course (Oct 29 2026). Tom: outdoor sport cares about the
// weather — free, °F and °C, by location; for now only where golf has a
// clear input for it, offered for a LIVE round only, stamped on the round.
// Pinned here on the round-as-steps flow:
//   - the Conditions step of a Playing-now round at a catalog course offers
//     "Use the forecast at the course"; one tap fills weather / temperature /
//     wind from the stand-in provider (12.2 °C, partly cloudy, 20 km/h), the
//     line under the grid credits Open-Meteo, the finish summary says
//     "Forecast at tee-off", and Go Live stamps the round's scorecard row;
//   - the server asked the provider ONCE, for the course's 2-decimal cell;
//   - an already-played round never sees the button;
//   - the field follows the device unit: 54 with (°F), 12 with (°C) — the
//     stored value stays Fahrenheit; a second ask is a memo hit, no call.
// The provider is a local stand-in (weather-mock.ts) the test server is
// pointed at by playwright.config.ts; nothing reaches Open-Meteo.

const SPOT: [number, number] = [61.2, -30.4]; // mid-Atlantic — no one else's course within a cell

async function openGolf(page: Page): Promise<Locator> {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  // A round left behind (the crash draft) asks "Pick up where you left off?"
  // first — this spec starts every walk fresh.
  const leftOff = page.getByRole('heading', { name: 'Pick up where you left off?' });
  if (await leftOff.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(leftOff).toBeHidden();
    await page.getByRole('button', { name: /create a post/i }).click().catch(() => undefined);
  }
  await page.getByRole('button', { name: /general post/i }).click();
  const sportSelector = page.locator('div[class*="z-[60]"]');
  await sportSelector.getByPlaceholder('Search sports...').fill('golf');
  await sportSelector.getByRole('button', { name: /golf/i }).first().click();
  const flow = page.locator('[data-step-flow="golf-round"]');
  await expect(flow).toBeVisible({ timeout: 15_000 });
  return flow;
}
const header = (flow: Locator) => flow.locator('[data-step-header]');
async function next(flow: Locator, reached: RegExp) {
  await flow.locator('[data-step-next]').click();
  await expect(header(flow)).toHaveText(reached);
}
async function pickCourse(page: Page, name: string) {
  const courseInput = page.getByPlaceholder(/search for a golf course/i);
  await courseInput.fill(name.slice(0, 18));
  await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
  await expect(courseInput).toHaveValue(name);
}
async function chooseUnit(page: Page, unit: 'km' | 'mi') {
  await page.goto('/settings?tab=account');
  const choice = page.locator(`[data-units-choice="${unit}"]`);
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
}
/** Walk a fresh Playing-now round to the Conditions step at the seeded course. */
async function toConditions(page: Page, name: string): Promise<Locator> {
  const flow = await openGolf(page);
  await next(flow, /Step 2 of 6 · Course/);
  await pickCourse(page, name);
  await next(flow, /Step 3 of 6 · Game format/);
  await next(flow, /Step 4 of 6 · Conditions/);
  return flow;
}

test('a live round at a catalog course takes the forecast: filled, credited, stamped; once per cell; never for an already-played round; °F or °C by the device unit @mobile', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000); // a missing element fails with its name, never a silent hang
  await page.setViewportSize({ width: 375, height: 812 });
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const name = `QA Forecast Links ${stamp}`;
  let courseId = '';
  let groupPostId = '';
  let mock: WeatherMock | null = null;
  try {
    mock = await startWeatherMock();
    const seeded = await admin
      .from('golf_courses')
      .insert({ external_source: 'qa-e2e', external_id: `forecast-${stamp}`, name, city: 'Nowhere', lat: SPOT[0], lng: SPOT[1], total_par: 72, holes_count: 18 })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    // Imperial on this device: the field says °F and the forecast lands as 54.
    await chooseUnit(page, 'mi');
    let flow = await toConditions(page, name);
    await expect(page.locator('label[for="golf-temperature"]')).toHaveText('Temperature (°F)');
    const button = page.locator('[data-golf-forecast]');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator('#golf-weather')).toHaveValue('partly-cloudy', { timeout: 15_000 });
    await expect(page.locator('#golf-temperature')).toHaveValue('54');
    await expect(page.locator('#golf-wind')).toHaveValue('moderate');
    const note = page.locator('[data-golf-forecast-note]');
    await expect(note).toContainText('Forecast at tee-off');
    await expect(note).toContainText('Partly cloudy');
    await expect(note).toContainText('54 °F');
    await expect(note).toContainText('12 mph');
    await expect(note.locator('[data-golf-forecast-attribution]')).toHaveAttribute('href', /open-meteo\.com/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    // The server asked the provider once, for the course's 2-decimal cell.
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toContain('latitude=61.20&longitude=-30.40');
    expect(mock.calls[0]).toContain('current=temperature_2m');

    // The finish summary says so, and Go Live stamps the round.
    await next(flow, /Step 5 of 6 · Players/);
    await next(flow, /Step 6 of 6 · Start/);
    await expect(flow.locator('[data-round-summary-row="conditions"]')).toContainText('Forecast at tee-off');
    await expect(flow.locator('[data-round-summary-row="conditions"]')).toContainText('54 °F');
    const finish = flow.locator('[data-step-finish]');
    await expect(finish).toHaveText(/Go Live/);
    await finish.click();
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    expect(groupPostId).not.toBe('');
    const stamped = await admin
      .from('golf_scorecard_data')
      .select('weather_conditions, temperature, wind_speed')
      .eq('group_post_id', groupPostId)
      .single();
    expect(stamped.error, stamped.error?.message).toBeNull();
    expect(stamped.data).toMatchObject({ weather_conditions: 'partly-cloudy', temperature: 54, wind_speed: 15 });
    // The live round has done its job: end it now so the resume pill and the
    // composer's draft prompt stay out of the next two walks.
    const ended = await api.delete(`/api/group-posts/${groupPostId}`);
    expect(ended.ok()).toBe(true);
    groupPostId = '';

    // An already-played round never sees the button.
    flow = await openGolf(page);
    await page.getByRole('button', { name: 'Already played' }).click();
    await next(flow, /Step 2 of 7 · Course/);
    await pickCourse(page, name);
    await next(flow, /Step 3 of 7 · Game format/);
    await next(flow, /Step 4 of 7 · Conditions/);
    await expect(page.locator('[data-round-step="conditions"]')).toBeVisible();
    await expect(page.locator('[data-golf-forecast]')).toHaveCount(0);

    // Metric on this device: the field says °C, the same forecast reads 12,
    // and the second ask is a memo hit — the provider heard nothing new.
    await chooseUnit(page, 'km');
    flow = await toConditions(page, name);
    await expect(page.locator('label[for="golf-temperature"]')).toHaveText('Temperature (°C)');
    await page.locator('[data-golf-forecast]').click();
    await expect(page.locator('#golf-temperature')).toHaveValue('12', { timeout: 15_000 });
    await expect(page.locator('[data-golf-forecast-note]')).toContainText('12 °C');
    await expect(page.locator('[data-golf-forecast-note]')).toContainText('20 km/h');
    expect(mock.calls).toHaveLength(1);
  } finally {
    await cleanup('golf-forecast', [
      () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
      () => mock?.close(),
      () => api.dispose(),
      () => chooseUnit(page, 'km').catch(() => undefined),
    ]);
  }
});
