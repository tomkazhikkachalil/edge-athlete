import { test, expect } from './helpers/test';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';

// Golf's sport profile, the screens ("one wave", phase 3, PR 2 — Nov 2026):
// Career → Season → Round → Hole on the sport profile's own page; every step a
// link, Back walks up; a score kind opens its holes; a hidden round counts in
// the totals and is never listed for a visitor.

test('golf\'s sport profile at 375 px: career → season → a score kind\'s holes → round → hole, Back walks up; the hidden round is counted, never listed @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createQaUser({ displayName: 'Gil Golfer', firstName: 'Gil', lastName: 'Golfer' });
  const visitor = await createQaUser({ displayName: 'Vic Visitor', firstName: 'Vic', lastName: 'Visitor' });
  const admin = adminClient();
  const ctx = await browser.newContext({ storageState: await mintStorageState(visitor), viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  const own = await browser.newContext({ storageState: await mintStorageState(owner), viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    expect((await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id)).error).toBeNull();
    const round = (date: string, gross: number, extra: Record<string, unknown> = {}) => ({ profile_id: owner.id, date, course: 'QA Links', holes: 18, par: 72, gross_score: gross, is_complete: true, round_type: 'outdoor', tee: 'Blue', ...extra });
    const { data: rows, error } = await admin.from('golf_rounds').insert([
      round('2026-06-01', 82),
      round('2026-07-01', 78, { course: 'QA Dunes' }),
      round('2026-08-01', 70, { profile_hidden_at: new Date().toISOString() }),
      round('2025-05-05', 90),
    ]).select('id, date');
    expect(error, error?.message).toBeNull();
    const idOn = (date: string) => (rows ?? []).find(r => r.date === date)!.id as string;
    // A full card for June 1: pars 4-3-5 repeating; a birdie on 3, a double on 5, pars elsewhere.
    const pars = [4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4];
    const card = pars.map((par, i) => ({ round_id: idOn('2026-06-01'), hole_number: i + 1, par, strokes: i === 2 ? par - 1 : i === 4 ? par + 2 : par, putts: 2, fairway_hit: par >= 4 ? i % 2 === 0 : null, green_in_regulation: i % 3 !== 0 }));
    const { error: holeErr } = await admin.from('golf_holes').insert([...card, { round_id: idOn('2026-08-01'), hole_number: 1, par: 5, strokes: 3 }]);
    expect(holeErr, holeErr?.message).toBeNull();

    // June 1 was a shared round, open to everyone, with a photo on hole 3.
    const { data: gp, error: gpErr } = await admin.from('group_posts').insert({ creator_id: owner.id, type: 'golf_round', title: 'QA shared round', date: '2026-06-01', visibility: 'public', status: 'completed' }).select('id').single();
    expect(gpErr, gpErr?.message).toBeNull();
    expect((await admin.from('golf_rounds').update({ group_post_id: gp!.id }).eq('id', idOn('2026-06-01'))).error).toBeNull();
    expect((await admin.from('group_post_media').insert({ group_post_id: gp!.id, uploaded_by: owner.id, media_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/qa-golf/hole3.jpg`, media_type: 'image', segment_number: 3, segment_kind: 'hole' })).error).toBeNull();

    const page = await ctx.newPage();
    const base = `/athlete/${owner.id}/sport/golf`;
    await page.goto(base);
    // Career: the tiles, one row a year, the total; the hidden 70 is the best and opens nothing.
    const career = page.locator('[data-sport-level="career"]');
    await expect(career.locator('[data-sport-tiles]')).toContainText('Scoring average', { timeout: 40_000 });
    await expect(career.locator('[data-sport-tiles]')).toContainText('80');
    await expect(career.locator('[data-golf-row="2026"]')).toContainText('70');
    await expect(career.locator('[data-golf-row="2026"] [data-golf-best]')).toHaveCount(0);
    await expect(career.locator('[data-golf-row="2025"] [data-golf-best]')).toHaveText('90');
    await expect(career.locator('[data-golf-row="total"]')).toContainText('4');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Season: two listed rounds (never the hidden one), its courses, by par, the score kinds.
    await career.locator('[data-season-link="2026"]').click();
    await expect(page).toHaveURL(/\/sport\/golf\?season=2026$/);
    const season = page.locator('[data-sport-level="season"]');
    await expect(season.locator('[data-golf-rounds] [data-golf-round-link]')).toHaveCount(2, { timeout: 20_000 });
    await expect(season.locator(`[data-golf-round-link="${idOn('2026-08-01')}"]`)).toHaveCount(0);
    await expect(season.locator('[data-golf-kind-door="birdie"]')).toContainText('1');
    await expect(season.locator('[data-golf-kind-door="eagle"]')).toContainText('1'); // the hidden round's eagle counts
    // A course filters the round log; All courses brings it back.
    await season.locator('[data-golf-course="QA Dunes"]').click();
    await expect(season.locator('[data-golf-rounds] [data-golf-round-link]')).toHaveCount(1);
    await season.locator('[data-golf-course-clear]').click();
    await expect(season.locator('[data-golf-rounds] [data-golf-round-link]')).toHaveCount(2);

    // A score kind opens its holes; the hidden round's eagle is counted and has no row here.
    await season.locator('[data-golf-kind-door="birdie"]').click();
    await expect(page).toHaveURL(/season=2026&stat=birdie$/);
    await expect(season.locator('[data-golf-kind-list="birdie"] [data-golf-kind-hole]')).toHaveCount(1, { timeout: 20_000 });
    await page.goto(`${base}?season=2026&stat=eagle`);
    await expect(season.locator('[data-golf-kind-list="eagle"]')).toContainText('None in the rounds shown here', { timeout: 30_000 });
    await page.goto(`${base}?season=2026&stat=birdie`);
    await season.locator('[data-golf-kind-list="birdie"] [data-golf-kind-hole]').click();

    // The hole: its numbers; next and previous; up to the round.
    const hole = page.locator('[data-sport-level="hole"]');
    await expect(hole).toHaveAttribute('data-golf-hole', '3', { timeout: 20_000 });
    await expect(hole).toContainText('Par 5');
    await expect(hole.locator('[data-sport-tiles]')).toContainText('4 · Birdie');
    await expect(hole.locator('[data-golf-hole-media] [data-golf-media-item]')).toHaveCount(1);
    await hole.locator('[data-golf-hole-next]').click();
    await expect(page.locator('[data-sport-level="hole"]')).toHaveAttribute('data-golf-hole', '4');
    await page.goBack();
    await expect(page.locator('[data-sport-level="hole"]')).toHaveAttribute('data-golf-hole', '3');
    await page.locator('[data-golf-up="round"]').click();

    // The round: the score, the nines, the scorecard — each hole a door.
    const card18 = page.locator(`[data-golf-round="${idOn('2026-06-01')}"]`);
    await expect(card18.locator('[data-sport-tiles]')).toContainText('82 (+10)', { timeout: 20_000 });
    await expect(card18.locator('[data-golf-hole-link]')).toHaveCount(18);
    await expect(card18.locator('[data-golf-row="hole-5"] [data-golf-kind="double"]')).toHaveText('6');
    await expect(card18.locator('[data-golf-edit]')).toHaveCount(0);
    // The hole with a photo says so on the scorecard; the round shows it, with the door to its hole.
    await expect(card18.locator('[data-golf-row="hole-3"] [data-golf-hole-media-count="1"]')).toBeVisible();
    await expect(card18.locator('[data-golf-hole-media-count]')).toHaveCount(1);
    await expect(card18.locator('[data-golf-round-media] [data-golf-media-item]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await card18.locator('[data-golf-up="season"]').click();
    await expect(page.locator('[data-sport-level="season"] [data-golf-rounds]')).toBeVisible();

    // A total-only round says so; the hidden round has no page for a visitor.
    await page.goto(`${base}?season=2026&game=round:${idOn('2026-07-01')}`);
    await expect(page.locator('[data-golf-no-holes]')).toBeVisible({ timeout: 30_000 });
    await page.goto(`${base}?season=2026&game=round:${idOn('2026-08-01')}`);
    await expect(page.locator('[data-golf-round-missing]')).toBeVisible({ timeout: 30_000 });

    // The Clips tab: every photo and clip of the listed rounds; the caption is the door to its hole.
    await page.goto(`${base}?view=clips`);
    const clips = page.locator('[data-golf-clips]');
    await expect(clips.locator('[data-golf-clips-count="1"]')).toBeVisible({ timeout: 30_000 });
    await clips.locator('[data-golf-media-door]').click();
    await expect(page.locator('[data-sport-level="hole"]')).toHaveAttribute('data-golf-hole', '3', { timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The athlete: the hidden round is listed and marked, is the door to the best, and can be edited.
    const mine = await own.newPage();
    await mine.goto(base);
    await mine.locator('[data-sport-level="career"] [data-golf-row="2026"] [data-golf-best]').click({ timeout: 40_000 });
    await expect(mine.locator(`[data-golf-round="${idOn('2026-08-01')}"] [data-golf-hidden]`)).toBeVisible({ timeout: 20_000 });
    await expect(mine.locator('[data-golf-edit]')).toBeVisible();
  } finally {
    await ctx.close();
    await own.close();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});
