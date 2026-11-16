import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';

// Training's timeline ("one wave", phase 2, Nov 2026): History opens on the
// years; Year → Month → Week → the week's sessions, each level its own address,
// Back walks up. A visitor's counts never include a hidden or undecided workout.

test('the timeline: years → a year\'s months → a month\'s weeks → a week\'s sessions, Back walks up; a visitor never counts a hidden or undecided workout @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createQaUser({ displayName: 'Tia Timeline', firstName: 'Tia', lastName: 'Timeline' });
  const visitor = await createQaUser({ displayName: 'Vic Visitor', firstName: 'Vic', lastName: 'Visitor' });
  const admin = adminClient();
  const ownerState = await mintStorageState(owner);
  const visitorState = await mintStorageState(visitor);
  const ownerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: ownerState, extraHTTPHeaders: bypassHeaders() });
  const visitorApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: visitorState, extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: visitorState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    const { error: visErr } = await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id);
    expect(visErr, visErr?.message).toBeNull();

    // Fixed days at noon UTC (the same calendar day in any zone the suite runs in). Nov 10 2025 is a Monday.
    const decided = new Date().toISOString();
    const row = (day: string, title: string, extra: Record<string, unknown> = {}) => {
      const started = `${day}T12:00:00.000Z`;
      return { profile_id: owner.id, title, status: 'completed', source: 'manual', started_at: started, ended_at: new Date(Date.parse(started) + 1800_000).toISOString(), duration_seconds: 1800, last_activity_at: started, share_decided_at: decided as string | null, profile_hidden_at: null as string | null, ...extra };
    };
    const { data: inserted, error: insErr } = await admin.from('workout_sessions').insert([
      row('2025-11-10', 'QA tl A', { effort: 6 }),
      row('2025-11-12', 'QA tl B'),
      row('2025-11-30', 'QA tl C'),
      row('2025-12-01', 'QA tl D'),
      row('2025-03-05', 'QA tl E'),
      row('2024-06-03', 'QA tl F'),
      row('2025-11-11', 'QA tl hidden', { profile_hidden_at: decided }),
      row('2025-11-13', 'QA tl undecided', { share_decided_at: null }),
      // One a minute ago: this week's, whenever the suite runs — the Overview's doors need a current week.
      { ...row('2025-01-01', 'QA tl now'), started_at: new Date(Date.now() - 60_000).toISOString(), ended_at: new Date().toISOString(), duration_seconds: 60 },
    ]).select('id, title');
    expect(insErr, insErr?.message).toBeNull();
    const idOf = (title: string) => (inserted ?? []).find(r => r.title === title)!.id as string;

    // ── The API: one narrow row a session; the visitor's seven, the owner's nine.
    const res = await visitorApi.get(`/api/profile/${owner.id}/training/timeline`);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('private, no-store');
    const seen = (await res.json()) as { sessions: Array<Record<string, unknown>>; isOwner: boolean };
    expect(seen.isOwner).toBe(false);
    expect(seen.sessions).toHaveLength(7);
    expect(seen.sessions.map(s => s.id)).not.toContain(idOf('QA tl hidden'));
    expect(seen.sessions.map(s => s.id)).not.toContain(idOf('QA tl undecided'));
    expect(Object.keys(seen.sessions[0]).sort()).toEqual(['distanceM', 'id', 'kind', 'seconds', 'startedAt', 'title']);
    expect(((await (await ownerApi.get(`/api/profile/${owner.id}/training/timeline`)).json()) as { sessions: unknown[] }).sessions).toHaveLength(9);
    expect((await visitorApi.get('/api/profile/00000000-0000-4000-8000-000000000000/training/timeline')).status()).toBe(404);
    // The Workouts privacy aspect hides it from the visitor.
    await admin.from('profiles').update({ vitals_privacy: { hidden: false, body: false, records: false, workouts: true } }).eq('id', owner.id);
    const hid = (await (await visitorApi.get(`/api/profile/${owner.id}/training/timeline`)).json()) as { sessions: unknown[]; hidden?: boolean };
    expect(hid.hidden).toBe(true);
    expect(hid.sessions).toHaveLength(0);
    await admin.from('profiles').update({ vitals_privacy: null }).eq('id', owner.id);

    // ── The screen, at phone width, as the visitor: the years above the list.
    const page = await ctx.newPage();
    await page.goto(`/athlete/${owner.id}?tab=training&view=history`);
    const level = (name: string) => page.locator(`[data-timeline-level="${name}"]`);
    await expect(level('all').locator('[data-timeline-row="2025"]')).toContainText('5 sessions', { timeout: 30_000 });
    await expect(level('all').locator('[data-timeline-row="2024"]')).toContainText('1 session');
    await expect(page.locator('[data-training-history] [data-history-item]')).toHaveCount(7, { timeout: 20_000 });

    // A year: its months, and the whole list steps aside.
    await level('all').locator('[data-timeline-row="2025"]').click();
    await expect(page).toHaveURL(/tab=training&view=history&year=2025$/);
    await expect(level('year').locator('[data-timeline-heading]')).toHaveText('2025');
    await expect(level('year').locator('[data-timeline-row]')).toHaveCount(3);
    await expect(level('year').locator('[data-timeline-row="2025-11"]')).toContainText('3 sessions');
    await expect(level('year').locator('[data-timeline-tiles]')).toContainText('2 h 30 min');
    await expect(page.locator('[data-training-history]')).toHaveCount(0);

    // A month: its weeks, counted inside the month.
    await level('year').locator('[data-timeline-row="2025-11"]').click();
    await expect(page).toHaveURL(/month=2025-11$/);
    await expect(level('month').locator('[data-timeline-heading]')).toHaveText('November 2025');
    await expect(level('month').locator('[data-timeline-row="2025-11-10"]')).toContainText('Nov 10 – 16');
    await expect(level('month').locator('[data-timeline-row="2025-11-10"]')).toContainText('2 sessions');
    await expect(level('month').locator('[data-timeline-row="2025-11-24"]')).toContainText('1 session');

    // A week: its sessions, day by day — never the hidden or the undecided one.
    await level('month').locator('[data-timeline-row="2025-11-10"]').click();
    await expect(page).toHaveURL(/week=2025-11-10$/);
    await expect(level('week').locator('[data-timeline-heading]')).toHaveText('Nov 10 – 16, 2025');
    await expect(level('week').locator('[data-timeline-session]')).toHaveCount(2);
    await expect(level('week').locator(`[data-timeline-session="${idOf('QA tl A')}"]`)).toContainText('Effort 6');
    await expect(level('week').locator('[data-timeline-day]')).toHaveCount(2);
    await expect(level('week').locator('[data-timeline-tiles]')).toContainText('1 of 2 rated');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A workout row is a door: the session's own page, read-only for the visitor — its sets, no owner actions.
    await level('week').locator(`[data-timeline-session="${idOf('QA tl A')}"]`).click();
    await expect(page).toHaveURL(new RegExp(`session=${idOf('QA tl A')}$`));
    const sessionPage = level('session').locator(`[data-timeline-session-page="${idOf('QA tl A')}"]`);
    await expect(sessionPage).toContainText('QA tl A', { timeout: 20_000 });
    await expect(sessionPage).toContainText('Nov 10, 2025');
    await expect(sessionPage.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(level('session').locator('[data-timeline-up="week"]')).toHaveText('Nov 10 – 16');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goBack();
    await expect(level('week').locator('[data-timeline-heading]')).toHaveText('Nov 10 – 16, 2025');

    // Back walks up, level by level; the trail is the same way up by name.
    await page.goBack();
    await expect(level('month').locator('[data-timeline-heading]')).toHaveText('November 2025');
    await page.goBack();
    await expect(level('year').locator('[data-timeline-heading]')).toHaveText('2025');
    await level('year').locator('[data-timeline-up="all"]').click();
    await expect(level('all').locator('[data-timeline-row="2025"]')).toBeVisible();
    await expect(page.locator('[data-training-history] [data-history-item]')).toHaveCount(7, { timeout: 20_000 });

    // A week's own address opens it; a week across a month end is whole here (Nov 24 – 30 holds the 30th).
    await page.goto(`/athlete/${owner.id}?tab=training&view=history&week=2025-11-30`);
    await expect(level('week').locator('[data-timeline-heading]')).toHaveText('Nov 24 – 30, 2025', { timeout: 30_000 });
    await expect(level('week').locator('[data-timeline-session]')).toHaveCount(1);
    await level('week').locator('[data-timeline-up="month"]').click();
    await expect(level('month').locator('[data-timeline-heading]')).toHaveText('November 2025');

    // The Overview's numbers are doors: a recent session opens its page; the 12-week window's row opens that week.
    await page.goto(`/athlete/${owner.id}?tab=training`);
    const recent = page.locator('[data-training-recent-sessions] [data-session-door]');
    await expect(recent.first()).toBeVisible({ timeout: 30_000 });
    await recent.first().click(); // the newest
    await expect(level('session').locator(`[data-timeline-session-page="${idOf('QA tl now')}"]`)).toContainText('QA tl now', { timeout: 20_000 });
    await page.goBack();
    await expect(page.locator('[data-training-recent-sessions]')).toBeVisible();
    // This week's numbers are one door to the week; the 12-week window's row is the same door.
    await page.locator('[data-training-week-door]').click();
    await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}$/);
    await expect(level('week').locator(`[data-timeline-session="${idOf('QA tl now')}"]`)).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await page.locator('[data-training-streak-door]:visible').click();
    await page.locator('[data-week-door]').first().click();
    await expect(level('week').locator(`[data-timeline-session="${idOf('QA tl now')}"]`)).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await page.locator('[data-training-see-history]').click();
    await expect(level('all').locator('[data-timeline-row="2025"]')).toBeVisible({ timeout: 20_000 });

    // The hidden and the undecided workout have no page for a visitor — by address either; a blocked visitor has none at all.
    for (const title of ['QA tl hidden', 'QA tl undecided']) {
      expect((await visitorApi.get(`/api/workouts/${idOf(title)}`)).status()).toBe(404);
    }
    await page.goto(`/athlete/${owner.id}?tab=training&view=history&session=${idOf('QA tl hidden')}`);
    await expect(level('session').locator('[data-timeline-empty="session"]')).toBeVisible({ timeout: 30_000 });
    const open = await visitorApi.get(`/api/workouts/${idOf('QA tl A')}`);
    expect(open.status()).toBe(200);
    expect(open.headers()['cache-control']).toBe('private, no-store');
    expect((await ownerApi.get(`/api/workouts/${idOf('QA tl undecided')}`)).status()).toBe(200);
    const { error: blockErr } = await admin.from('user_blocks').insert({ blocker_id: owner.id, blocked_id: visitor.id });
    expect(blockErr, blockErr?.message).toBeNull();
    expect((await visitorApi.get(`/api/workouts/${idOf('QA tl A')}`)).status()).toBe(403);
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await visitorApi.dispose();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});
