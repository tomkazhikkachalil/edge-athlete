import { test, expect, type Page } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Who sees a post is the ACCOUNT's call (Oct 9 2026, Tom): the composer
// says so in one line — anyone on a public account, approved fans on a private
// one — and carries no per-post Public / Private switch. A post is written
// public; the feed's rule applies the account's privacy.

async function openComposer(page: Page) {
  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible({ timeout: 20_000 });
}

async function run(page: Page) {
  const admin = adminClient();
  const user = loadQaUser('user.json');
  const { data: before } = await admin.from('profiles').select('visibility').eq('id', user.id).single();
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', user.id);
    await openComposer(page);
    const line = page.locator('[data-composer-audience] [data-account-audience]');
    await expect(line).toHaveAttribute('data-account-audience', 'public');
    await expect(line).toContainText('Anyone can see it');
    await expect(line.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/settings?tab=privacy');
    // No per-post switch any more.
    await expect(page.locator('input[type="radio"][value="private"]')).toHaveCount(0);

    await admin.from('profiles').update({ visibility: 'private' }).eq('id', user.id);
    await openComposer(page);
    await expect(line).toHaveAttribute('data-account-audience', 'private');
    await expect(line).toContainText('approved fans');
  } finally {
    await admin.from('profiles').update({ visibility: before?.visibility ?? 'private' }).eq('id', user.id);
  }
}

test('the composer says who sees a post — the account decides (desktop)', async ({ page }) => {
  test.setTimeout(90_000);
  await run(page);
});

test('the composer says who sees a post — the account decides @mobile', async ({ page }) => {
  test.setTimeout(90_000);
  await run(page);
});
