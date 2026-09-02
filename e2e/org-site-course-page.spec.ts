import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Golf sites, part 2 (phase 6e S2): a page per course. The org-gated
// course page draws each hole from the cached OSM tee→green line (an
// inline SVG — no tiles, no client JS), labels a named nine, shows the
// catalog phone, a Directions link from lat/lng, GolfCourse structured
// data with telephone, a course photo from the site's assets (prefix
// re-asserted), and the sitemap carries the page. A course the org's
// venues don't link 404s indistinguishably; module off → 404.

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

async function settle(
  request: { get: (u: string) => Promise<{ status: () => number }> },
  url: string,
  expected: number,
  attempts = 8
): Promise<number> {
  let last = 0;
  for (let i = 0; i < attempts; i++) {
    last = (await request.get(url)).status();
    if (last === expected) return last;
    await new Promise(r => setTimeout(r, 2500));
  }
  return last;
}

test('course page: hole SVGs from OSM geometry, section label, phone, directions, JSON-LD, photo, sitemap; foreign/unknown 404; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);

  const probe = await admin.from('golf_courses').select('hole_geometry').limit(1);
  test.skip(!!probe.error, `golf_courses.hole_geometry missing — run migration 102 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Course Page Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert({ club_id: clubId, profile_id: owner.id, role: 'owner' });

  const holes = Array.from({ length: 9 }, (_, i) => ({
    number: i + 1,
    par: i % 3 === 0 ? 5 : i % 3 === 1 ? 4 : 3,
    yardage: { white: 380 - i * 10 },
    handicap: i + 1,
  }));
  const geometry = {
    source: 'osm',
    holes: [
      { hole: 1, par: 5, line: [[45.3, -75.9], [45.3018, -75.9], [45.3036, -75.9]] },
      { hole: 2, par: 4, line: [[45.3036, -75.899], [45.302, -75.897]] },
    ],
  };
  const { data: linked } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-course-page-${stamp}`,
      name: `QA North Nine ${stamp}`,
      club_name: `QA Links ${stamp}`,
      city: 'Kanata',
      region: 'Ontario',
      country: 'Canada',
      total_par: 36,
      holes_count: 9,
      hole_data: holes,
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
      lat: 45.3,
      lng: -75.9,
      phone: '+1 613 555 0199',
      website: 'https://qa-links.example',
      section_name: 'North Nine',
      section_kind: 'nine',
      hole_geometry: geometry,
    })
    .select('id')
    .single();
  const courseId = linked!.id as string;
  const { data: unlinked } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-course-page-b-${stamp}`,
      name: `QA Unlinked ${stamp}`,
      total_par: 72,
      holes_count: 18,
      hole_data: [],
    })
    .select('id')
    .single();
  const unlinkedId = unlinked!.id as string;
  await admin.from('venues').insert({ club_id: clubId, name: `QA Venue ${stamp}`, golf_course_id: courseId });

  const ownerApi = await apiAs('state-b.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_module', moduleKey: 'courses', enabled: true },
    });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const canonicalProbe = await anonCtx.request.get(`/org/${site.subdomain}`, { maxRedirects: 0 });
    const sitePath = canonicalProbe.status() === 301 ? `/${site.subdomain}` : `/org/${site.subdomain}`;
    const pageUrl = `${sitePath}/courses/${courseId}`;

    // The course page.
    const html = await settleBody(anonCtx.request, pageUrl, 'North Nine', true, 12);
    expect(html).toContain('North Nine · 9 holes');
    expect(html).toContain('<path d="M ');
    expect(html).toContain('OpenStreetMap contributors');
    expect(html).toContain('aria-label="Hole 1, par 5, ≈');
    expect(html).toContain('Course overview: 2 holes');
    expect(html).toContain('href="tel:+16135550199"');
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=45.3,-75.9"');
    expect(html).toContain('href="https://qa-links.example"');
    expect(html).toContain('35.2 / 118');
    expect(html).toContain('"@type":"GolfCourse"');
    expect(html).toContain('"telephone":"+1 613 555 0199"');
    expect(html).toContain(`rel="canonical" href="`);
    expect(html).toContain(`/courses/${courseId}"`);
    expect(html).toContain(`Home of QA Course Page Club ${stamp}`);
    expect(html).not.toContain('data-theme');

    // The list links to the page; foreign / unknown / non-uuid ids 404.
    const list = await settleBody(anonCtx.request, `${sitePath}/courses`, `/courses/${courseId}`, true, 12);
    expect(list).toContain(`${sitePath}/courses/${courseId}`);
    expect(list).toContain(`/explore?course=${courseId}`);
    expect((await anonCtx.request.get(`${sitePath}/courses/${unlinkedId}`)).status()).toBe(404);
    expect((await anonCtx.request.get(`${sitePath}/courses/00000000-0000-4000-8000-000000000001`)).status()).toBe(404);
    expect((await anonCtx.request.get(`${sitePath}/courses/not-a-uuid`)).status()).toBe(404);

    // Sitemap carries the course page.
    const sitemap = await settleBody(anonCtx.request, '/sitemap.xml', `/courses/${courseId}`, true, 12);
    expect(sitemap).toContain(`/${site.subdomain}/courses/${courseId}`);

    // A course photo: upload → set → the page streams it; a foreign path is refused.
    const photo = fs.readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', 'photo.png'));
    res = await ownerApi.post(`/api/clubs/${clubId}/site/assets`, {
      multipart: { image: { name: 'course.png', mimeType: 'image/png', buffer: photo } },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const imagePath = (await res.json()).path as string;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_course_photo', courseId, path: imagePath.replace(site.id, '00000000-0000-4000-8000-000000000001') },
    });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_course_photo', courseId, path: imagePath, alt: 'The first tee' },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const withPhoto = await settleBody(anonCtx.request, pageUrl, `/api/media/org-media/${site.id}/`, true, 12);
    expect(withPhoto).toContain(`/api/media/org-media/${site.id}/`);
    expect(withPhoto).toContain('alt="The first tee"');
    // The module row keeps its enabled flag (UPDATE, never upsert).
    const { data: mod } = await admin
      .from('org_site_modules')
      .select('enabled, config')
      .eq('site_id', site.id)
      .eq('module_key', 'courses')
      .single();
    expect(mod!.enabled).toBe(true);
    expect((mod!.config as { photos: Record<string, { path: string }> }).photos[courseId].path).toBe(imagePath);

    // 375px: the hole-by-hole table scrolls inside its container.
    const page = await anonCtx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(pageUrl);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('North Nine', { timeout: 15_000 });
    await expect(page.getByRole('img', { name: /Hole 1, par 5/ })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.close();

    // Module off → the page no longer exists.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_module', moduleKey: 'courses', enabled: false },
    });
    expect(res.status()).toBe(200);
    expect(await settle(anonCtx.request, pageUrl, 404, 12)).toBe(404);
  } finally {
    await ownerApi.dispose();
    await anonCtx.close();
    await admin.from('org_sites').delete().eq('club_id', clubId);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().in('id', [courseId, unlinkedId]);
  }
});
