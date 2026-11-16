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
    ]).select('id, title');
    expect(insErr, insErr?.message).toBeNull();
    const idOf = (title: string) => (inserted ?? []).find(r => r.title === title)!.id as string;

    // ── The API: one narrow row a session; the visitor's six, the owner's eight.
    const res = await visitorApi.get(`/api/profile/${owner.id}/training/timeline`);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('private, no-store');
    const seen = (await res.json()) as { sessions: Array<Record<string, unknown>>; isOwner: boolean };
    expect(seen.isOwner).toBe(false);
    expect(seen.sessions).toHaveLength(6);
    expect(seen.sessions.map(s => s.id)).not.toContain(idOf('QA tl hidden'));
    expect(seen.sessions.map(s => s.id)).not.toContain(idOf('QA tl undecided'));
    expect(Object.keys(seen.sessions[0]).sort()).toEqual(['distanceM', 'id', 'kind', 'seconds', 'startedAt', 'title']);
    expect(((await (await ownerApi.get(`/api/profile/${owner.id}/training/timeline`)).json()) as { sessions: unknown[] }).sessions).toHaveLength(8);
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
    await expect(page.locator('[data-training-history] [data-history-item]')).toHaveCount(6, { timeout: 20_000 });

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

    // Back walks up, level by level; the trail is the same way up by name.
    await page.goBack();
    await expect(level('month').locator('[data-timeline-heading]')).toHaveText('November 2025');
    await page.goBack();
    await expect(level('year').locator('[data-timeline-heading]')).toHaveText('2025');
    await level('year').locator('[data-timeline-up="all"]').click();
    await expect(level('all').locator('[data-timeline-row="2025"]')).toBeVisible();
    await expect(page.locator('[data-training-history] [data-history-item]')).toHaveCount(6, { timeout: 20_000 });

    // A week's own address opens it; a week across a month end is whole here (Nov 24 – 30 holds the 30th).
    await page.goto(`/athlete/${owner.id}?tab=training&view=history&week=2025-11-30`);
    await expect(level('week').locator('[data-timeline-heading]')).toHaveText('Nov 24 – 30, 2025', { timeout: 30_000 });
    await expect(level('week').locator('[data-timeline-session]')).toHaveCount(1);
    await level('week').locator('[data-timeline-up="month"]').click();
    await expect(level('month').locator('[data-timeline-heading]')).toHaveText('November 2025');
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await visitorApi.dispose();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});
