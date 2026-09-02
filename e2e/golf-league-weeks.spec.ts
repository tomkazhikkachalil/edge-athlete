import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaChild,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody,
  resetRateBucket,
} from './helpers/qa-user';

// Golf league depth, part 1 (phase 6d W1): the week is VISIBLE. The
// public standings payload carries a `golf` block for windowed rounds —
// the open week (window, holes, course), who has posted, per-round
// results labelled posted/final — and every route that renders the
// board (the API, the SSR /standings twin, the app org page) shows it.
// A fresh league with an open window but no completed round yet is no
// longer hidden by the rows>0 filters. Supervised athletes are omitted
// from the public rows and only counted. Rounds are seeded straight into
// golf_rounds/golf_holes (the composer is frozen). Self-skips pre-172.

const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  attempts = 8
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle)) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

test('golf league weeks: the open window, who posted, per-round results on every route; supervised omitted; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // "Edge Bravo"
  const alpha = loadQaUser('user.json'); // "Edge Alpha"
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const probe = await admin.from('contests').select('holes').limit(1);
  test.skip(!!probe.error, `contests.holes missing — run migration 172 (${probe.error?.message})`);

  const stamp = Date.now();
  const today = utcToday();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Weeks Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'roster' },
  ]);
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(owner.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-weeks-minor-${stamp}` });
    await admin.from('memberships').insert([
      { club_id: clubId, profile_id: childId, role: 'member', kind: 'follow' },
      { club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' },
    ]);
  }
  const { data: season } = await admin
    .from('seasons')
    .insert({ club_id: clubId, label: `2026 ${stamp}` })
    .select()
    .single();
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-weeks-${stamp}`,
      name: `QA Weeks Nine ${stamp}`,
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
    .insert({ club_id: clubId, name: `QA Weeks Venue ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const venueId = venue!.id as string;

  // A PUBLIC gross league (no handicap needed), first posted counts.
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Weeks League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_gross',
      config: { golf: { pick: 'first' } },
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  const entryRows = [
    { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
    { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
    ...(childId ? [{ competition_id: competitionId, profile_id: childId, status: 'approved' }] : []),
  ];
  const { data: entries } = await admin.from('competition_entries').insert(entryRows).select('id, profile_id');
  const entryIds = entries!.map(e => e.id as string);

  // Three rounds: last week (closed), this week (open, contains today), next week.
  const windows = [
    { round: 'Week 1', play_from: addDays(today, -14), play_to: addDays(today, -8) },
    { round: 'Week 2', play_from: addDays(today, -3), play_to: addDays(today, 3) },
    { round: 'Week 3', play_from: addDays(today, 4), play_to: addDays(today, 10) },
  ];
  const { data: contests } = await admin
    .from('contests')
    .insert(windows.map(w => ({ competition_id: competitionId, venue_id: venueId, holes: 9, status: 'scheduled', ...w })))
    .select('id, round');
  const contestOf = new Map(contests!.map(c => [c.round as string, c.id as string]));
  const closedId = contestOf.get('Week 1')!;
  const openId = contestOf.get('Week 2')!;
  const upcomingId = contestOf.get('Week 3')!;
  await admin.from('contest_participants').insert(
    contests!.flatMap(c => entryIds.map(entryId => ({ contest_id: c.id, entry_id: entryId, side: null })))
  );

  const insertRound = async (profileId: string, date: string, holeStrokes: number[]) => {
    const { data: r } = await admin
      .from('golf_rounds')
      .insert({
        profile_id: profileId,
        date,
        course: `QA Weeks Nine ${stamp}`,
        course_id: courseId,
        tee: 'white',
        holes: 9,
        par: 36,
        gross_score: holeStrokes.reduce((a, b) => a + b, 0),
        is_complete: true,
        round_type: 'outdoor',
        course_rating: 35.2,
        slope_rating: 118,
      })
      .select('id')
      .single();
    await admin
      .from('golf_holes')
      .insert(holeStrokes.map((strokes, i) => ({ round_id: r!.id, hole_number: i + 1, par: 4, strokes })));
    return r!.id as string;
  };
  const roundIds: string[] = [];
  // Owner: a 44 last week, a 41 this week. Alpha: nothing. Child: a 35 this week.
  roundIds.push(await insertRound(owner.id, addDays(today, -10), [5, 5, 5, 5, 5, 5, 5, 5, 4]));
  roundIds.push(await insertRound(owner.id, today, [5, 4, 5, 4, 5, 4, 5, 4, 5]));
  if (childId) roundIds.push(await insertRound(childId, today, [4, 4, 4, 4, 4, 4, 4, 4, 3]));

  const ownerApi = await apiAs('state-b.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const base = `/api/clubs/${clubId}/competitions/${competitionId}`;
    type Week = {
      id: string;
      round: string | null;
      state: string;
      holes: number;
      courseName: string | null;
      participants: number;
      posted: number;
      results: { entrant_name: string; gross: number | null; status: string }[];
    };
    type Board = { id: string; rows: unknown[]; golf?: { pick: string; currentWeekId: string | null; weeks: Week[] } };
    const readBoard = async (): Promise<Board> => {
      const apiRes = await anonCtx.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
      expect(apiRes.status()).toBe(200);
      return (await apiRes.json()).competitions.find((c: Board) => c.id === competitionId);
    };
    // BEFORE any sync: a fresh league has NO standings rows (nothing
    // recomputed yet) — and is no longer hidden for it: the golf block is
    // there with the open week and zero posted.
    let board = await readBoard();
    expect(board, 'a fresh league is present with zero rows').toBeTruthy();
    expect(board.rows.length).toBe(0);
    expect(board.golf?.currentWeekId).toBe(openId);
    expect(board.golf?.weeks[1].posted).toBe(0);

    for (const contestId of [closedId, openId]) {
      const res = await ownerApi.post(`${base}/golf-sync`, { data: { contestId } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }
    board = await readBoard();
    expect(board.golf?.pick).toBe('first');
    expect(board.golf?.currentWeekId).toBe(openId);
    expect(board.golf?.weeks.map(w => w.id)).toEqual([closedId, openId, upcomingId]);
    expect(board.golf?.weeks.map(w => w.state)).toEqual(['closed', 'open', 'upcoming']);
    const open = board.golf!.weeks[1];
    expect(open.holes).toBe(9);
    expect(open.courseName).toBe(`QA Weeks Nine ${stamp}`);
    expect(open.participants).toBe(entryIds.length);
    expect(open.posted).toBe(childId ? 2 : 1); // the child is counted…
    expect(open.results.length).toBe(1); // …but never listed
    expect(open.results[0]).toMatchObject({ gross: 41, status: 'posted' });
    expect(open.results[0].entrant_name).toMatch(/^Edge B/);
    expect(open.results[0].entrant_name).not.toMatch(UUID_TEXT);
    expect(JSON.stringify(board.golf)).not.toContain('Casey');
    expect(board.golf!.weeks[0].results[0]).toMatchObject({ gross: 44, status: 'posted' });
    expect(board.golf!.weeks[2].results).toEqual([]);

    // Confirm last week → its results read "final" and the board has a row.
    const confirm = await ownerApi.post(`${base}/golf-sync/confirm`, { data: { contestId: closedId } });
    expect(confirm.status(), await readErrorBody(confirm)).toBe(200);
    for (let i = 0; i < 6; i++) {
      board = await readBoard();
      if (board.golf?.weeks[0].results[0]?.status === 'final') break;
      await new Promise(r => setTimeout(r, 1500));
    }
    expect(board.golf!.weeks[0].results[0].status).toBe('final');
    expect(board.golf!.weeks[1].results[0].status).toBe('posted');
    expect(board.rows.length).toBeGreaterThanOrEqual(1);
    expect((board.rows[0] as { points: number | null }).points).toBe(44);

    // The SSR twin, anonymous: the week band, the label, the chips, no minor.
    // (Assert parts, never across an interpolation — SSR splits text nodes.)
    const html = await settleBody(anonCtx.request, `/club/${clubId}/standings`, 'This week');
    expect(html).toContain('This week');
    expect(html).toContain('Week 2');
    expect(html).toContain('>posted<');
    expect(html).toContain('>final<');
    expect(html).toContain('>Player<');
    expect(html).not.toContain('Casey');

    // The org page (route parity) + the console skip line names the member.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/club/${clubId}`);
      await expect(page.getByText('This week').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Week 2').first()).toBeVisible();
      let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px (org page)').toBeLessThanOrEqual(375);

      await page.goto(`/club/${clubId}/standings`);
      await expect(page.getByText('This week').first()).toBeVisible({ timeout: 20_000 });
      scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px (standings twin)').toBeLessThanOrEqual(375);

      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: `Weeks League ${stamp}` })).toBeVisible({ timeout: 20_000 });
      // Sync the open round from the console: Alpha has no round → a named skip line.
      const openRow = page.locator('li').filter({ hasText: 'Week 2' }).first();
      await openRow.getByRole('button', { name: 'Sync rounds' }).click();
      await expect(page.getByText(/Edge Alpha — no completed round/)).toBeVisible({ timeout: 15_000 });
      scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px (console)').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await anonCtx.close();
    await admin.from('golf_holes').delete().in('round_id', roundIds);
    await admin.from('golf_rounds').delete().in('id', roundIds);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
    if (childId) await deleteQaUser(childId);
  }
});
