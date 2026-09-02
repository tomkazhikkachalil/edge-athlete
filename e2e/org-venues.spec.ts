import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// The golf club page, part 1 (phase 6b A1): org managers own their venues
// and recognize a catalog golf course on one — the venues.golf_club_id /
// golf_course_id pair (169). The org page then shows the course (tees,
// scorecard, map) and gains its two missing doors: the public site and the
// console. A member without manage_org gets 403 from the write routes; the
// anonymous GET is a public reference read.

test('org venues: member 403 → owner create → link course → org page shows it → unlink → site link after publish; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-structure', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const probe = await admin.from('venues').select('golf_course_id').limit(1);
  test.skip(!!probe.error, `venues.golf_course_id missing — run migration 169 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Golf Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner' },
    { club_id: clubId, profile_id: member.id, role: 'member' },
  ]);

  // A QA catalog course: a single-course facility (no golf_clubs row — the
  // mig-125 shape that golf_club_id alone could never link).
  const holes = Array.from({ length: 9 }, (_, i) => ({
    number: i + 1,
    par: i % 3 === 0 ? 5 : i % 3 === 1 ? 4 : 3,
    yardage: { white: 380 - i * 10 },
    handicap: i + 1,
  }));
  const { data: course, error: courseError } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-venue-${stamp}`,
      name: `QA Links ${stamp}`,
      city: 'Kanata',
      region: 'Ontario',
      country: 'Canada',
      total_par: 36,
      holes_count: 9,
      hole_data: holes,
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
    })
    .select('id')
    .single();
  expect(courseError, courseError?.message).toBeNull();
  const courseId = course!.id as string;

  const memberApi = await apiAs('state.json');
  const ownerApi = await apiAs('state-b.json');
  try {
    // Member: no manage_org → 403 on the write.
    let res = await memberApi.post(`/api/clubs/${clubId}/venues`, {
      data: { name: 'Sneaky venue' },
    });
    expect(res.status(), await readErrorBody(res)).toBe(403);

    // Owner creates the venue (unlinked).
    res = await ownerApi.post(`/api/clubs/${clubId}/venues`, {
      data: { name: `QA Course Venue ${stamp}` },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const venue = (await res.json()).venue as { id: string; courses: unknown[] };
    expect(venue.courses).toEqual([]);

    // Link the catalog course → the GET carries the course.
    res = await ownerApi.patch(`/api/clubs/${clubId}/venues/${venue.id}`, {
      data: { golfCourseId: courseId },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const linked = (await res.json()).venue as {
      golfClubId: string | null;
      golfCourseId: string | null;
      courses: { id: string; totalPar: number }[];
    };
    expect(linked.golfClubId).toBeNull();
    expect(linked.golfCourseId).toBe(courseId);
    expect(linked.courses.map(c => c.id)).toEqual([courseId]);
    expect(linked.courses[0].totalPar).toBe(36);

    // Anonymous read: the public reference surface.
    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const anon = await anonCtx.request.get(`/api/clubs/${clubId}/venues`);
      expect(anon.status()).toBe(200);
      const list = (await anon.json()).venues as { id: string; courses: { id: string }[] }[];
      expect(list.find(v => v.id === venue.id)?.courses[0]?.id).toBe(courseId);

      // The club page (anonymous) shows the Courses section and no site
      // link yet (no published site).
      const page = await anonCtx.newPage();
      await page.goto(`/club/${clubId}`);
      const section = page.getByRole('region', { name: 'Courses' });
      await expect(section).toBeVisible({ timeout: 20_000 });
      await expect(section.getByText(`QA Links ${stamp}`)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Public site →' })).toHaveCount(0);

      // Expanding the card mounts the info card with the scorecard table.
      await section.getByRole('button', { name: new RegExp(`QA Links ${stamp}`) }).click();
      await expect(section.getByText('Par')).toBeVisible({ timeout: 10_000 });
    } finally {
      await anonCtx.close();
    }

    // A foreign venue id 404s (the org-column filter is the security line).
    res = await ownerApi.patch(`/api/clubs/${clubId}/venues/00000000-0000-4000-8000-000000000000`, {
      data: { golfCourseId: null },
    });
    expect(res.status(), await readErrorBody(res)).toBe(404);

    // Publish a site → the club page gains its "Public site →" door; the
    // owner also sees "Manage club →".
    res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/club/${clubId}`);
      await expect(page.getByRole('link', { name: 'Public site →' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('link', { name: 'Manage club →' })).toHaveAttribute(
        'href',
        `/app/org/club/${clubId}`
      );

      // Console: the Venues & courses section lists the linked course and
      // stays usable at 375px.
      await page.goto(`/app/org/club/${clubId}`);
      const venuesSection = page.getByRole('region', { name: 'Venues and courses' });
      await expect(venuesSection).toBeVisible({ timeout: 20_000 });
      await expect(venuesSection.getByText(`QA Links ${stamp}`)).toBeVisible();
      await expect(venuesSection.getByRole('button', { name: 'Unlink course' })).toBeVisible();
      await page.setViewportSize({ width: 375, height: 812 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

      // Unlink from the console → the section drops the course.
      await venuesSection.getByRole('button', { name: 'Unlink course' }).click();
      await expect(venuesSection.getByRole('button', { name: 'Link golf course' })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await ownerCtx.close();
    }

    const after = await ownerApi.get(`/api/clubs/${clubId}/venues`);
    const afterList = (await after.json()).venues as { id: string; courses: unknown[] }[];
    expect(afterList.find(v => v.id === venue.id)?.courses).toEqual([]);

    // Delete the venue (member still 403).
    res = await memberApi.delete(`/api/clubs/${clubId}/venues/${venue.id}`);
    expect(res.status()).toBe(403);
    res = await ownerApi.delete(`/api/clubs/${clubId}/venues/${venue.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
  } finally {
    await memberApi.dispose();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('club_id', clubId);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
  }
});
