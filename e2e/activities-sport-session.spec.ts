import { test, expect, type Page } from './helpers/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// A sport session (activities details A9, Oct 16 2026): a practice or a game
// tagged with its sport, timed, with a map only when the athlete turns it on.
// It is saved with its sport (never without), counts toward Training's week
// as "Soccer · Practice", and is never a sport RESULT.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, sport_key, session_kind').limit(1);
  test.skip(!!probe.error, `migration 265 not applied on this target (${probe.error?.code})`);
});

async function sessionToFinish(page: Page) {
  await page.goto('/activities/record');
  await page.locator('[data-record-type="sport_session"]').click({ timeout: 20_000 });
  await expect(page.locator('[data-record-map-toggle] input')).not.toBeChecked();
  await page.locator('[data-record-start]').click();
  await expect(page.locator('[data-record-map]')).toHaveCount(0);
  await page.waitForTimeout(6_000);
  await page.locator('[data-record-finish]').click();
  await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
}

test('a soccer practice: saved with its sport, read back as "Soccer · Practice", in Training; the next one pre-fills the sport @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await sessionToFinish(page);
    // Never saved without its sport.
    await expect(page.locator('[data-record-save]')).toBeDisabled();
    await expect(page.locator('[data-record-sport-needed]')).toBeVisible();
    const form = page.locator('[data-finish-details="sport_session"]');
    await form.locator('[data-detail-field="sport"] [data-detail-option="soccer"]').click();
    await form.locator('[data-detail-field="session_kind"] [data-detail-option="practice"]').click();
    await form.locator('[data-detail-field="minutes_played"] input').fill('60');
    await form.locator('[data-effort="6"]').click();
    await page.locator('[data-feed-toggle="on"]').click();
    await expect(page.locator('[data-record-save]')).toBeEnabled();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;

    const { data: row } = await admin.from('activities').select('activity_type, sport_key, session_kind, details, effort, has_route').eq('id', id).single();
    expect(row).toEqual({ activity_type: 'sport_session', sport_key: 'soccer', session_kind: 'practice', details: { minutes_played: 60 }, effort: 6, has_route: false });
    await expect(page.locator('[data-activity-details]')).toHaveText('Soccer · Practice · 60 min played');
    await expect(page.locator('[data-activity-tile="distance"]')).toHaveCount(0);

    // Training's week counts it, wearing its sport.
    await page.goto('/athlete?tab=training');
    await expect(page.locator('[data-training-recent-sessions] [data-session-sport="soccer"]').first()).toHaveText('Soccer · Practice', { timeout: 30_000 });

    // The next session starts on soccer practice — the minutes do not carry over.
    await sessionToFinish(page);
    const next = page.locator('[data-finish-details="sport_session"]');
    await expect(next.locator('[data-detail-field="sport"] [data-detail-option="soccer"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(next.locator('[data-detail-field="minutes_played"] input')).toHaveValue('');
    await page.locator('[data-record-discard]').click();
    await page.getByRole('button', { name: 'Discard' }).last().click();
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('"Map my movement" draws a route for a game @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE, geolocation: { latitude: 43.65, longitude: -79.38, accuracy: 8 }, permissions: ['geolocation'] });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="sport_session"]').click({ timeout: 20_000 });
    await page.locator('[data-record-map-toggle] input').check();
    await page.locator('[data-record-start]').click();
    await expect(page.locator('[data-record-map]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-record-distance]')).toBeVisible();
    await page.locator('[data-record-finish]').click();
    await page.locator('[data-record-discard]').click();
    await page.getByRole('button', { name: 'Discard' }).last().click();
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('the server refuses a sport session without its sport, and a retype clears it; it is never a result', async () => {
  test.setTimeout(90_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    // Each its own start (a shared start would make them one activity — the cross-source twin rule).
    let start = Date.UTC(2026, 9, 1, 8, 0, 0);
    const wire = (type: 'sport_session' | 'yoga') => {
      start += 3 * 3600_000;
      return { ...liveWire({ type, n: 120, stepM: 0, stepS: 10, t0: start }), lat: undefined, lng: undefined };
    };
    expect((await api.post('/api/activities', { data: { activity: wire('sport_session') } })).status()).toBe(400);
    expect((await api.post('/api/activities', { data: { activity: wire('sport_session'), finish: { details: { session_kind: 'game' } } } })).status()).toBe(400);
    const ok = await api.post('/api/activities', { data: { activity: wire('sport_session'), finish: { details: { sport: 'mma', session_kind: 'practice' } } } });
    expect(ok.status(), await ok.text()).toBe(201);
    ids.push((await ok.json()).id);
    // Never a result: the sport bridge refuses it.
    const asResult = await api.post('/api/posts', { data: { postType: 'mma', caption: '', visibility: 'private', stats_data: { type: 'activity', activity_id: ids[0] } } });
    expect(asResult.status()).toBe(400);
    // A yoga cannot become a sport session without a sport; the session retyped to yoga loses its sport.
    const yoga = await api.post('/api/activities', { data: { activity: wire('yoga') } });
    ids.push((await yoga.json()).id);
    expect((await api.patch(`/api/activities/${ids[1]}`, { data: { type: 'sport_session' } })).status()).toBe(400);
    expect((await api.patch(`/api/activities/${ids[0]}`, { data: { type: 'yoga' } })).status()).toBe(200);
    const { data: row } = await admin.from('activities').select('activity_type, sport_key, session_kind').eq('id', ids[0]).single();
    expect(row).toEqual({ activity_type: 'yoga', sport_key: null, session_kind: null });
  } finally {
    for (const id of ids) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
    await api.dispose();
  }
});
