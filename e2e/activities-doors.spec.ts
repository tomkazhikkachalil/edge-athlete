import { test, expect } from './helpers/test';
import { apiAs, loadQaUser } from './helpers/qa-user';

// The doors to the recorder (Live Activities PR 6): Training's header pill, the
// Activities section's link, the header's Create sheet. Reachability at
// phone width is part of parity — a surface behind a desktop-only entry
// has not shipped on mobile. Create menu redesign (Oct 13 2026): Create →
// Record Activity is a second step (Start a workout | Record activity), and a
// workout started there must be the one Training starts — proven below.

test('the recorder is reachable from Training and from Create @mobile', async ({ page }) => {
  test.setTimeout(90_000);
  const user = loadQaUser('user.json');
  await page.goto(`/athlete/${user.id}?tab=training`);
  const pill = page.locator('[data-training-record-activity]');
  await expect(pill).toBeVisible({ timeout: 20_000 });
  await pill.click();
  await expect(page).toHaveURL(/\/activities\/record$/);
  await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });

  // ?tab=activities opens Training at its Activities section: the header's pill
  // is the one Record door on that screen (Oct 9 2026 — the section's
  // duplicate link was retired).
  await page.goto(`/athlete/${user.id}?tab=activities`);
  await expect(page.locator('[data-training-record-activity]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-activities-record-link]')).toHaveCount(0);

  await page.goto('/feed');
  await page.getByRole('button', { name: 'Create' }).first().click();
  await page.locator('[data-create-record-activity]').click();
  await page.locator('[data-create-recording]').click();
  await expect(page).toHaveURL(/\/activities\/record$/);
  await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });
});

// Tom's rule: starting a workout from Create behaves exactly as starting it
// from Training — the same screen, timer, autosave, resume pill and summary.
// Both doors call useStartWorkout; this holds the OUTCOME equal: the same
// session shape, the live clock, the pill, and a second start resuming the
// open session (the 409 rule) from either door.
test('a workout started from Create is the one Training starts: same session, same screen, same pill, same resume @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const user = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const started: string[] = [];
  const sessionOf = async (id: string) => {
    const res = await api.get(`/api/workouts/${id}`);
    expect(res.ok(), await res.text()).toBe(true);
    const body = await res.json();
    return (body.session ?? body) as Record<string, unknown>;
  };
  // `mode` is the POST's parameter, not a column: a live session is an ACTIVE row.
  const shape = (s: Record<string, unknown>) => ({ status: s.status, routine_id: s.routine_id ?? null, keys: Object.keys(s).sort() });
  const idFromUrl = () => page.url().match(/\/app\/workout\/([0-9a-f-]{36})/)![1];
  // Every door lands on the start screen (Program E2): Start is the tap that makes the row.
  const throughPicker = async () => {
    await page.waitForURL('**/app/workout/start', { timeout: 20_000 });
    await page.locator('[data-workout-start]').click();
  };
  // Once a session is in progress the next page load asks "Pick up where you
  // left off?" over the page (the reopen prompt, once per app open — it waits
  // for the drafts list, so it can land seconds after the page). This test is
  // about the DOORS, so the prompt is marked "already asked this app open"
  // exactly as the host marks it (src/lib/drafts/reopen.ts reopenSeenKey).
  await page.addInitScript((key: string) => {
    try { sessionStorage.setItem(key, '1'); } catch { /* storage unavailable */ }
  }, `ea:reopen-prompt:v1:${user.id}`);
  try {
    // From Create.
    await page.goto('/feed');
    await page.getByRole('button', { name: 'Create' }).first().click();
    await page.locator('[data-create-record-activity]').click();
    await page.locator('[data-create-workout]').click();
    await throughPicker();
    await page.waitForURL(/\/app\/workout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const fromCreate = idFromUrl();
    started.push(fromCreate);
    await expect(page.locator('[data-live-clock]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-live-clock-state="running"]')).toBeVisible();
    const a = await sessionOf(fromCreate);

    // The pill on the feed names it; a second start from Create RESUMES it.
    await page.goto('/feed');
    await expect(page.locator(`[data-resume-pill="workout:${fromCreate}"]`)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Create' }).first().click();
    await page.locator('[data-create-record-activity]').click();
    await page.locator('[data-create-workout]').click();
    await throughPicker();
    await page.waitForURL(new RegExp(`/app/workout/${fromCreate}$`), { timeout: 30_000 });

    // Training resumes the same one too (the 409 rule is shared), then — once
    // it is gone — starts a fresh session of the same shape.
    await page.goto(`/athlete/${user.id}?tab=training`);
    await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
    await throughPicker();
    await page.waitForURL(new RegExp(`/app/workout/${fromCreate}$`), { timeout: 30_000 });
    expect((await api.delete(`/api/workouts/${fromCreate}`)).ok()).toBe(true);
    started.pop();

    await page.goto(`/athlete/${user.id}?tab=training`);
    await page.getByRole('button', { name: 'Start Workout', exact: true }).click();
    await throughPicker();
    await page.waitForURL(/\/app\/workout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const fromTraining = idFromUrl();
    started.push(fromTraining);
    expect(fromTraining).not.toBe(fromCreate);
    await expect(page.locator('[data-live-clock]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-live-clock-state="running"]')).toBeVisible();
    const b = await sessionOf(fromTraining);
    expect(shape(a)).toEqual(shape(b));
    expect(a.status).toBe('active');
    await page.goto('/feed');
    await expect(page.locator(`[data-resume-pill="workout:${fromTraining}"]`)).toBeVisible({ timeout: 20_000 });
  } finally {
    // Never leave the shared QA user with a live session (every workout spec
    // would meet the 409).
    for (const id of started) await api.delete(`/api/workouts/${id}`).catch(() => undefined);
    await api.dispose();
  }
});
