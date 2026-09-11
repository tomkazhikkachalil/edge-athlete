import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Program 2, D1 (Sep 11 2026): two fixed forms as site widgets. A contact
// form and an interest form on a live site → the public page carries the
// native forms (no script, the form key, the honeypot) → an anonymous POST
// answers a 303 back to the page at #sent-<id> and stores one row; the
// honeypot answers "sent" and stores nothing; a bad email answers
// #error-<id>; the owner has a notification; the in-app org page shows the
// door. Skips until migration 187 has run.

test('org site forms: contact + interest widgets, the public POST, the honeypot, the notification, the in-app door', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Forms League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const { error: probeError } = await admin.from('org_site_form_submissions').select('id').limit(1);
    test.skip(!!probeError, 'org_site_form_submissions missing — run migration 187');
    await resetRateBucket(admin, 'site-form-site', siteId);
    // The per-IP bucket (5 / 10 min): the local server stamps the client as ::1 (or 127.0.0.1; 'unknown' without a forwarded header).
    for (const ip of ['::1', '127.0.0.1', 'unknown']) await resetRateBucket(admin, 'site-form', ip);

    // The two forms on the home layout, through the draft PUT.
    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { y: number; h: number }[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const contactId = 'w_0000000000f0c0a1';
    const interestId = 'w_0000000000f0c0a2';
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
      data: {
        layout: {
          ...canvas.layout,
          widgets: [
            ...canvas.layout.widgets,
            { id: contactId, key: 'contact_form', x: 0, y: bottom, w: 6, h: 6, cv: 1, config: { title: `Write to us ${stamp}`, intro: `We read everything ${stamp}`, thanks: `Got it ${stamp}` }, visibility: 'public' },
            { id: interestId, key: 'interest_form', x: 6, y: bottom, w: 6, h: 7, cv: 1, config: { title: `Join us ${stamp}` }, visibility: 'public' },
          ],
        },
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId, 'Forms');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pathFor = async (sub: string) => {
        const probe = await anon.request.get(`/org/${sub}`, { maxRedirects: 0 });
        return probe.status() === 301 ? `/${sub}` : `/org/${sub}`;
      };
      const base = await pathFor(subdomain);
      const html = await settleBody(anon.request, base, `We read everything ${stamp}`);
      expect(html).toContain(`action="/api/public/site-forms/${siteId}/${contactId}"`);
      expect(html).toContain(`data-site-form="interest"`);
      expect(html).toContain(`id="sent-${contactId}"`);
      expect(html).toContain(`Got it ${stamp}`);
      expect(html).toContain('name="website"'); // the honeypot
      expect(html).not.toContain('<script src="/api'); // no script of ours
      // Each widget carries its OWN form key (bound to the site and widget ids).
      const tokenFor = (widgetId: string) => html.match(new RegExp(`action="/api/public/site-forms/${siteId}/${widgetId}"[\\s\\S]*?name="t" value="([^"]+)"`))?.[1] ?? '';
      const post = (widgetId: string, fields: Record<string, string>) => {
        const token = tokenFor(widgetId);
        return anon.request.post(`/api/public/site-forms/${siteId}/${widgetId}`, { form: { ...(token ? { t: token } : {}), ...fields }, maxRedirects: 0, headers: { referer: `${new URL(base, 'http://x').pathname}` } });
      };
      // A real contact submission → 303 to #sent-, one row with the fields.
      const sent = await post(contactId, { name: `Sam ${stamp}`, email: 'sam@example.com', message: `Hello from the form ${stamp}` });
      expect(sent.status()).toBe(303);
      expect(sent.headers().location).toMatch(new RegExp(`#sent-${contactId}$`));
      const { data: rows } = await admin.from('org_site_form_submissions').select('kind, fields, page_path').eq('site_id', siteId);
      expect(rows).toHaveLength(1);
      expect(rows![0]).toMatchObject({ kind: 'contact', fields: { name: `Sam ${stamp}`, email: 'sam@example.com', message: `Hello from the form ${stamp}` } });
      // The honeypot: "sent", nothing stored.
      const bot = await post(contactId, { name: 'Bot', email: 'bot@example.com', message: 'buy', website: 'http://spam' });
      expect(bot.status()).toBe(303);
      expect(bot.headers().location).toMatch(/#sent-/);
      expect((await admin.from('org_site_form_submissions').select('id').eq('site_id', siteId)).data).toHaveLength(1);
      // A bad email → #error-; a missing age group on the interest form → #error-; a wrong widget → 404.
      const badEmail = await post(contactId, { name: 'Sam', email: 'nope', message: 'Hi' });
      expect(badEmail.headers().location).toMatch(new RegExp(`#error-${contactId}$`));
      const noGroup = await post(interestId, { name: 'Sam', email: 'sam@example.com' });
      expect(noGroup.headers().location).toMatch(new RegExp(`#error-${interestId}$`));
      expect((await anon.request.post(`/api/public/site-forms/${siteId}/w_0000000000f0c0ff`, { form: { name: 'x', email: 'x@example.com', message: 'x' }, maxRedirects: 0 })).status()).toBe(404);
      // An interest submission with an age group (never a date of birth).
      const interest = await post(interestId, { name: `Kim ${stamp}`, email: 'kim@example.com', ageGroup: 'U12', phone: '' });
      expect(interest.headers().location).toMatch(new RegExp(`#sent-${interestId}$`));
      const { data: rows2 } = await admin.from('org_site_form_submissions').select('kind, fields').eq('site_id', siteId).eq('kind', 'interest');
      expect(rows2).toHaveLength(1);
      expect(rows2![0].fields).toEqual({ name: `Kim ${stamp}`, email: 'kim@example.com', ageGroup: 'U12' });
      // The owner heard, with a summary — never the message.
      const { data: notes } = await admin.from('notifications').select('type, title, message, action_url').eq('user_id', owner.id).eq('type', 'site_form_submission');
      expect(notes!.length).toBeGreaterThanOrEqual(2);
      expect(notes!.some(n => n.title === `New message from Sam ${stamp}`)).toBe(true);
      expect(JSON.stringify(notes)).not.toContain(`Hello from the form ${stamp}`);
      expect(notes![0].action_url).toBe(`/app/org/league/${leagueId}#inbox`);
      // 375px: the forms inside the viewport; the thank-you shows at the #sent- target.
      const page = await anon.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${base}#sent-${contactId}`);
      await expect(page.getByText(`Got it ${stamp}`)).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await anon.close();
    }
    // In-app: the org page shows the form as a door to the site; the
    // console's Inbox (D2) lists both submissions — Mark read, Archive,
    // the archived view, Restore; nothing of it is public.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/league/${leagueId}`);
      const tile = page.locator(`[data-org-tile="${contactId}"]`);
      await expect(tile).toBeVisible({ timeout: 30_000 });
      await expect(tile.getByRole('link', { name: 'Contact us on the website' })).toBeVisible();

      await page.goto(`/app/org/league/${leagueId}#inbox`);
      const inbox = page.locator('[data-site-inbox]');
      await expect(inbox).toBeVisible({ timeout: 30_000 });
      await expect(inbox.locator('[data-site-inbox-unread]')).toHaveText('2');
      await expect(inbox.locator('[data-site-inbox-row]')).toHaveCount(2);
      const row = inbox.locator('[data-site-inbox-row]').filter({ hasText: `Sam ${stamp}` });
      await expect(row).toContainText(`Hello from the form ${stamp}`);
      await expect(row.getByRole('link', { name: 'sam@example.com' })).toHaveAttribute('href', 'mailto:sam@example.com');
      await row.locator('[data-site-inbox-read]').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Marked as read' })).toBeVisible({ timeout: 15_000 });
      await expect(inbox.locator('[data-site-inbox-unread]')).toHaveText('1');
      await row.locator('[data-site-inbox-archive]').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Archived' }).first()).toBeVisible({ timeout: 15_000 });
      await expect(inbox.locator('[data-site-inbox-row]')).toHaveCount(1);
      await inbox.getByRole('radio', { name: 'Archived' }).click();
      const archived = inbox.locator('[data-site-inbox-row]').filter({ hasText: `Sam ${stamp}` });
      await expect(archived).toBeVisible();
      await archived.locator('[data-site-inbox-restore]').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Restored to the inbox' })).toBeVisible({ timeout: 15_000 });
      // A member who is not a manager cannot read the inbox.
      const memberApi = await apiAs('state.json');
      try {
        expect((await memberApi.get(`/api/leagues/${leagueId}/site/forms`)).status()).toBe(403);
      } finally {
        await memberApi.dispose();
      }
      // 375px: the inbox inside the viewport.
      await page.setViewportSize({ width: 375, height: 812 });
      await inbox.getByRole('radio', { name: 'Open' }).click();
      await expect(inbox.locator('[data-site-inbox-row]').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('notifications').delete().eq('user_id', owner.id).eq('type', 'site_form_submission');
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
