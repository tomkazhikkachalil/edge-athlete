import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Drafts round PR 5 (Oct 2026): no 6 h auto-complete; an unfinished workout
// stays in progress (the prompt, Drafts). Flow changes C2 (269, Oct 19 2026):
// Finish IS the share decision — a finished workout is never a draft, Drafts
// has no "Ready to post" row for it, and it stands on the Training tab per
// the account's privacy; the owner hides one later from its page.

test('workout drafts: a finished workout is decided, not a draft; a live one → Finish from the prompt → the share step', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(150_000);
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    // A finished workout is decided the moment it finishes: no draft row anywhere.
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.status(), await readErrorBody(started)).toBe(201);
    const undecided = (await started.json()).session.id as string;
    ids.push(undecided);
    const done = await api.patch(`/api/workouts/${undecided}`, { data: { title: `QA Draft Workout ${Date.now()}`, finish: { endedAt: new Date().toISOString() } } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);
    const read = await api.get(`/api/workouts/${undecided}`);
    expect(read.ok(), await readErrorBody(read)).toBe(true);
    expect((await read.json()).session.share_decided_at, 'Finish stamps the decision').toBeTruthy();
    const list = await api.get('/api/drafts');
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    expect(JSON.stringify(await list.json())).not.toContain(undecided);
    await page.goto('/athlete/drafts');
    await expect(page.getByRole('heading', { name: 'Ready to post' })).toHaveCount(0);
    await expect(page.locator(`[data-draft-row="workout:${undecided}"]`)).toHaveCount(0);
    // `keepPrivate` from an older client is accepted and changes nothing.
    const legacy = await api.patch(`/api/workouts/${undecided}`, { data: { keepPrivate: true } });
    expect(legacy.ok(), await readErrorBody(legacy)).toBe(true);
    // The owner's later Hide: a visitor no longer sees it; Show brings it back.
    const hidden = await api.patch(`/api/workouts/${undecided}`, { data: { hidden: true } });
    expect(hidden.ok(), await readErrorBody(hidden)).toBe(true);
    expect((await (await api.get(`/api/workouts/${undecided}`)).json()).session.profile_hidden_at).toBeTruthy();
    const shown = await api.patch(`/api/workouts/${undecided}`, { data: { hidden: false } });
    expect(shown.ok(), await readErrorBody(shown)).toBe(true);
    expect((await (await api.get(`/api/workouts/${undecided}`)).json()).session.profile_hidden_at).toBeNull();

    // A live workout: Finish from the reopen prompt → the share step → Only me.
    const live = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(live.status(), await readErrorBody(live)).toBe(201);
    const liveId = (await live.json()).session.id as string;
    ids.push(liveId);
    // A second live start answers 409 with the open one — no silent finish, however old.
    const again = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(again.status()).toBe(409);
    expect((await again.json()).activeSessionId).toBe(liveId);

    await page.context().clearCookies({ name: 'never-matches' }); // keep the session; a fresh page = the same app open
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* private mode */ } });
    await page.goto('/feed');
    const prompt = page.locator(`[data-reopen-prompt="workout:${liveId}"]`);
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await prompt.locator('[data-reopen-finish]').click();
    await page.waitForURL(`**/app/workout/${liveId}?share=1`, { timeout: 20_000 });
    // Only me (not on the feed — the share decision recorded), then Save for me.
    await page.locator('[data-choice="only_me"]').click();
    await page.locator('[data-share-done="only_me"]').click();
    await page.waitForURL('**/athlete', { timeout: 20_000 });
    await expect.poll(async () => (await (await api.get(`/api/workouts/${liveId}`)).json()).session.share_decided_at ?? null, { timeout: 15_000 }).toBeTruthy();
    const drafts = await api.get('/api/drafts');
    expect(drafts.ok(), await readErrorBody(drafts)).toBe(true);
    expect(JSON.stringify(await drafts.json())).not.toContain(liveId);
  } finally {
    for (const id of ids) await api.delete(`/api/workouts/${id}`);
    await api.dispose();
  }
});
