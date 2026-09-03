import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// N6 (program 10) — per-hole photos. The courses module's config entry
// grows `holes: { [n]: { path, alt? } }`: set_course_photo with `hole`
// sets/clears ONE hole's photo, the course page draws it in the hole
// table (that hole only), a legacy course-photo entry keeps rendering,
// and the console offers a hole picker + upload per course. 375px.

const stamp = Math.random().toString(36).slice(2, 8);

test('hole photos: set hole 3 → drawn at hole 3 only; remove → gone; the course photo survives; console at 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Hole Photos Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([{ club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' }]);
  const holes = Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: i % 3 === 0 ? 5 : 4, yardage: { white: 380 - i * 10 }, handicap: i + 1 }));
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-hole-photos-${stamp}`,
      name: `QA Hole Photos Nine ${stamp}`,
      club_name: `QA Hole Links ${stamp}`,
      city: 'Kanata',
      region: 'Ontario',
      country: 'Canada',
      total_par: 39,
      holes_count: 9,
      hole_data: holes,
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  await admin.from('venues').insert({ club_id: clubId, name: `QA Hole Venue ${stamp}`, golf_course_id: courseId });

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const assets: string[] = [];
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_module', moduleKey: 'courses', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const photo = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
    const upload = async (name: string) => {
      const r = await ownerApi.post(`/api/clubs/${clubId}/site/assets`, {
        multipart: { image: { name, mimeType: 'image/png', buffer: photo } },
      });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      const p = (await r.json()).path as string;
      assets.push(p);
      return p;
    };
    const coursePath = await upload('course.png');
    const holePath = await upload('hole3.png');

    // A course photo (legacy shape) + hole 3.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_course_photo', courseId, path: coursePath, alt: 'The clubhouse' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_course_photo', courseId, hole: 3, path: holePath, alt: 'The 3rd green' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // Out of range and a foreign path are refused.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_course_photo', courseId, hole: 19, path: holePath } });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_course_photo', courseId, hole: 4, path: holePath.replace(site.id, '00000000-0000-4000-8000-000000000001') },
    });
    expect(res.status()).toBe(400);
    const { data: mod } = await admin.from('org_site_modules').select('enabled, config').eq('site_id', site.id).eq('module_key', 'courses').single();
    expect(mod!.enabled).toBe(true);
    const entry = (mod!.config as { photos: Record<string, { path: string; holes: Record<string, { path: string; alt: string }> }> }).photos[courseId];
    expect(entry.path).toBe(coursePath);
    expect(entry.holes).toEqual({ '3': { path: holePath, alt: 'The 3rd green' } });

    // The page: hole 3 only, the course photo still there.
    const pageUrl = `/org/${site.subdomain}/courses/${courseId}`;
    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get(pageUrl); html = r.ok() ? await r.text() : ''; return html.includes('data-hole-photo="3"'); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(html).toContain('alt="The 3rd green"');
    expect(html).not.toContain('data-hole-photo="1"');
    expect(html).toContain('alt="The clubhouse"');

    // Remove hole 3 → gone; the course photo survives.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_course_photo', courseId, hole: 3 } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await expect
      .poll(async () => { const r = await anon.request.get(pageUrl); html = r.ok() ? await r.text() : ''; return !html.includes('data-hole-photo='); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(html).toContain('alt="The clubhouse"');
    const { data: after } = await admin.from('org_site_modules').select('config').eq('site_id', site.id).eq('module_key', 'courses').single();
    expect((after!.config as { photos: Record<string, { holes?: unknown; path: string }> }).photos[courseId]).toEqual({ path: coursePath, alt: 'The clubhouse' });

    // The console at 375px: the hole picker + upload per course; an upload
    // through the UI lands on the chosen hole and shows a chip.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/club/${clubId}`);
      const picker = page.getByLabel(`Hole for a photo, QA Hole Photos Nine ${stamp}`);
      await expect(picker).toBeVisible({ timeout: 20_000 });
      await picker.selectOption('5');
      await page.getByLabel(`Hole photo for QA Hole Photos Nine ${stamp}`).setInputFiles(path.join(__dirname, 'fixtures', 'photo.png'));
      await expect(page.getByRole('button', { name: 'Remove hole 5 photo' })).toBeVisible({ timeout: 20_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      const { data: viaUi } = await admin.from('org_site_modules').select('config').eq('site_id', site.id).eq('module_key', 'courses').single();
      const holes5 = (viaUi!.config as { photos: Record<string, { holes: Record<string, { path: string }> }> }).photos[courseId].holes;
      expect(Object.keys(holes5)).toEqual(['5']);
      assets.push(holes5['5'].path);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
    if (assets.length) await admin.storage.from('uploads').remove(assets);
  }
});
