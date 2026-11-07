import { test, expect } from './helpers/test';
import { createQaUser, deleteQaUser, loadQaUser, apiAs, readErrorBody } from './helpers/qa-user';

// Scale fix 1 (Oct 25 2026, docs/SCALE_AUDIT.md hole 1): the live-round
// subscription is FILTERED to the round's roster (participant_id=in.(…)) and
// hears the round's joiners through group_post_participants (migration 273).
// Two things must still hold without a reload: a score written by someone
// else reaches a spectator's card, and a LATE JOINER's row — and their first
// score — reach it too (the joiner path: participants INSERT → refresh →
// resubscribe with the widened filter). A window marker proves the page
// never reloaded (a reload would make every "arrives live" claim vacuous).
// A PLAIN golf round (not an event round): an event round's card shows the
// event GROUP's members, so a group-post addition is not a column there.
test('live scores arrive on a spectator\'s card without a reload — a late joiner\'s too @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const joiner = await createQaUser({ displayName: 'Late Lou', firstName: 'Late', lastName: 'Lou' });
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  let gp: string | null = null;
  try {
    const created = await apiA.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Live Arrival ${Date.now()}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: [userB.id], golf_data: { course_name: 'QA Arrival Links', round_type: 'outdoor', holes_played: 9 } },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    gp = (await created.json()).group_post.id as string;

    const page = await ctxB.newPage();
    // Count the scorecard reads from the first byte: the page reads it once
    // and the hook must NOT read it again on mount (the seed is the sync).
    let scorecardFetches = 0;
    const count = (req: { url(): string }) => { if (req.url().includes(`/api/group-posts/${gp}/scorecard`)) scorecardFetches += 1; };
    page.on('request', count);
    await page.goto(`/live/${gp}`);
    // A plain round's live page is the quick view: a row per participant with
    // "thru N" once they have scored, and the "Participants: N" summary.
    await expect(page.getByText(/Participants:\s*2/)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500); // room for a would-be second read
    expect(scorecardFetches, 'the live page opens with ONE scorecard read (Nov 7 2026)').toBe(1);
    await page.evaluate(() => { (window as unknown as { __liveArrival?: number }).__liveArrival = 1; });
    const stillSameDocument = () => page.evaluate(() => (window as unknown as { __liveArrival?: number }).__liveArrival === 1);
    const score = (profileId: string, hole: number, strokes: number) =>
      apiA.post('/api/golf/participant-scores', { data: { group_post_id: gp, participant_scores: [{ participant_id: profileId, hole_scores: [{ hole_number: hole, strokes }] }] } });

    // 1. The creator's own score on THIS round reaches the spectator (the filtered listener).
    await expect(page.getByText(/thru 1/)).toHaveCount(0);
    const first = await score(userA.id, 1, 5);
    expect(first.ok(), await readErrorBody(first)).toBe(true);
    await expect(page.getByText(/thru 1/)).toHaveCount(1, { timeout: 20_000 });
    expect(await stillSameDocument(), 'no reload happened').toBe(true);

    // 1b. A BURST coalesces (scale round 2, Nov 7 2026): five score writes
    //     back to back are NOT five scorecard refetches on the spectator's
    //     page. The rule (refreshDelayMs): an event opens a 1.5–3 s window
    //     and no scheduled fetch lands within 3 s of the last — so a burst
    //     lasting T seconds is at most 1 + ceil(T / 3) fetches (the writes
    //     themselves take 0.5–1 s each from here through staging).
    scorecardFetches = 0; // the burst's own count (step 1's read above excluded)
    const burstStart = Date.now();
    for (let hole = 2; hole <= 6; hole += 1) {
      const r = await score(userA.id, hole, 4);
      expect(r.ok(), await readErrorBody(r)).toBe(true);
    }
    const burstMs = Date.now() - burstStart;
    await expect(page.getByText(/thru 6/)).toHaveCount(1, { timeout: 20_000 });
    // Let the window close before counting — a straggler lands within the floor.
    await page.waitForTimeout(3_500);
    page.off('request', count);
    const allowed = 1 + Math.ceil(burstMs / 3_000);
    console.log(`[live-score-arrival] burst of 5 writes over ${burstMs} ms → ${scorecardFetches} scorecard fetch(es) (rule allows ${allowed})`);
    expect(scorecardFetches, `five writes over ${burstMs} ms: at most ${allowed} refetches by the rule`).toBeLessThanOrEqual(allowed);
    expect(scorecardFetches, 'fewer refetches than writes').toBeLessThan(5);
    expect(scorecardFetches, 'the burst did refetch').toBeGreaterThanOrEqual(1);
    expect(await stillSameDocument(), 'no reload during the burst').toBe(true);

    // 2. A late joiner: the creator adds them mid-round → the participant count
    //    moves (the participants listener → refresh), then their first score
    //    arrives (the resubscribed filter now includes them).
    const added = await apiA.post(`/api/group-posts/${gp}/participants`, { data: { participant_ids: [joiner.id] } });
    expect(added.ok(), await readErrorBody(added)).toBe(true);
    await expect(page.getByText(/Participants:\s*3/)).toBeVisible({ timeout: 25_000 });
    expect(await stillSameDocument(), 'no reload after the joiner').toBe(true);
    const theirs = await score(joiner.id, 1, 4);
    expect(theirs.ok(), await readErrorBody(theirs)).toBe(true);
    // The creator is thru 6 after the burst; the joiner's row is the one "thru 1".
    await expect(page.getByText(/thru 1\b/)).toHaveCount(1, { timeout: 25_000 });
    expect(await stillSameDocument(), 'no reload after the joiner\'s score').toBe(true);
  } finally {
    await ctxB.close();
    if (gp) await apiA.delete(`/api/group-posts/${gp}`).catch(() => undefined);
    await apiA.dispose();
    await deleteQaUser(joiner.id);
  }
});
