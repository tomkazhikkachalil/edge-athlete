import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Golf league depth, part 3 (phase 6d W3): the season generator. An
// organizer declares the season once (start, weeks, window, holes,
// course) and gets N weekly rounds in ONE request: dry-run first (zero
// writes), then commit (every approved entrant on every round), and a
// re-run reuses every existing week instead of duplicating it. A member
// is refused; the console expander previews before it generates, at
// 375px. Self-skips pre-172.

const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

test('season generator: dry-run writes nothing, commit creates N rounds with every entrant, re-run reuses; member 403; console at 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);
  await resetRateBucket(admin, 'org-competitions', alpha.id);

  const probe = await admin.from('contests').select('holes').limit(1);
  test.skip(!!probe.error, `contests.holes missing — run migration 172 (${probe.error?.message})`);

  const stamp = Date.now();
  const start = addDays(utcToday(), 7);
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Season Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'roster' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select().single();
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-season-${stamp}`,
      name: `QA Season Nine ${stamp}`,
      total_par: 36,
      holes_count: 9,
      section_kind: 'nine',
      hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 })),
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const { data: venue } = await admin
    .from('venues')
    .insert({ club_id: clubId, name: `QA Season Venue ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const venueId = venue!.id as string;
  // A second, UNLINKED venue: refused as a course.
  const { data: bare } = await admin
    .from('venues')
    .insert({ club_id: clubId, name: `QA Bare Venue ${stamp}` })
    .select('id')
    .single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Season League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_gross',
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  await admin.from('competition_entries').insert([
    { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
    { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    const url = `/api/clubs/${clubId}/competitions/${competitionId}/golf-season`;
    const body = { competitionId, startDate: start, weeks: 4, windowDays: 7, holes: 9, venueId, labelPattern: 'Round {n}' };

    // A member is refused; a bare venue is refused; a bad body is 400.
    let res = await alphaApi.post(url, { data: body });
    expect(res.status()).toBe(403);
    res = await ownerApi.post(url, { data: { ...body, venueId: bare!.id } });
    expect(res.status()).toBe(400);
    res = await ownerApi.post(url, { data: { ...body, weeks: 60 } });
    expect(res.status()).toBe(400);

    // Dry run (the default): 4 dry-creates, ZERO rows.
    res = await ownerApi.post(url, { data: body });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let out = await res.json();
    expect(out.dryRun).toBe(true);
    expect(out.summary).toMatchObject({ rows: 4, created: 4, reused: 0, errors: 0 });
    expect(out.report.map((r: { action: string }) => r.action)).toEqual(['dry-create', 'dry-create', 'dry-create', 'dry-create']);
    expect(out.report[0]).toMatchObject({ round: 'Round 1', playFrom: start, playTo: addDays(start, 6) });
    expect(out.report[3]).toMatchObject({ round: 'Round 4', playFrom: addDays(start, 21), playTo: addDays(start, 27) });
    let { data: rows } = await admin.from('contests').select('id').eq('competition_id', competitionId);
    expect(rows!.length).toBe(0);

    // Commit: 4 rounds with holes/window/course, 8 participants.
    res = await ownerApi.post(url, { data: { ...body, dryRun: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    out = await res.json();
    expect(out.dryRun).toBe(false);
    expect(out.summary).toMatchObject({ rows: 4, created: 4, reused: 0, errors: 0 });
    const { data: contests } = await admin
      .from('contests')
      .select('id, round, holes, play_from, play_to, venue_id, status')
      .eq('competition_id', competitionId)
      .order('play_from');
    expect(contests!.length).toBe(4);
    expect(contests![0]).toMatchObject({ round: 'Round 1', holes: 9, play_from: start, play_to: addDays(start, 6), venue_id: venueId, status: 'scheduled' });
    expect(contests![3]).toMatchObject({ round: 'Round 4', play_from: addDays(start, 21) });
    const { data: participants } = await admin
      .from('contest_participants')
      .select('id')
      .in('contest_id', contests!.map(c => c.id));
    expect(participants!.length).toBe(8);

    // Re-run with more weeks: the 4 existing are reused, 2 are new.
    res = await ownerApi.post(url, { data: { ...body, weeks: 6, dryRun: false } });
    expect(res.status()).toBe(200);
    out = await res.json();
    expect(out.summary).toMatchObject({ rows: 6, created: 2, reused: 4, errors: 0 });
    expect(out.report.map((r: { action: string }) => r.action)).toEqual(['reuse', 'reuse', 'reuse', 'reuse', 'create', 'create']);
    ({ data: rows } = await admin.from('contests').select('id').eq('competition_id', competitionId));
    expect(rows!.length).toBe(6);

    // The console at 375px: Generate is gated on a fresh Preview.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: `Season League ${stamp}` })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Generate rounds' }).click();
      await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
      await page.getByLabel('Season start').fill(addDays(start, 49));
      await page.getByLabel('Weeks').fill('2');
      await page.getByLabel('Season course').selectOption(venueId);
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText('Preview: 2 rounds')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
      // Any field change clears the preview and re-gates Generate.
      await page.getByLabel('Weeks').fill('3');
      await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText('Preview: 3 rounds')).toBeVisible({ timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(page.getByText('Generated: 3 rounds')).toBeVisible({ timeout: 15_000 });
      // The round row reads "Week 1 · 2 players" (one text node).
      await expect(page.getByText(/^Week 1 · \d+ players/).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
    ({ data: rows } = await admin.from('contests').select('id').eq('competition_id', competitionId));
    expect(rows!.length).toBe(9);
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    // S4: generated rounds publish to the calendar by default — the mirror
    // events outlive the club's cascade, so delete them explicitly.
    const { data: evs } = await admin.from('contests').select('event_id').eq('competition_id', competitionId);
    const eventIds = (evs ?? []).map(c => c.event_id).filter(Boolean) as string[];
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    if (eventIds.length) await admin.from('events').delete().in('id', eventIds);
    await admin.from('golf_courses').delete().eq('id', courseId);
  }
});
