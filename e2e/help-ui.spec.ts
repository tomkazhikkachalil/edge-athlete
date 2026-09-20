import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 3 PR 3 — the Help Center in a real browser at
// 390×844. Seeded articles (the service key): a signed-OUT visitor reads
// the videos section (click-to-play thumbnail, then the youtube-nocookie
// player), searches the articles, opens one (the body as blocks with a
// link), and files a guest request (the number); a signed-in reader gets
// the request form with the screenshot field, My requests, and the header's
// Help Center entry. Self-skips pre-224. @mobile.

test('help center UI: videos, search, an article, the guest request, the signed-in form, the header door @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('help_articles').select('id').limit(1);
  test.skip(!!probe.error, `help_articles missing — run migration 224 (${probe.error?.message})`);
  await resetRateBucket(admin, 'contact', '');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  const rand = Math.random().toString(36).slice(2, 8);
  const ids: string[] = [];
  const ticketIds: string[] = [];
  // The project's `use.storageState` signs every context in — an EMPTY state is the signed-out visitor.
  const ctxOut = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const ctxA = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
  try {
    const { data: seeded } = await admin
      .from('help_articles')
      .insert([
        { slug: `qa-video-${rand}`, title: `Posting a round (QA ${rand})`, body: 'Open the composer and pick the course.\n\n- Enter your scores\n- Tap Post\n\nMore at https://edgeathlete.ca/help.', topic: 'posting_media', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sort_order: 1, published: true },
        { slug: `qa-text-${rand}`, title: `Changing your handle (QA ${rand})`, body: 'Settings, then Account.', topic: 'account', video_url: null, sort_order: 2, published: true },
      ])
      .select('id');
    for (const r of seeded ?? []) ids.push(r.id as string);

    // Signed out.
    const page = await ctxOut.newPage();
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();
    const video = page.locator('[data-help-video="dQw4w9WgXcQ"]').first();
    await expect(video).toBeVisible();
    await video.click();
    await expect(page.locator('[data-help-video-playing="dQw4w9WgXcQ"] iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    // Search narrows the list.
    await page.locator('[data-help-search]').fill(`handle (QA ${rand}`);
    await expect(page.locator(`[data-help-article="qa-text-${rand}"]`)).toBeVisible();
    await expect(page.locator(`[data-help-article="qa-video-${rand}"]`)).toHaveCount(0);
    await page.locator('[data-help-search]').fill('');
    // The article page: blocks + a link, never raw HTML.
    await page.locator(`[data-help-article="qa-video-${rand}"]`).click();
    await expect(page.locator(`[data-help-article-page="qa-video-${rand}"]`)).toBeVisible();
    const body = page.locator('[data-help-body]');
    await expect(body.getByRole('listitem')).toHaveCount(2);
    await expect(body.getByRole('link', { name: 'https://edgeathlete.ca/help' })).toBeVisible();
    // The guest request.
    await page.goto('/help#request');
    const guest = page.locator('[data-guest-form]');
    await expect(guest).toBeVisible();
    await guest.getByLabel('Your email').fill(`edgeqa-guest-${rand}@example.com`);
    await guest.getByLabel('What happened?').fill('I cannot find the join button on my phone.');
    await guest.locator('[data-guest-submit]').click();
    const created = page.locator('[data-guest-created]');
    await expect(created).toBeVisible();
    expect((await created.getAttribute('data-guest-created')) ?? '').toMatch(/^EA-\d{4,}$/);
    const { data: guestRow } = await admin.from('tickets').select('id').eq('guest_email', `edgeqa-guest-${rand}@example.com`).single();
    if (guestRow) ticketIds.push(guestRow.id as string);

    // Signed in: the request form with the screenshot field, My requests, the header door.
    const pageA = await ctxA.newPage();
    await pageA.goto('/help');
    await expect(pageA.locator('[data-support-form]')).toBeVisible();
    await expect(pageA.locator('[data-support-screenshot]')).toBeVisible();
    await expect(pageA.getByRole('heading', { name: 'My requests' })).toBeVisible();
    await expect(pageA.locator('[data-help-contact]')).toContainText('support@edgeathlete.ca');
    const drawerToggle = pageA.getByRole('button', { name: 'Toggle mobile menu' });
    if (await drawerToggle.isVisible()) await drawerToggle.click();
    else await pageA.getByRole('button', { name: 'Account menu' }).click();
    await expect(pageA.locator('[data-help-center-link]').first()).toBeVisible();
  } finally {
    for (const c of [ctxOut, ctxA]) await c.close().catch(() => null);
    if (ids.length > 0) await admin.from('help_articles').delete().in('id', ids);
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
  }
});
