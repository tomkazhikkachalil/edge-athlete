import { test, expect } from './helpers/test';
import { adminClient } from './helpers/qa-user';

// The coming-soon page's form (flow changes program, item 1 — A2, Oct 19
// 2026): a signed-out visitor signs up with a name and the consent box
// (unticked by default) and reads a confirmation naming them and their
// address; the inquiry mode needs a message, stores it and confirms; the
// consent words land on the row. The page is reachable with or without
// the gate (the gate only redirects TO it). Self-skips pre-266. @mobile.

const stamp = Date.now().toString(36);
const CONSENT = 'Also send me Edge Athlete news and offers';

test('coming soon: a sign-up and an inquiry each end in a confirmation the person reads @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const probe = await admin.from('contacts').select('id').limit(1);
  test.skip(!!probe.error, `contacts missing — run migration 266 (${probe.error?.message})`);
  const emails = [`edgeqa-cs-signup-${stamp}@example.com`, `edgeqa-cs-inquiry-${stamp}@example.com`];
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  try {
    await page.goto('/auth/coming-soon');
    await expect(page.locator('[data-coming-soon]')).toBeVisible();
    const consent = page.locator('[data-coming-soon-consent]');
    await expect(consent).not.toBeChecked();
    await expect(page.locator('[data-coming-soon-submit]')).toHaveText('Notify me');

    // The sign-up: name + consent ticked.
    await page.locator('[data-coming-soon-name]').fill('Pat Tester');
    await page.locator('#coming-soon-email').fill(emails[0]);
    await consent.check();
    await page.locator('[data-coming-soon-submit]').click();
    const done = page.locator('[data-coming-soon-done="notify_signup"]');
    await expect(done).toBeVisible({ timeout: 15_000 });
    await expect(done).toContainText('on the list, Pat Tester');
    await expect(done).toContainText(emails[0]);
    const { data: signup } = await admin.from('contacts').select('*').eq('email', emails[0]);
    expect(signup).toHaveLength(1);
    expect(signup![0]).toMatchObject({ name: 'Pat Tester', source: 'notify_signup', marketing_consent: true, consent_text: CONSENT, user_type: 'athlete' });

    // The inquiry: the message is required, then stored; consent left off.
    await page.reload();
    await page.locator('[data-coming-soon-inquiry]').click();
    await expect(page.locator('[data-coming-soon-submit]')).toHaveText('Send');
    await page.locator('#coming-soon-email').fill(emails[1]);
    const message = page.locator('[data-coming-soon-message]');
    await expect(message).toBeVisible();
    await message.fill(`Do you have leagues in Ottawa? ${stamp}`);
    await page.locator('[data-coming-soon-submit]').click();
    const doneQ = page.locator('[data-coming-soon-done="inquiry"]');
    await expect(doneQ).toBeVisible({ timeout: 15_000 });
    await expect(doneQ).toContainText('we got your note');
    await expect(doneQ).toContainText(emails[1]);
    const { data: inquiry } = await admin.from('contacts').select('*').eq('email', emails[1]);
    expect(inquiry).toHaveLength(1);
    expect(inquiry![0]).toMatchObject({ source: 'inquiry', marketing_consent: false, consent_text: CONSENT });
    expect(inquiry![0].message).toContain('Ottawa');

    // The sign-in door is still there under the confirmation.
    await expect(page.locator('[data-coming-soon-signin]')).toBeVisible();
  } finally {
    await admin.from('contacts').delete().in('email', emails);
    await ctx.close();
  }
});
