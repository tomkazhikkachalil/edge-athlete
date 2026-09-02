import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaChild,
  createQaUser,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody,
  resetRateBucket,
} from './helpers/qa-user';

// Golf sites, part 3 (phase 6e S3): the course fills itself. A club's
// course page shows the course record, scoring average by tee, hardest
// holes and recent rounds from MEMBERS' PUBLIC rounds — the feed's
// two-key rule (a public post on the round AND a public profile), names
// masked, supervised athletes omitted, log-only rounds never shown. The
// club home carries a one-line strip. Rounds are seeded straight into
// golf_rounds/golf_holes/posts (the frozen composer is never driven).

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

test('course stats: two-key rule (public post + public profile), masked record, hardest holes, recent rounds, club strip; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // "Edge Bravo" — made PUBLIC below
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const alpha = await createQaUser({ firstName: 'Priv', lastName: 'Ate', displayName: 'Priv Ate' }); // stays PRIVATE

  const stamp = Date.now();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Stats Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(owner.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-stats-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner' },
    { club_id: clubId, profile_id: alpha.id, role: 'member' },
    ...(childId ? [{ club_id: clubId, profile_id: childId, role: 'member' }] : []),
  ]);
  const { data: prevVis } = await admin.from('profiles').select('visibility').eq('id', owner.id).single();
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id);

  const holes = Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 }));
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-stats-${stamp}`,
      name: `QA Stats Nine ${stamp}`,
      total_par: 36,
      holes_count: 9,
      section_kind: 'nine',
      hole_data: holes,
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  await admin.from('venues').insert({ club_id: clubId, name: `QA Stats Venue ${stamp}`, golf_course_id: courseId });

  const today = new Date().toISOString().slice(0, 10);
  const roundIds: string[] = [];
  const postIds: string[] = [];
  const seed = async (
    profileId: string,
    strokes: number[],
    post: 'public' | 'private' | 'none',
    date = today
  ) => {
    const { data: r } = await admin
      .from('golf_rounds')
      .insert({
        profile_id: profileId,
        date,
        course: `QA Stats Nine ${stamp}`,
        course_id: courseId,
        tee: 'white',
        holes: 9,
        par: 36,
        gross_score: strokes.reduce((a, b) => a + b, 0),
        is_complete: true,
        round_type: 'outdoor',
      })
      .select('id')
      .single();
    const roundId = r!.id as string;
    roundIds.push(roundId);
    await admin.from('golf_holes').insert(strokes.map((s, i) => ({ round_id: roundId, hole_number: i + 1, par: 4, strokes: s })));
    if (post !== 'none') {
      const { data: p } = await admin
        .from('posts')
        .insert({ profile_id: profileId, caption: `QA ${stamp}`, visibility: post, status: 'published', sport_key: 'golf', round_id: roundId })
        .select('id')
        .single();
      postIds.push(p!.id as string);
    }
    return roundId;
  };
  // Owner (public profile): 41 public post (IN), 38 private post (OUT), 44 no post (OUT).
  // Hole 3 is the hard one: 7 on every visible round. Five visible rounds
  // are needed for the hardest-hole minimum — the owner posts five publics.
  await seed(owner.id, [5, 4, 7, 4, 5, 4, 4, 4, 4], 'public', '2026-08-01'); // 41
  await seed(owner.id, [4, 4, 7, 4, 4, 4, 4, 4, 4], 'public', '2026-08-08'); // 39
  await seed(owner.id, [5, 5, 7, 4, 5, 4, 5, 4, 4], 'public', '2026-08-15'); // 43
  await seed(owner.id, [4, 4, 7, 4, 5, 4, 4, 4, 4], 'public', '2026-08-22'); // 40
  await seed(owner.id, [4, 5, 7, 4, 4, 4, 4, 4, 4], 'public', today); // 40
  await seed(owner.id, [4, 4, 4, 4, 4, 4, 5, 4, 5], 'private'); // 38 — private post
  await seed(owner.id, [5, 5, 5, 5, 5, 5, 5, 5, 4], 'none'); // 44 — log only
  // Alpha (PRIVATE profile): a public post — still OUT.
  await seed(alpha.id, [4, 4, 4, 4, 4, 4, 4, 4, 4], 'public'); // 36
  // The supervised child: a public post — OUT (never on a crawlable page).
  if (childId) await seed(childId, [4, 4, 4, 4, 4, 4, 4, 4, 3], 'public'); // 35

  const ownerApi = await apiAs('state-b.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_module', moduleKey: 'courses', enabled: true } });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const canonicalProbe = await anonCtx.request.get(`/org/${site.subdomain}`, { maxRedirects: 0 });
    const sitePath = canonicalProbe.status() === 301 ? `/${site.subdomain}` : `/org/${site.subdomain}`;
    const pageUrl = `${sitePath}/courses/${courseId}`;

    const html = await settleBody(anonCtx.request, pageUrl, 'At this course', true, 12);
    const stats = html.slice(html.indexOf('aria-label="At this course"'));
    expect(stats).toContain('5 rounds posted by members in the last year.');
    // The record is the owner's 39 — masked ("Edge B."), never the private 38, the 36, or the 35.
    expect(stats).toContain('Record 39');
    expect(stats).toMatch(/Edge B(ravo|\.)/);
    expect(stats).not.toContain('Record 38');
    expect(stats).not.toContain('Record 36');
    expect(stats).not.toContain('Record 35');
    expect(stats).not.toContain('Priv');
    expect(stats).not.toContain('Casey');
    // Scoring average over the five visible nines: (41+39+43+40+40)/5 = 40.6.
    expect(stats).toContain('40.6');
    // Hole 3 is the hardest (+3 over par on every round).
    expect(stats).toContain('Hole 3');
    expect(stats).toContain('+3');
    // Recent rounds lead with today's 40.
    expect(stats).toContain('Recent rounds');
    // The club home strip.
    const home = await settleBody(anonCtx.request, sitePath, 'rounds posted this year', true, 12);
    expect(home).toContain('5 rounds posted this year');
    expect(home).toContain('Course record 39');
    expect(home).not.toContain('Priv');

    // 375px.
    const page = await anonCtx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(pageUrl);
    await expect(page.getByRole('heading', { name: 'At this course' })).toBeVisible({ timeout: 15_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.close();
  } finally {
    await ownerApi.dispose();
    await anonCtx.close();
    await admin.from('posts').delete().in('id', postIds);
    await admin.from('golf_holes').delete().in('round_id', roundIds);
    await admin.from('golf_rounds').delete().in('id', roundIds);
    await admin.from('profiles').update({ visibility: prevVis?.visibility ?? 'private' }).eq('id', owner.id);
    await admin.from('org_sites').delete().eq('club_id', clubId);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
    await deleteQaUser(alpha.id);
    if (childId) await deleteQaUser(childId);
  }
});
