import { test, expect } from './helpers/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Program E (Oct 2026): set up an activity BEFORE it starts. The type's own
// questions are asked on the set-up card (Start stays one tap away, in the
// fixed bar); an idle set-up survives a reload and is never a session (no
// pill); Details can be answered while recording; the Finish reads it all
// back from the recording.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, effort, details').limit(1);
  test.skip(!!probe.error, `migration 265 not applied on this target (${probe.error?.code})`);
});

test('yoga: style and heated before Start, Start in the viewport, the Finish shows them pressed, the row holds them @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="yoga"]').click({ timeout: 20_000 });
    const card = page.locator('[data-record-ready]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-record-records-item="time"]')).toBeVisible();
    // The type's questions, before Start — never the effort.
    await card.locator('[data-detail-field="style"] [data-detail-option="vinyasa"]').click();
    await card.locator('[data-detail-field="heated"] [data-detail-option="true"]').click();
    await expect(card.locator('[data-finish-effort]')).toHaveCount(0);
    await expect(page.locator('[data-record-setup-line]')).toContainText('Vinyasa');
    // Start is one tap away, in the viewport, however long the card is.
    await expect(page.locator('[data-record-start]')).toBeInViewport({ ratio: 1 });
    await page.locator('[data-record-start]').click();
    await expect(page.locator('[data-record-screen="recording"]')).toBeVisible();
    await page.waitForTimeout(6_000);
    await page.locator('[data-record-finish]').click();
    const sheet = page.locator('[data-record-finish-sheet]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-detail-field="style"] [data-detail-option="vinyasa"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.locator('[data-detail-field="heated"] [data-detail-option="true"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-feed-toggle="on"]').click();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('details').eq('id', id).single();
    expect(row!.details).toMatchObject({ style: 'vinyasa', heated: true });
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('swim: an idle set-up survives a reload with its answers, shows no pill, and "Choose another activity" empties the device @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="swim"]').click({ timeout: 20_000 });
    const card = page.locator('[data-record-ready]');
    await card.locator('[data-detail-field="pool"] [data-detail-option="50m"]').click();
    await expect(card.locator('[data-detail-field="pool"] [data-detail-option="50m"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(800); // the engine's put
    await page.reload();
    await expect(page.locator('[data-record-ready]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-record-ready] [data-detail-field="pool"] [data-detail-option="50m"]')).toHaveAttribute('aria-pressed', 'true');
    // Not a session: no pill on the feed, no reopen prompt.
    await page.goto('/feed');
    await expect(page.getByRole('button', { name: /create a post/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-resume-pill]')).toHaveCount(0);
    await expect(page.locator('[data-reopen-prompt]')).toHaveCount(0);
    // Back: still set up; Choose another empties it.
    await page.goto('/activities/record');
    await expect(page.locator('[data-record-ready]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-record-choose-another]').click();
    await expect(page.locator('[data-record-type="swim"]')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('[data-record-type="swim"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-record-ready]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('elliptical: Details while recording — effort and a note — survive a reload and land on the Finish and the row @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="elliptical"]').click({ timeout: 20_000 });
    await page.locator('[data-record-start]').click();
    await expect(page.locator('[data-record-screen="recording"]')).toBeVisible();
    await page.locator('[data-record-details-open]').click();
    const sheet = page.locator('[data-record-details-sheet]');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-effort="6"]').click();
    await sheet.locator('[data-finish-notes]').fill('Easy spin');
    await sheet.locator('[data-record-details-done]').click();
    await expect(page.locator('[data-record-details-line]')).toContainText('Effort 6');
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.locator('[data-record-screen="recording"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-record-details-line]')).toContainText('Effort 6');
    await page.locator('[data-record-finish]').click();
    const finish = page.locator('[data-record-finish-sheet]');
    await expect(finish).toBeVisible();
    await expect(finish.locator('[data-finish-effort]')).toHaveAttribute('data-finish-effort', '6');
    await expect(finish.locator('[data-finish-notes]')).toHaveValue('Easy spin');
    await page.locator('[data-feed-toggle="on"]').click();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('effort, notes').eq('id', id).single();
    expect(row).toMatchObject({ effort: 6, notes: 'Easy spin' });
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('F7 — a ride asks its bike before Start and offers the indoor twin; switching leaves no orphan on the device @mobile', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="ride"]').click({ timeout: 20_000 });
    const card = page.locator('[data-record-ready]');
    await card.locator('[data-detail-field="bike"] [data-detail-option="gravel"]').click();
    await expect(page.locator('[data-record-setup-line]')).toHaveText('Gravel');
    await expect(card.locator('[data-record-records-item="elevation"]')).toBeVisible();
    // Doing this indoors? The twin's set-up replaces the ride's row (nothing orphaned: a reload shows the twin).
    await card.locator('[data-record-indoor-twin="indoor_ride"]').click();
    await expect(page.getByRole('heading', { name: 'Record · Indoor ride' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-record-ready] [data-detail-field="platform"]')).toBeVisible();
    await expect(page.locator('[data-record-indoor-twin]')).toHaveCount(0);
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Record · Indoor ride' })).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-record-choose-another]').click();
    await expect(page.locator('[data-record-type="ride"]')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('[data-record-type="ride"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-record-ready]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
