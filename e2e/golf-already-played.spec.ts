import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, readErrorBody, type QaUser } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';

// An ALREADY-PLAYED golf round, outdoor and indoor (Nov 27 2026). Tom: rounds
// already played follow the live round. Step 1's Already played key adds a
// date to the course step and a Scores step after Players: the live scoring
// card in its batch mode, for every player. Create Post makes the round
// finished, as a draft post, and lands on its review. A finished round
// without scores can never be left behind: the Scores step and the Create
// wait for one hole, and a round whose scores could not be saved is removed.

const FLOW = '[data-step-flow="golf-round"]';
const CARD = '[data-score-card]';

const header = (flow: Locator) => flow.locator('[data-step-header]');
async function next(flow: Locator, reached: RegExp) {
  await flow.locator('[data-step-next]').click();
  await expect(header(flow)).toHaveText(reached);
}

/** YYYY-MM-DD, `days` before today, in the browser's own day. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Golf's flow, Already played pressed; indoor when asked. */
async function openPlayed(page: Page, indoor: boolean): Promise<Locator> {
  await page.goto('/feed?create=1&sport=golf');
  const flow = page.locator(FLOW);
  await expect(flow).toBeVisible({ timeout: 20_000 });
  // The defaults never change: Live and Outdoor.
  await expect(flow.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(flow.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
  await flow.getByRole('button', { name: 'Already played', exact: true }).click();
  if (indoor) await flow.getByRole('button', { name: 'Indoor' }).click();
  return flow;
}

/** A typed course, added by hand, on the course step. */
async function nameCourse(page: Page, course: string) {
  await page.getByPlaceholder(/search courses/i).fill(course);
  await page.locator('[data-course-add-manually]').click();
  await expect(page.locator('[data-course-chosen]')).toContainText(course);
}

async function roundOf(course: string, creatorId: string) {
  const { data } = await adminClient()
    .from('group_posts')
    .select('id, status, date, post_id')
    .eq('creator_id', creatorId)
    .eq('title', `Golf at ${course}`)
    .maybeSingle();
  return data as { id: string; status: string; date: string; post_id: string | null } | null;
}

async function holesOf(groupPostId: string, profileId: string) {
  const admin = adminClient();
  const { data: participant } = await admin.from('group_post_participants').select('id').eq('group_post_id', groupPostId).eq('profile_id', profileId).single();
  const { data: card } = await admin.from('golf_participant_scores').select('id').eq('participant_id', participant!.id).maybeSingle();
  if (!card) return [];
  const { data: holes } = await admin.from('golf_hole_scores').select('hole_number, strokes, putts, penalties, penalty_strokes').eq('golf_participant_id', card.id).order('hole_number');
  return holes ?? [];
}

// Both on a large screen and on the phone projects (a title ending @mobile).
for (const tag of ['', ' @mobile']) {
  test(`already played, outdoor: the date, the Scores step on the live card, Create Post to the review, Post${tag}`, async ({ page }) => {
    test.setTimeout(150_000);
    const me = loadQaUser('user.json');
    const api = await apiAs('state.json');
    const admin = adminClient();
    const course = `QA Played Links ${Date.now()}`;
    const played = daysAgo(6);
    let groupPostId = '';
    try {
      const flow = await openPlayed(page, false);
      await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);

      // The course step carries the date: today by default, never after today.
      await next(flow, /Step 2 of 7 · Course/);
      const date = page.locator('#golf-round-date');
      await expect(date).toHaveValue(daysAgo(0));
      await expect(date).toHaveAttribute('max', daysAgo(0));
      await date.fill(played);
      await nameCourse(page, course);
      await date.fill('');
      await expect(flow.locator('[data-step-next]')).toBeDisabled();
      await expect(flow.locator('[data-step-refusal]')).toHaveText('Pick the date you played');
      await date.fill(played);

      await next(flow, /Step 3 of 7 · Game format/);
      await next(flow, /Step 4 of 7 · Conditions/);
      // A finished round takes no forecast: the person says what it was like.
      await expect(flow.getByRole('button', { name: /forecast/i })).toHaveCount(0);
      await next(flow, /Step 5 of 7 · Players/);
      await expect(flow.locator('[data-round-players-heading]')).toHaveText('Round participants');
      await next(flow, /Step 6 of 7 · Scores/);

      // The Scores step: my row, nothing entered, Next waits for a hole.
      const row = flow.locator(`[data-round-score-row="${me.id}"]`);
      await expect(row).toContainText('You');
      await expect(row.locator('[data-round-score-line]')).toHaveText('No scores yet');
      await expect(flow.locator('[data-step-skip]')).toHaveCount(0);
      await expect(flow.locator('[data-step-next]')).toBeDisabled();
      await expect(flow.locator('[data-step-refusal]')).toHaveText('Enter at least one hole first');

      // The live round's card, without what belongs to a round in progress.
      await row.click();
      const card = page.locator(CARD);
      await expect(card).toBeVisible();
      await expect(card.locator('[data-scorer-status]')).toHaveCount(0);
      await expect(card.locator('[data-scorer-actions] button')).toHaveCount(1); // Penalty; no Photo, no Video
      await expect(card.locator('[data-putts-capsule]')).toBeVisible();
      await expect(card.locator('[data-dial-number]')).toHaveText('4');
      // Hole 1: a bogey with three putts. Hole 2: Next records the par shown.
      await card.locator('[data-strokes-plus]').click();
      await card.locator('[data-putts-plus]').click();
      await expect(card.locator('[data-dial-number]')).toHaveText('5');
      await expect(card.locator('[data-putts-number]')).toHaveText('3');
      await card.locator('[data-scorer-next]').click();
      await expect(card.locator('[data-scorer-next]')).toContainText('Hole 3');
      await card.locator('[data-scorer-next]').click();
      await expect(card.locator('[data-scorer-next]')).toContainText('Hole 4');
      // The X keeps what was recorded and records nothing new (hole 3 was only looked at).
      await card.getByRole('button', { name: 'Close' }).click();
      await expect(card).toHaveCount(0);
      await expect(row.locator('[data-round-score-line]')).toHaveText('2 of 18 holes · 9 · +1');
      await expect(row).toHaveAttribute('aria-label', 'Edit scores for you');

      // Reopened, the card resumes on the first hole without a score, with the others kept.
      await row.click();
      await expect(card.locator('[data-scorer-next]')).toContainText('Hole 4');
      await expect(card.locator('[data-hole-key-check]')).toHaveCount(2);
      await card.getByRole('button', { name: 'Close' }).click();

      // Create: the summary carries the date and the card; the finish is a button, not the slide.
      await next(flow, /Step 7 of 7 · Create/);
      await expect(flow.locator('[data-round-summary-row="date"]')).toContainText(played.slice(0, 4));
      await expect(flow.locator(`[data-round-player="${me.id}"] [data-round-player-score]`)).toHaveText('2 of 18 holes · 9 · +1');
      await expect(flow.locator('[data-slide-track]')).toHaveCount(0);
      await expect(flow.locator('[data-round-lamp]')).toHaveCount(0);
      const finish = flow.locator('[data-step-finish]');
      await expect(finish).toContainText('Create Post');
      await finish.click();

      // The review of a finished round, with its scorecard.
      await page.waitForURL(/\/athlete\/drafts\/[0-9a-f-]+/, { timeout: 40_000 });
      await expect(page.locator('[data-draft-review]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(course).first()).toBeVisible({ timeout: 20_000 });

      const round = await roundOf(course, me.id);
      expect(round).not.toBeNull();
      groupPostId = round!.id;
      expect(round).toMatchObject({ status: 'completed', date: played });
      expect(await holesOf(groupPostId, me.id)).toEqual([
        { hole_number: 1, strokes: 5, putts: 3, penalties: null, penalty_strokes: null },
        { hole_number: 2, strokes: 4, putts: 2, penalties: null, penalty_strokes: null },
      ]);
      // The round's record for the profile, the handicap and the stats: dated as
      // played, a nine because only front-nine holes were entered.
      await expect.poll(async () => {
        const { data } = await admin.from('golf_rounds').select('date, holes, gross_score, round_type').eq('group_post_id', groupPostId).eq('profile_id', me.id).maybeSingle();
        return data;
      }, { timeout: 15_000 }).toMatchObject({ date: played, holes: 9, gross_score: 9, round_type: 'outdoor' });
      const { data: draft } = await admin.from('posts').select('status').eq('id', round!.post_id!).single();
      expect(draft!.status).toBe('draft');

      // Post it.
      await page.locator('[data-draft-post]').click();
      await page.waitForURL(/\/feed\?post=/, { timeout: 30_000 });
      const { data: posted } = await admin.from('posts').select('status').eq('id', round!.post_id!).single();
      expect(posted!.status).toBe('published');
    } finally {
      await cleanup('golf-already-played-outdoor', [
        async () => { if (!groupPostId) groupPostId = (await roundOf(course, me.id))?.id ?? ''; },
        () => groupPostId && api.delete(`/api/group-posts/${groupPostId}?mode=delete`),
        () => groupPostId && admin.from('golf_rounds').delete().eq('group_post_id', groupPostId),
        () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
        () => api.dispose(),
      ]);
    }
  });
}

// Both on a large screen and on the phone projects (a title ending @mobile).
for (const tag of ['', ' @mobile']) {
  test(`already played, indoor on Auto 2: the card fixes the putts; a partner is scored from a tab; a penalty keeps its strokes${tag}`, async ({ page }) => {
    test.setTimeout(180_000);
    const me = loadQaUser('user.json');
    const api = await apiAs('state.json');
    const admin = adminClient();
    const stamp = Date.now();
    const course = `QA Played Bay ${stamp}`;
    const partnerName = `Robin Sim${stamp}`;
    let partner: QaUser | null = null;
    let earlier = '';
    let groupPostId = '';
    // The seeded earlier round is open: the feed offers to resume it. Say no.
    await page.addLocatorHandler(page.getByRole('heading', { name: 'Pick up where you left off?' }), async () => {
      await page.getByRole('button', { name: 'Not now' }).click();
    });
    try {
      // A partner the Players step offers on its quick add row.
      partner = await createQaUser({ displayName: partnerName, firstName: 'Robin', lastName: `Sim${stamp}` });
      expect((await admin.from('profiles').update({ visibility: 'public' }).eq('id', partner.id)).error).toBeNull();
      const before = await api.post('/api/group-posts', {
        data: { type: 'golf_round', title: `QA Earlier Bay ${stamp}`, date: new Date().toISOString().split('T')[0], participant_ids: [partner.id] },
      });
      expect(before.ok(), await readErrorBody(before)).toBe(true);
      earlier = ((await before.json()) as { group_post?: { id?: string } }).group_post?.id ?? '';

      const flow = await openPlayed(page, true);
      await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);
      await next(flow, /Step 2 of 6 · Course/);
      await expect(page.locator('#golf-round-date')).toHaveValue(daysAgo(0));
      await nameCourse(page, course);
      await page.locator('[data-tee-row="white"]').click();
      await page.locator('[data-putting-rule]').getByRole('button', { name: 'Auto 2', exact: true }).click();
      await expect(page.locator('[data-putting-rule="auto_2"]')).toBeVisible();
      await next(flow, /Step 3 of 6 · Game format/);
      await next(flow, /Step 4 of 6 · Players/);
      const quick = flow.locator(`[data-round-quick-add-person="${partner.id}"]`);
      await expect(quick).toBeVisible({ timeout: 15_000 });
      await quick.click();
      await expect(flow.locator(`[data-round-partner="${partner.id}"]`)).toBeVisible();
      await next(flow, /Step 5 of 6 · Scores/);

      // Two rows, and the rule in words.
      await expect(flow.locator('[data-round-score-row]')).toHaveCount(2);
      await expect(flow.locator('[data-round-scores-rule]')).toHaveText('Any ball on the green is holed for 2 putts.');

      // My card: the putts are the rule's, never above the strokes.
      await flow.locator(`[data-round-score-row="${me.id}"]`).click();
      const card = page.locator(CARD);
      await expect(card.locator('[data-putts-capsule]')).toHaveCount(0);
      const fixed = card.locator('[data-putts-fixed]');
      await expect(fixed.locator('[data-putts-number]')).toHaveText('2');
      await expect(fixed.locator('[data-putts-rule]')).toHaveText('Auto 2');
      for (let i = 0; i < 3; i++) await card.locator('[data-strokes-minus]').click();
      await expect(card.locator('[data-dial-number]')).toHaveText('1');
      await expect(fixed.locator('[data-putts-number]')).toHaveText('1');
      for (let i = 0; i < 5; i++) await card.locator('[data-strokes-plus]').click();
      await expect(card.locator('[data-dial-number]')).toHaveText('6');
      await expect(fixed.locator('[data-putts-number]')).toHaveText('2');
      // A two-stroke penalty on the hole.
      await card.locator('[data-scorer-actions] button').first().click();
      const entry = card.locator('[data-penalty-entry]');
      await entry.locator('select').selectOption({ index: 1 });
      await entry.locator('input').fill('2');
      await entry.getByRole('button', { name: /add/i }).click();
      await expect(card.locator('[data-scorer-actions]')).toBeVisible();

      // The partner's tab: my hole is kept, their card opens on the same hole.
      const tabs = card.locator('[data-scorer-players] [data-scorer-player]');
      await expect(tabs).toHaveCount(2);
      await tabs.nth(1).click();
      await expect(card.locator('[data-hole-key-check]')).toHaveCount(0);
      await card.locator('[data-scorer-next]').click(); // hole 1: par, 2 putts
      await expect(card.locator('[data-scorer-next]')).toContainText('Hole 3');
      await expect(card.locator('[data-hole-group]')).toHaveCount(0); // I have no score on hole 2
      await card.getByRole('button', { name: 'Close' }).click();
      await expect(card).toHaveCount(0);

      await expect(flow.locator(`[data-round-score-row="${me.id}"] [data-round-score-line]`)).toHaveText('1 of 18 holes · 6 · +2');
      await expect(flow.locator(`[data-round-score-row="${partner.id}"] [data-round-score-line]`)).toHaveText('1 of 18 holes · 4 · E');

      await next(flow, /Step 6 of 6 · Create/);
      await expect(flow.locator('[data-round-summary-row="putting"]')).toContainText('Auto 2');
      await flow.locator('[data-step-finish]').click();
      await page.waitForURL(/\/athlete\/drafts\/[0-9a-f-]+/, { timeout: 40_000 });

      const round = await roundOf(course, me.id);
      expect(round).not.toBeNull();
      groupPostId = round!.id;
      expect(round!.status).toBe('completed');
      const { data: setup } = await admin.from('golf_scorecard_data').select('round_type, putting_rule, gimme_feet, tee_color').eq('group_post_id', groupPostId).single();
      expect(setup).toEqual({ round_type: 'indoor', putting_rule: 'auto_2', gimme_feet: null, tee_color: 'white' });
      const mine = await holesOf(groupPostId, me.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ hole_number: 1, strokes: 6, putts: 2, penalty_strokes: [2] });
      expect(mine[0].penalties).toHaveLength(1);
      expect(await holesOf(groupPostId, partner.id)).toEqual([{ hole_number: 1, strokes: 4, putts: 2, penalties: null, penalty_strokes: null }]);
      // Both players have the round on record.
      await expect.poll(async () => {
        const { data } = await admin.from('golf_rounds').select('profile_id').eq('group_post_id', groupPostId);
        return (data ?? []).map(r => r.profile_id).sort();
      }, { timeout: 15_000 }).toEqual([me.id, partner.id].sort());
    } finally {
      await cleanup('golf-already-played-indoor', [
        async () => { if (!groupPostId) groupPostId = (await roundOf(course, me.id))?.id ?? ''; },
        ...[() => groupPostId, () => earlier].map(id => () => id() && api.delete(`/api/group-posts/${id()}?mode=delete`)),
        () => groupPostId && admin.from('golf_rounds').delete().eq('group_post_id', groupPostId),
        () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
        () => earlier && admin.from('group_posts').delete().eq('id', earlier),
        () => partner && deleteQaUser(partner.id),
        () => api.dispose(),
      ]);
    }
  });
}

test('already played: scores that cannot be saved leave no round behind, and the composer keeps them', async ({ page }) => {
  test.setTimeout(120_000);
  const me = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const admin = adminClient();
  const course = `QA Played Lost ${Date.now()}`;
  let attempts = 0;
  try {
    await page.route('**/api/golf/participant-scores', async route => {
      attempts += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Failed to save scores' }) });
    });
    const flow = await openPlayed(page, false);
    await next(flow, /Step 2 of 7/);
    await nameCourse(page, course);
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7/);
    await flow.locator(`[data-round-score-row="${me.id}"]`).click();
    const card = page.locator(CARD);
    await card.locator('[data-scorer-next]').click();
    await card.getByRole('button', { name: 'Close' }).click();
    await next(flow, /Step 7 of 7/);
    await flow.locator('[data-step-finish]').click();

    // Three tries, then the round is taken away and the person is told.
    await expect(page.getByText(/the round was not created/i)).toBeVisible({ timeout: 30_000 });
    expect(attempts).toBe(3);
    await expect(flow).toBeVisible();
    await expect(flow.locator('[data-step-finish]')).toBeEnabled();
    await expect(flow.locator(`[data-round-player="${me.id}"] [data-round-player-score]`)).toHaveText('1 of 18 holes · 4 · E');
    await expect.poll(async () => roundOf(course, me.id), { timeout: 15_000 }).toBeNull();

    // With the save working again, the same Create succeeds.
    await page.unroute('**/api/golf/participant-scores');
    await flow.locator('[data-step-finish]').click();
    await page.waitForURL(/\/athlete\/drafts\/[0-9a-f-]+/, { timeout: 40_000 });
    const round = await roundOf(course, me.id);
    expect(round!.status).toBe('completed');
    expect(await holesOf(round!.id, me.id)).toHaveLength(1);
  } finally {
    await cleanup('golf-already-played-lost', [
      async () => {
        const round = await roundOf(course, me.id);
        if (!round) return;
        await api.delete(`/api/group-posts/${round.id}?mode=delete`);
        await admin.from('golf_rounds').delete().eq('group_post_id', round.id);
        await admin.from('group_posts').delete().eq('id', round.id);
      },
      () => api.dispose(),
    ]);
  }
});

