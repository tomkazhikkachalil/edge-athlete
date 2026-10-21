import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Drafts round PR 5 (Oct 2026): no 6 h auto-complete; an unfinished workout
// stays in progress (the prompt, Drafts). Training fixes PR 4 (Oct 21 2026,
// Tom: "never lose a finished workout"): Finish is the RECORD — the workout
// stands in Training at once — and Post or Done is the DECISION. Until then
// it is UNPOSTED: "Finish posting" on the pill, the reopen prompt, Drafts,
// the start screen and its Training card; a visitor never sees it. The
// flow's steps live in the URL (?step=summary → ?step=preview), so Back and
// Forward move one step and a reload returns to the step with the caption.

test('workout drafts: Finish records, the steps are history entries, leaving keeps it as "Finish posting", Post decides', { tag: '@mobile' }, async ({ page, browser }) => {
  test.setTimeout(240_000);
  const api = await apiAs('state.json');
  const ids: string[] = [];
  const title = `QA Finish Steps ${Date.now()}`;
  let postId: string | null = null;
  try {
    // ── A live workout, finished on its screen ────────────────────────────
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.status(), await readErrorBody(started)).toBe(201);
    const id = (await started.json()).session.id as string;
    ids.push(id);
    await page.goto('/feed'); // somewhere to come Back to
    await page.goto(`/app/workout/${id}`);
    const titleField = page.getByRole('textbox', { name: 'Workout title' });
    await expect(titleField).toBeVisible({ timeout: 20_000 });
    await titleField.fill(title);
    await page.getByRole('button', { name: 'Finish' }).click();
    // Step 1, the questionnaire, is a history entry.
    await page.waitForURL(`**/app/workout/${id}?step=summary`, { timeout: 20_000 });
    await expect(page.locator('[data-finish-continue]')).toBeVisible();
    // Finish recorded but did NOT decide: unposted, listed as "Finish posting", a visitor's 404.
    const after = (await (await api.get(`/api/workouts/${id}`)).json()).session;
    expect(after.status).toBe('completed');
    expect(after.share_decided_at, 'Finish never stamps the decision').toBeNull();
    const drafts = await api.get('/api/drafts');
    expect(drafts.ok(), await readErrorBody(drafts)).toBe(true);
    const draftsBody = (await drafts.json()) as { drafts: Array<{ kind: string; id: string; state: string; href: string }> };
    expect(draftsBody.drafts.find(d => d.id === id)).toMatchObject({ kind: 'workout', state: 'draft', href: `/app/workout/${id}?step=preview` });
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const apiB = ctxB.request;
      const visitor = await apiB.get(`/api/workouts/${id}`);
      expect(visitor.status(), 'a visitor never sees an unposted workout').toBe(404);
    } finally {
      await ctxB.close();
    }

    // Step 2, the preview: the feed's own card, a caption; Back is the summary, Forward the preview again.
    await page.locator('[data-finish-continue]').click();
    await page.waitForURL(`**/app/workout/${id}?step=preview`, { timeout: 20_000 });
    await expect(page.locator('[data-finish-preview-card] [data-testid="post-card"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-finish-preview-card]')).toContainText(title);
    await page.locator('[data-share-caption]').fill('Great session');
    await expect(page.locator('[data-finish-preview-card]')).toContainText('Great session');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}\\?step=summary$`));
    await expect(page.locator('[data-finish-continue]')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}\\?step=preview$`));
    await expect(page.locator('[data-share-caption]')).toHaveValue('Great session');
    // Edit: back to the questionnaire; Edit workout: the editor (review — Done, no Finish); Done returns to the questionnaire.
    await page.locator('[data-finish-edit]').click();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}\\?step=summary$`));
    await page.locator('[data-finish-edit-workout]').click();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}$`));
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Finish' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}\\?step=summary$`), { timeout: 20_000 });
    // Every step was a history entry: Back is the editor, Back again the summary before it.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/app/workout/${id}\\?step=summary$`));
    await expect(page).not.toHaveURL(/\/app\/workout\/start/);

    // ── Leave to the feed: the pill and the prompt say "Finish posting"; a return lands on the step with the caption ──
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* private mode */ } });
    await page.goto(`/app/workout/${id}?step=preview`);
    await expect(page.locator('[data-share-caption]')).toHaveValue('Great session', { timeout: 20_000 });
    await page.goto('/feed');
    const prompt = page.locator(`[data-reopen-prompt="workout:${id}"]`);
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await expect(prompt).toContainText('A finished workout is waiting to be posted.');
    await expect(prompt.locator('[data-reopen-finish]')).toHaveCount(0);
    await expect(prompt.locator('[data-reopen-resume]')).toHaveText('Finish posting');
    await expect(prompt.locator('[data-reopen-discard]')).toHaveText('Delete');
    await prompt.locator('[data-reopen-later]').click();
    const pill = page.locator(`[data-resume-pill="workout:${id}"]`);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await expect(pill.locator('[data-resume-pill-metric]')).toHaveText('Finish posting');
    await expect(pill.locator('[data-resume-pill-elapsed]')).toHaveCount(0);
    // The Training card carries the tag; the start screen warns before "Start another".
    await page.goto('/athlete?tab=training');
    await expect(page.locator(`[data-training-finish-posting="${id}"]`)).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-training-recent-sessions]').click();
    await expect(page.locator(`[data-workout-finish-posting="${id}"]`).first()).toBeVisible({ timeout: 20_000 });
    await page.goto('/app/workout/start');
    await expect(page.locator(`[data-workout-start-unposted="${id}"]`)).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-workout-start-finish-posting]').click();
    await page.waitForURL(`**/app/workout/${id}?step=preview`, { timeout: 20_000 });
    await expect(page.locator('[data-share-caption]')).toHaveValue('Great session', { timeout: 20_000 });
    // A fresh landing with no step goes to the remembered step.
    await page.goto(`/app/workout/${id}`);
    await page.waitForURL(`**/app/workout/${id}?step=preview`, { timeout: 20_000 });

    // Post: the decision, the post, and Back never re-enters the flow.
    await page.locator('[data-share-done="post"]').click();
    await page.waitForURL('**/athlete', { timeout: 20_000 });
    await expect.poll(async () => (await (await api.get(`/api/workouts/${id}`)).json()).session.post_id ?? null, { timeout: 15_000 }).toBeTruthy();
    const posted = (await (await api.get(`/api/workouts/${id}`)).json()).session;
    postId = posted.post_id as string;
    expect(posted.share_decided_at).toBeTruthy();
    expect(JSON.stringify(await (await api.get('/api/drafts')).json())).not.toContain(id);
    await page.goBack();
    await expect(page).not.toHaveURL(/step=/);
    await expect(page.locator(`[data-resume-pill="workout:${id}"]`)).toHaveCount(0);

    // ── A second live workout: the prompt's Finish → the summary; the switch off → Done decides, nothing posted ──
    const live = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(live.status(), await readErrorBody(live)).toBe(201);
    const liveId = (await live.json()).session.id as string;
    ids.push(liveId);
    const again = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(again.status()).toBe(409);
    expect((await again.json()).activeSessionId).toBe(liveId);
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* private mode */ } });
    await page.goto('/feed');
    const prompt2 = page.locator(`[data-reopen-prompt="workout:${liveId}"]`);
    await expect(prompt2).toBeVisible({ timeout: 20_000 });
    await prompt2.locator('[data-reopen-finish]').click();
    await page.waitForURL(`**/app/workout/${liveId}?step=summary`, { timeout: 20_000 });
    await page.locator('[data-finish-continue]').click();
    await page.waitForURL(`**/app/workout/${liveId}?step=preview`, { timeout: 20_000 });
    await expect(page.locator('[data-feed-toggle]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-feed-toggle="on"]').click();
    await expect(page.locator('[data-share-done="done"]')).toHaveText('Done');
    await page.locator('[data-share-done="done"]').click();
    await page.waitForURL('**/athlete?tab=training', { timeout: 20_000 });
    await page.evaluate(() => localStorage.removeItem('ea:post:feed:v1'));
    await expect.poll(async () => (await (await api.get(`/api/workouts/${liveId}`)).json()).session.share_decided_at ?? null, { timeout: 15_000 }).toBeTruthy();
    expect((await (await api.get(`/api/workouts/${liveId}`)).json()).session.post_id).toBeNull();
    expect(JSON.stringify(await (await api.get('/api/drafts')).json())).not.toContain(liveId);

    // ── Delete from the preview asks first, then the workout is gone ──
    const third = await api.post('/api/workouts', { data: { mode: 'live' } });
    const thirdId = (await third.json()).session.id as string;
    ids.push(thirdId);
    const fin = await api.patch(`/api/workouts/${thirdId}`, { data: { finish: { endedAt: new Date().toISOString() } } });
    expect(fin.ok(), await readErrorBody(fin)).toBe(true);
    await page.goto(`/app/workout/${thirdId}?step=preview`);
    await page.locator('[data-finish-delete]').click({ timeout: 20_000 });
    const confirm = page.getByRole('dialog').filter({ hasText: 'Delete this workout?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("This can't be undone");
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(confirm).toHaveCount(0);
    await page.locator('[data-finish-delete]').click();
    await page.getByRole('dialog').filter({ hasText: 'Delete this workout?' }).getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL('**/athlete?tab=training', { timeout: 20_000 });
    await expect.poll(async () => (await api.get(`/api/workouts/${thirdId}`)).status(), { timeout: 15_000 }).toBe(404);
    ids.splice(ids.indexOf(thirdId), 1);

    // The owner's later Hide still works on a decided workout.
    const hidden = await api.patch(`/api/workouts/${liveId}`, { data: { hidden: true } });
    expect(hidden.ok(), await readErrorBody(hidden)).toBe(true);
    expect((await (await api.get(`/api/workouts/${liveId}`)).json()).session.profile_hidden_at).toBeTruthy();
    // `decided` must be true.
    const bad = await api.patch(`/api/workouts/${liveId}`, { data: { decided: false } });
    expect(bad.status()).toBe(400);
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => undefined);
    for (const id of ids) await api.delete(`/api/workouts/${id}`).catch(() => undefined);
    await api.dispose();
  }
});
