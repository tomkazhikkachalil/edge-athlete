import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// The golf club page, part 2 (phase 6b A2): the public site's `courses`
// module. A venue linked to a catalog course (169) → enabling the module
// puts the course on the home page and the /courses subpage (tee sheet,
// JSON-LD), the catalog answers "Home of" for that course, disabling the
// module 404s the subpage, and the sitemap carries the subpage URL.

/** Body-content settle (ISR + SWR + multi-POP): poll until the body
 *  contains (or no longer contains) the needle. */
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

test('org site courses: link → enable → home + /courses + JSON-LD → Home of → disable 404 → sitemap; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const probe = await admin.from('venues').select('golf_course_id').limit(1);
  test.skip(!!probe.error, `venues.golf_course_id missing — run migration 169 (${probe.error?.message})`);

  const stamp = Date.now();
  const courseName = `QA Links ${stamp}`;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Golf Site Club ${stamp}`, owner_profile_id: owner.id })
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
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-site-course-${stamp}`,
      name: courseName,
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
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  // The venue link, seeded directly (A1's routes are their own spec).
  await admin
    .from('venues')
    .insert({ club_id: clubId, name: `QA Venue ${stamp}`, golf_course_id: courseId });

  const ownerApi = await apiAs('state-b.json');
  let subdomain = '';
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    subdomain = site.subdomain;

    // 169 seeds the courses row for EXISTING sites; a NEW site gets it
    // from MODULE_KEYS at create. Either way the toggle must work.
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_module', moduleKey: 'courses', enabled: true },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      // Canonical-aware: with both vanity flags on, /org/{slug} 301s.
      const canonicalProbe = await anonCtx.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const sitePath = canonicalProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

      // Home: the teaser names the course and links to the subpage.
      const home = await settleBody(anonCtx.request, sitePath, courseName, true, 12);
      expect(home).toContain(courseName);
      expect(home).toContain('par 36');
      expect(home).toContain(`${sitePath}/courses`);

      // /courses: the tee sheet (Par row + the White tee with rating/slope),
      // the map deep link, and GolfCourse structured data.
      const coursesHtml = await settleBody(anonCtx.request, `${sitePath}/courses`, 'Hole', true, 12);
      expect(coursesHtml).toContain('Hole');
      expect(coursesHtml).toContain('White');
      expect(coursesHtml).toContain('35.2 / 118');
      expect(coursesHtml).toContain(`/explore?course=${courseId}`);
      expect(coursesHtml).toContain('"GolfCourse"');
      expect(coursesHtml).toContain('rel="canonical"');
      expect(coursesHtml).toContain(`${sitePath}/courses"`);
      // The public segment stays server-only and light-only.
      expect(coursesHtml).not.toContain('data-theme');

      // 375px: the tee sheet scrolls inside its own container.
      const page = await anonCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${sitePath}/courses`);
      await expect(page.getByRole('heading', { name: 'Courses', level: 1 })).toBeVisible({
        timeout: 15_000,
      });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

      // The reverse door: the catalog knows the course's home.
      const homeRes = await anonCtx.request.get(`/api/golf/courses?id=${courseId}&home=1`);
      expect(homeRes.status()).toBe(200);
      const homeBody = (await homeRes.json()) as { homeOf?: { orgName: string; path: string } };
      expect(homeBody.homeOf?.path).toBe(sitePath);
      expect(homeBody.homeOf?.orgName).toBe(`QA Golf Site Club ${stamp}`);

      // Sitemap carries the subpage (needle is canonical-insensitive:
      // `/{slug}/courses` is a substring of both forms).
      const sitemap = await settleBody(anonCtx.request, '/sitemap.xml', `/${subdomain}/courses`, true, 12);
      expect(sitemap).toContain(`/${subdomain}/courses`);

      // Disable → the subpage no longer exists.
      res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
        data: { action: 'set_module', moduleKey: 'courses', enabled: false },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(await settle(anonCtx.request, `${sitePath}/courses`, 404, 12)).toBe(404);
    } finally {
      await anonCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('club_id', clubId);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
  }
});
