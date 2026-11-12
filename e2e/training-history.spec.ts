import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';

// Training's History (Training redesign PR 4, Nov 11 2026): every workout and
// activity in ONE list, paged by a keyset cursor — past the old "last 50", and
// a visitor never receives a workout the owner hid or has not decided.

const DAY = 86_400_000;

test('History pages past twenty, groups by month, filters by kind; a visitor never gets a hidden or undecided workout @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createQaUser({ displayName: 'Hana History', firstName: 'Hana', lastName: 'History' });
  const visitor = await createQaUser({ displayName: 'Vic Visitor', firstName: 'Vic', lastName: 'Visitor' });
  const admin = adminClient();
  const ownerState = await mintStorageState(owner);
  const ownerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: ownerState, extraHTTPHeaders: bypassHeaders() });
  const visitorApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(visitor), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: ownerState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    const { error: visErr } = await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id);
    expect(visErr, visErr?.message).toBeNull();

    // 23 decided workouts over the last 45 days (two months at least), one the owner hid, one never decided.
    const now = Date.now();
    const base = (i: number, title: string) => {
      const started = new Date(now - (i * 2 + 1) * DAY).toISOString();
      return { profile_id: owner.id, title, status: 'completed', source: 'manual', started_at: started, ended_at: new Date(Date.parse(started) + 1800_000).toISOString(), duration_seconds: 1800, last_activity_at: started };
    };
    const rows = [
      ...Array.from({ length: 23 }, (_, i) => ({ ...base(i, `QA history ${i}`), share_decided_at: new Date(now).toISOString(), profile_hidden_at: null as string | null })),
      { ...base(3.5, 'QA hidden'), share_decided_at: new Date(now).toISOString(), profile_hidden_at: new Date(now).toISOString() },
      { ...base(5.5, 'QA undecided'), share_decided_at: null as string | null, profile_hidden_at: null as string | null },
    ];
    const { data: inserted, error: insErr } = await admin.from('workout_sessions').insert(rows).select('id, title');
    expect(insErr, insErr?.message).toBeNull();
    const idOf = (title: string) => (inserted ?? []).find(r => r.title === title)!.id as string;
    const hiddenId = idOf('QA hidden');
    const undecidedId = idOf('QA undecided');

    // ── The API, as a visitor: two pages, 23 sessions, each once, newest first — never the hidden or the undecided one.
    const walk = async (api: typeof visitorApi, kind = 'all') => {
      const ids: string[] = [];
      const starts: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await api.get(`/api/profile/${owner.id}/training/history?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status()).toBe(200);
        expect(res.headers()['cache-control']).toBe('private, no-store');
        const body = (await res.json()) as { items: Array<{ kind: string; id: string; startedAt: string }>; next: string | null };
        ids.push(...body.items.map(i => i.id));
        starts.push(...body.items.map(i => i.startedAt));
        cursor = body.next;
        pages += 1;
      } while (cursor && pages < 10);
      return { ids, starts, pages };
    };
    const seen = await walk(visitorApi);
    expect(seen.pages).toBe(2);
    expect(seen.ids).toHaveLength(23);
    expect(new Set(seen.ids).size).toBe(23);
    expect(seen.ids).not.toContain(hiddenId);
    expect(seen.ids).not.toContain(undecidedId);
    expect([...seen.starts].sort((a, b) => Date.parse(b) - Date.parse(a))).toEqual(seen.starts);
    // The owner has all 25.
    const own = await walk(ownerApi);
    expect(own.ids).toHaveLength(25);
    expect(own.ids).toContain(hiddenId);
    expect(own.ids).toContain(undecidedId);
    // The filter; a bad cursor; a profile that is not there.
    expect((await walk(visitorApi, 'activities')).ids).toHaveLength(0);
    expect((await walk(visitorApi, 'workouts')).ids).toHaveLength(23);
    expect((await visitorApi.get(`/api/profile/${owner.id}/training/history?cursor=nonsense`)).status()).toBe(400);
    expect((await visitorApi.get('/api/profile/00000000-0000-4000-8000-000000000000/training/history')).status()).toBe(404);
    // The week maths reads a year of workouts — the visitor's count is the 23, the owner's the 25.
    const year = (await (await visitorApi.get(`/api/profile/${owner.id}/training/history?sessions=1`)).json()) as { workouts: Array<{ id: string }>; activities: unknown[] };
    expect(year.workouts).toHaveLength(23);
    expect(year.workouts.map(w => w.id)).not.toContain(undecidedId);
    expect(((await (await ownerApi.get(`/api/profile/${owner.id}/training/history?sessions=1`)).json()) as { workouts: unknown[] }).workouts).toHaveLength(25);

    // ── The Workouts privacy aspect hides History from the visitor, never from the owner.
    const { error: privErr } = await admin.from('profiles').update({ vitals_privacy: { hidden: false, body: false, records: false, workouts: true } }).eq('id', owner.id);
    expect(privErr, privErr?.message).toBeNull();
    const hiddenRes = (await (await visitorApi.get(`/api/profile/${owner.id}/training/history`)).json()) as { items: unknown[]; hidden?: boolean };
    expect(hiddenRes.hidden).toBe(true);
    expect(hiddenRes.items).toHaveLength(0);
    expect((await walk(ownerApi)).ids).toHaveLength(25);
    await admin.from('profiles').update({ vitals_privacy: null }).eq('id', owner.id);

    // ── The screen, at phone width: the view's own address, twenty rows, months, Load more, the filter.
    const page = await ctx.newPage();
    await page.goto('/athlete?tab=training&view=history');
    const history = page.locator('[data-training-history]');
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(history.locator('[data-history-item]')).toHaveCount(20, { timeout: 20_000 });
    expect(await history.locator('[data-history-month]').count()).toBeGreaterThanOrEqual(2);
    await expect(history.locator('[data-history-month]').first().getByRole('heading')).toBeVisible();
    await history.locator('[data-training-history-more]').click();
    await expect(history.locator('[data-history-item]')).toHaveCount(25, { timeout: 20_000 });
    await expect(history.locator('[data-training-history-more]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The owner's undecided workout says so on its row.
    await expect(history.locator(`[data-workout-finish-posting="${undecidedId}"]`).first()).toBeVisible();

    await history.locator('[data-history-kind="activities"]').click();
    await expect(history.locator('[data-training-history-empty="activities"]')).toBeVisible({ timeout: 20_000 });
    await expect(history.locator('[data-history-item]')).toHaveCount(0);
    await history.locator('[data-history-kind="workouts"]').click();
    await expect(history.locator('[data-history-item="workout"]')).toHaveCount(20, { timeout: 20_000 });

    // The Overview counts the same year: its latest-sessions card is the door back here.
    await page.getByRole('tablist', { name: 'Training views' }).getByRole('tab', { name: 'Overview' }).click();
    await expect(page.locator('[data-training-recent-sessions] [data-session-kind="workout"]')).toHaveCount(3, { timeout: 20_000 });
    await page.locator('[data-training-recent-sessions]').click();
    await expect(page.locator('[data-training-history] [data-history-item]')).toHaveCount(20, { timeout: 20_000 });
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await visitorApi.dispose();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});
