import { test, expect, type Page } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Workout fixes (Oct 13 2026): a circuit's rounds are a horizontal stack —
// "Round 1 of 4" and dots, one round per slide; completing the round in view
// advances; Copy previous round fills an empty round; the dots move the
// track; List view shows every round (the Oct 12 rendering) with the data
// unchanged; the finished post shows the group as a compact swipe card with
// the volume line that expands on tap; a workout without groups renders
// its "Set N" lines as before.

const G = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const empty = (n: number) => ({ setNumber: n, reps: null, weight: null, weightUnit: null, durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });
const circuitMember = (name: string, exerciseKey: string) => ({ name, exerciseKey, category: 'strength', notes: null, groupId: G, groupKind: 'circuit', groupRounds: 4, sets: [empty(1), empty(2), empty(3), empty(4)] });

async function groupHeight(page: Page): Promise<number> {
  const box = await page.locator('[data-exercise-group]').boundingBox();
  return box?.height ?? 0;
}

test('rounds as a swipe: one round per slide, auto-advance, Copy previous round, the dots, List view, and the post’s compact group card @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(240_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  let postId: string | null = null;
  const title = `QA swipe ${Date.now()}`;
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: savedAfter(startedSession), exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [{ ...empty(1), reps: 5, weight: 100, weightUnit: 'lbs' }, empty(2)] },
        circuitMember('Squat', 'squat'),
        circuitMember('Push-Ups', 'push_ups'),
        circuitMember('Lunges', 'lunges'),
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
    // The title before the page opens: the editor posts the title it loaded.
    const titled = await api.patch(`/api/workouts/${workoutId}`, { data: { title } });
    expect(titled.ok(), await readErrorBody(titled)).toBe(true);

    await page.goto(`/app/workout/${workoutId}`);
    const group = page.locator('[data-exercise-group]');
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group).toHaveAttribute('data-group-view', 'swipe');
    await expect(group).toHaveAttribute('data-group-rounds', '4');
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '1');
    await expect(group.locator('[data-rounds-dot]')).toHaveCount(4);
    await expect(group.locator('[data-rounds-hint]')).toBeVisible();
    // One round per slide: the active slide holds the three members, one row each.
    const slide1 = group.locator('[data-rounds-slide="1"][data-rounds-active]');
    await expect(slide1).toHaveCount(1);
    await expect(slide1.locator('[data-exercise-card]')).toHaveCount(3);
    await expect(slide1.getByLabel('reps')).toHaveCount(3);
    await expect(slide1.getByText('R1')).toHaveCount(3);
    await expect(slide1.locator('[data-group-copy-round]')).toHaveCount(0);
    const swipeHeight = await groupHeight(page);

    // Round 1: reps (and a weight on Squat) on every member, each marked complete → the track advances to round 2.
    for (let i = 0; i < 3; i++) {
      const card = slide1.locator('[data-exercise-card]').nth(i).locator('..');
      await card.getByLabel('reps').fill('10');
      if (i === 0) await card.getByLabel('wt').fill('50');
      await card.getByRole('button', { name: 'Mark set complete' }).click();
    }
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '2', { timeout: 10_000 });
    await expect(group.locator('[data-group-round]')).toHaveAttribute('data-group-round', '2');
    const slide2 = group.locator('[data-rounds-slide="2"][data-rounds-active]');
    await expect(slide2).toHaveCount(1);
    await expect.poll(async () => {
      const b = await group.locator('[data-rounds-slides]').evaluate(el => ({ left: el.scrollLeft, width: el.clientWidth }));
      return Math.abs(b.left - b.width) < 4;
    }, { timeout: 10_000 }).toBe(true);
    // The hint goes for good on dismiss.
    await group.locator('[data-rounds-hint-dismiss]').click();
    await expect(group.locator('[data-rounds-hint]')).toHaveCount(0);

    // Copy previous round: round 2 takes round 1's values — no completion.
    const copy = slide2.locator('[data-group-copy-round="2"]');
    await expect(copy).toBeEnabled();
    await copy.click();
    await expect(slide2.getByLabel('reps').first()).toHaveValue('10');
    await expect(slide2.getByLabel('wt').first()).toHaveValue('50');
    await expect(copy).toBeDisabled();
    await expect.poll(async () => {
      const s = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
      const squat = s.exercises.find((e: { name: string }) => e.name === 'Squat');
      const lunges = s.exercises.find((e: { name: string }) => e.name === 'Lunges');
      return squat && lunges ? `${squat.sets[0].reps}:${squat.sets[0].completed_at ? 'done' : 'open'}|${squat.sets[1].reps}:${squat.sets[1].weight}:${squat.sets[1].completed_at ? 'done' : 'open'}|${lunges.sets[1].reps}:${lunges.sets[1].completed_at ? 'done' : 'open'}` : '';
    }, { timeout: 15_000 }).toBe('10:done|10:50:open|10:open');

    // The dots move the track (scrollLeft, never the page). The click is DISPATCHED:
    // Playwright's own click re-scrolls the page when a target sits under the sticky
    // header (its hit-target retry), which is the harness moving, not the app.
    const dot4 = group.locator('[data-rounds-dot="4"]');
    await dot4.scrollIntoViewIfNeeded();
    const pageYBefore = await page.evaluate(() => window.scrollY);
    await dot4.dispatchEvent('click');
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '4');
    await expect(group.locator('[data-rounds-slide="4"][data-rounds-active]')).toHaveCount(1);
    await expect.poll(async () => {
      const b = await group.locator('[data-rounds-slides]').evaluate(el => ({ left: el.scrollLeft, width: el.clientWidth }));
      return Math.abs(b.left - 3 * b.width) < 4;
    }, { timeout: 10_000 }).toBe(true);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - pageYBefore)).toBeLessThan(2);
    await group.locator('[data-rounds-dot="2"]').click();
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '2');

    // List view: every round visible, the data unchanged, the card far taller.
    await group.locator('[data-group-menu]').click();
    await page.locator('[data-menu-item="view"]').click();
    await expect(group).toHaveAttribute('data-group-view', 'list');
    await expect(group.locator('[data-rounds-track]')).toHaveCount(0);
    await expect(group.locator('[data-exercise-card]')).toHaveCount(3);
    const squatCard = group.locator('[data-exercise-card]').first().locator('..');
    await expect(squatCard.getByLabel('reps')).toHaveCount(4);
    await expect(squatCard.getByLabel('reps').nth(0)).toHaveValue('10');
    await expect(squatCard.getByLabel('reps').nth(1)).toHaveValue('10');
    await expect(squatCard.getByLabel('reps').nth(2)).toHaveValue('');
    await expect(group.getByText('R4')).toHaveCount(3);
    const listHeight = await groupHeight(page);
    // Three members × three more rows: the list is hundreds of pixels taller than one round.
    expect(listHeight - swipeHeight, `list ${listHeight} vs swipe ${swipeHeight}`).toBeGreaterThan(300);
    // The preference survives a reload; Swipe view comes back from the menu.
    await page.reload();
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group).toHaveAttribute('data-group-view', 'list');
    await expect(group.locator('[data-rounds-hint]')).toHaveCount(0);
    await group.locator('[data-group-menu]').click();
    await page.locator('[data-menu-item="view"]').click();
    await expect(group).toHaveAttribute('data-group-view', 'swipe');
    // Back in swipe view the first incomplete round (2) is in view; the hint stays dismissed.
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '2');
    await expect(group.locator('[data-rounds-hint]')).toHaveCount(0);

    // Finish → post: the post's Details show the group as a compact swipe card with its volume.
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20_000 });
    await page.locator('[data-share-done="post"]').click();
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id, { timeout: 20_000 }).toBeTruthy();
    postId = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id as string;
    // Posting takes the athlete to their profile; let that land first, or
    // WebKit cuts the next navigation short (Oct 19 2026 prod probe).
    await page.waitForURL('**/athlete', { timeout: 20_000 });
    await page.goto('/feed');
    const card = page.locator('[data-testid="post-card"]').filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Details' }).click();
    const groupCard = card.locator('[data-post-group-card="circuit"]');
    await expect(groupCard).toBeVisible({ timeout: 20_000 });
    await expect(groupCard).toHaveAttribute('data-post-group-expanded', 'false');
    await expect(groupCard).toContainText('Circuit · 4 rounds');
    await expect(groupCard).toContainText('1,000 lbs'); // Squat 10 × 50 on rounds 1 and 2
    await expect(groupCard.locator('[data-rounds-dot]')).toHaveCount(4);
    await expect(groupCard.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '1');
    await expect(groupCard.locator('[data-rounds-slide="1"]')).toContainText('Squat');
    await expect(groupCard.locator('[data-rounds-slide="1"]')).toContainText('10 reps × 50 lbs');
    // The single exercise keeps its Set lines.
    await expect(card.getByText('Set 1', { exact: false }).first()).toBeVisible();
    const compact = (await groupCard.boundingBox())?.height ?? 0;
    await groupCard.getByRole('button', { expanded: false }).first().click();
    await expect(groupCard).toHaveAttribute('data-post-group-expanded', 'true');
    await expect(groupCard.locator('[data-post-group-list]')).toBeVisible();
    await expect(groupCard.locator('[data-post-group-list]')).toContainText('Round 4');
    const expanded = (await groupCard.boundingBox())?.height ?? 0;
    expect(expanded, `expanded ${expanded} vs compact ${compact}`).toBeGreaterThan(compact * 1.5);
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => undefined);
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});

// The desktop twin: the arrows (hidden below lg) move the track.
test('on a large screen the arrows move between rounds', async ({ page }) => {
  test.setTimeout(120_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, { data: { savedAt: savedAfter(startedSession), exercises: [circuitMember('Squat', 'squat'), circuitMember('Push-Ups', 'push_ups')] } });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
    await page.goto(`/app/workout/${workoutId}`);
    const group = page.locator('[data-exercise-group]');
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group.locator('[data-rounds-prev]')).toBeVisible();
    await expect(group.locator('[data-rounds-prev]')).toBeDisabled();
    await group.locator('[data-rounds-next]').click();
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '2');
    await expect(group.locator('[data-rounds-slide="2"][data-rounds-active]')).toHaveCount(1);
    await expect(group.locator('[data-rounds-prev]')).toBeEnabled();
    await group.locator('[data-rounds-next]').click();
    await group.locator('[data-rounds-next]').click();
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '4');
    await expect(group.locator('[data-rounds-next]')).toBeDisabled();
    await group.locator('[data-rounds-prev]').click();
    await expect(group.locator('[data-rounds-current]')).toHaveAttribute('data-rounds-current', '3');
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});