test('already played: the server refuses a date after today; switching back to Live drops the Scores step and never sends a score', async ({ page }) => {
  test.setTimeout(120_000);
  const me = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const admin = adminClient();
  const course = `QA Played Then Live ${Date.now()}`;
  let groupPostId = '';
  await page.addLocatorHandler(page.getByRole('heading', { name: 'Pick up where you left off?' }), async () => {
    await page.getByRole('button', { name: 'Not now' }).click();
  });
  try {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const refused = await api.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Future ${Date.now()}`, date: future, already_played: true, golf_data: { course_name: 'QA Future', round_type: 'outdoor', holes_played: 18 } },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toMatch(/not after today/);

    // Enter a score as already played, then change the mind: Live.
    const flow = await openPlayed(page, false);
    await next(flow, /Step 2 of 7/);
    await nameCourse(page, course);
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7 · Scores/);
    await flow.locator(`[data-round-score-row="${me.id}"]`).click();
    await page.locator(`${CARD} [data-scorer-next]`).click();
    await page.locator(CARD).getByRole('button', { name: 'Close' }).click();
    for (let i = 0; i < 5; i++) await flow.locator('[data-step-back]').click();
    await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);
    await flow.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);
    await next(flow, /Step 2 of 6 · Course/);
    await expect(page.locator('#golf-round-date')).toHaveCount(0);
    await next(flow, /Step 3 of 6/);
    await next(flow, /Step 4 of 6/);
    await next(flow, /Step 5 of 6 · Players/);
    await next(flow, /Step 6 of 6 · Start/);
    await expect(flow.locator('[data-round-player-score]')).toHaveCount(0);
    let scoreCalls = 0;
    page.on('request', req => { if (req.url().includes('/api/golf/participant-scores')) scoreCalls += 1; });
    const key = flow.locator('[data-slide-key]');
    await key.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 40_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    expect(scoreCalls).toBe(0);
    const { data: round } = await admin.from('group_posts').select('status, date').eq('id', groupPostId).single();
    expect(round!.status).toBe('pending');
    expect(await holesOf(groupPostId, me.id)).toEqual([]);
  } finally {
    await cleanup('golf-already-played-then-live', [
      () => groupPostId && api.delete(`/api/group-posts/${groupPostId}?mode=delete`),
      () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
      () => api.dispose(),
    ]);
  }
});
