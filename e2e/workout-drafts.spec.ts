import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Drafts round PR 5 (Oct 2026): workouts follow the same rule. No 6 h
// auto-complete; an unfinished workout stays in progress (the prompt, Drafts);
// a finished workout with no share decision is a DRAFT — Drafts offers Share
// and Keep private; either records the decision and the draft is gone.

test('workout drafts: finished-undecided in Drafts → Keep private; a live one → Finish from the prompt → the share step', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(150_000);
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    // A finished workout nobody decided on: a draft.
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.status(), await readErrorBody(started)).toBe(201);
    const undecided = (await started.json()).session.id as string;
    ids.push(undecided);
    const done = await api.patch(`/api/workouts/${undecided}`, { data: { title: `QA Draft Workout ${Date.now()}`, finish: { endedAt: new Date().toISOString() } } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);

    await page.goto('/athlete/drafts');
    const row = page.locator(`[data-draft-row="workout:${undecided}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute('data-draft-state', 'draft');
    await expect(row.locator('[data-draft-share]')).toBeVisible();
    await row.locator('[data-draft-keep-private]').click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    const read = await api.get(`/api/workouts/${undecided}`);
    expect(read.ok(), await readErrorBody(read)).toBe(true);
    expect((await read.json()).session.share_decided_at).toBeTruthy();

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
