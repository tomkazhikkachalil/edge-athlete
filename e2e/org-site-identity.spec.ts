import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Golf sites, part 1 (phase 6e S1): a golf club's front door. The hero
// takes a photo (a site image asset — never a pdf, never another site's
// file), one loud button ("Book a tee time"), and a notice that every
// page carries until a date; the contact card takes a street address (→
// Directions), hours and social links; the org's structured data gains
// telephone / streetAddress / sameAs. Zero DDL — all jsonb.

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 8
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle) === shouldContain) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

test('club identity: hero photo + CTA + notice, contact card, JSON-LD; cross-site photo refused; expired notice hidden; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);

  const stamp = Date.now();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Identity Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert({ club_id: clubId, profile_id: owner.id, role: 'owner' });

  const ownerApi = await apiAs('state-b.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    const siteId = site.id;
    const home = (await (await anonCtx.request.get(`/org/${site.subdomain}`)).url()).includes(`/org/${site.subdomain}`)
      ? `/org/${site.subdomain}`
      : `/${site.subdomain}`;

    // A photo: the assets upload (image part) → a stored path under THIS site.
    const photo = fs.readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', 'photo.png'));
    res = await ownerApi.post(`/api/clubs/${clubId}/site/assets`, {
      multipart: { image: { name: 'hero.png', mimeType: 'image/png', buffer: photo } },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const imagePath = (await res.json()).path as string;
    expect(imagePath.startsWith(`org-media/${siteId}/`)).toBe(true);

    // Another site's path is refused; a pdf is not a photo (schema 400).
    const foreign = imagePath.replace(siteId, '00000000-0000-4000-8000-000000000001');
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_hero', headline: 'x', imagePath: foreign },
    });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_hero', headline: 'x', imagePath: `org-media/${siteId}/rules.pdf` },
    });
    expect(res.status()).toBe(400);
    // A button needs both halves.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_hero', headline: 'x', ctaLabel: 'Book' },
    });
    expect(res.status()).toBe(400);

    const nextYear = `${new Date().getUTCFullYear() + 1}-06-30`;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: {
        action: 'set_hero',
        headline: `Welcome to QA Links ${stamp}`,
        tagline: 'Nine holes by the river',
        imagePath,
        imageAlt: 'The ninth green at dusk',
        ctaLabel: 'Book a tee time',
        ctaUrl: 'https://booking.example.com/qa-links',
        notice: `Cart path only ${stamp}`,
        noticeUntil: nextYear,
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: {
        action: 'set_contact',
        email: 'proshop@qa-links.example',
        phone: '+1 613 555 0100',
        website: 'https://qa-links.example',
        address: ['1 Fairway Drive', 'Kanata, Ontario', 'K2K 1A1, Canada'],
        hours: 'Pro shop 7am–8pm daily\nRange closes at dusk',
        social: { instagram: 'https://instagram.com/qalinks', x: 'https://x.com/qalinks' },
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // A social link on the wrong host is refused.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_contact', social: { instagram: 'https://evil.example/instagram' } },
    });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Anonymous: the photo streams from THIS site, the button, the notice.
    const html = await settleBody(anonCtx.request, home, `Cart path only ${stamp}`);
    expect(html).toContain(`/api/media/org-media/${siteId}/`);
    expect(html).toContain('alt="The ninth green at dusk"');
    expect(html).toContain('href="https://booking.example.com/qa-links"');
    expect(html).toContain('Book a tee time');
    expect(html).toContain(`Cart path only ${stamp}`);
    expect(html).toContain('role="status"');
    // The contact card: address, hours, Directions, socials as text links.
    expect(html).toContain('1 Fairway Drive');
    expect(html).toContain('Range closes at dusk');
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=1%20Fairway%20Drive');
    expect(html).toContain('Directions');
    expect(html).toContain('href="https://instagram.com/qalinks"');
    expect(html).toContain('>Instagram<');
    expect(html).not.toContain('evil.example');
    // Structured data.
    expect(html).toContain('"telephone":"+1 613 555 0100"');
    expect(html).toContain('"streetAddress":"1 Fairway Drive, Kanata, Ontario, K2K 1A1, Canada"');
    expect(html).toContain('"sameAs":["https://instagram.com/qalinks","https://x.com/qalinks"]');
    // A subpage carries the notice too (the layout, not the home).
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_module', moduleKey: 'schedule', enabled: true },
    });
    expect(res.status()).toBe(200);
    const sub = await settleBody(anonCtx.request, `${home}/schedule`, `Cart path only ${stamp}`);
    expect(sub).toContain(`Cart path only ${stamp}`);

    // An expired notice is gone (the same save, yesterday's date).
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: {
        action: 'set_hero',
        headline: `Welcome to QA Links ${stamp}`,
        imagePath,
        ctaLabel: 'Book a tee time',
        ctaUrl: 'https://booking.example.com/qa-links',
        notice: `Cart path only ${stamp}`,
        noticeUntil: '2020-01-01',
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const after = await settleBody(anonCtx.request, home, `Cart path only ${stamp}`, false);
    expect(after).not.toContain(`Cart path only ${stamp}`);
    expect(after).toContain('Book a tee time'); // the rest of the hero survives the re-save

    // 375px: the hero, the button and the card fit; the console form fits.
    const page = await anonCtx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(home);
    await expect(page.getByRole('link', { name: /Book a tee time/ })).toBeVisible();
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px (site)').toBeLessThanOrEqual(375);
    await page.close();
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const console_ = await ctx.newPage();
      await console_.setViewportSize({ width: 375, height: 812 });
      await console_.goto(`/app/org/club/${clubId}`);
      await expect(console_.getByLabel('Hero button label')).toHaveValue('Book a tee time', { timeout: 20_000 });
      await expect(console_.getByLabel('Address line 1')).toHaveValue('1 Fairway Drive');
      await expect(console_.getByLabel('Instagram link')).toHaveValue('https://instagram.com/qalinks');
      scrollWidth = await console_.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px (console)').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await anonCtx.close();
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
