import { test, expect, type BrowserContext, type Page } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Training: three changes (Oct 22 2026, items 2 and 3), Tom: a posted workout
// is ONE light bubble per exercise holding its name and everything for it,
// with ONE darker bubble inside holding ALL of its sets (never a bubble per
// set); a clip belongs to the EXERCISE, not the set it was taken during — the
// exercise's clips sit together at the right of the sets, previews one size
// (64 px), and the bubble grows only with more sets, never for media. A
// circuit is one outer bubble with one inner bubble per round and the round's
// clips at its right. The in-app viewer opens on a tap, never a new window
// (Oct 17). Same-origin public images stand in for photos.

const G = '6c0a3d55-0000-4000-8000-00000000c17e';
const shot = (path: string) => ({ url: path, type: 'image' });
const set = (n: number, media: Array<{ url: string; type: string }> = []) => ({
  setNumber: n, reps: 8, weight: 95, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media,
});

async function exerciseBubbles(page: Page, context: BrowserContext, phone: boolean) {
  const api = await apiAs('state.json');
  const title = `QA Set Photos ${Date.now()}`;
  let workoutId = '';
  let postId: string | null = null;
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: savedAfter(startedSession), exercises: [
        // Bench: 3 sets, clips on sets 1 and 3 (1 + 3 = 4 clips).
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, [shot('/logo.png')]), set(2), set(3, [shot('/icon-192.png'), shot('/icon-512.png'), shot('/og-image.png')])] },
        // Deadlift: 3 sets, no clips — the bubble to compare heights with.
        { name: 'Deadlift', exerciseKey: 'deadlift', category: 'strength', notes: null, sets: [set(1), set(2), set(3)] },
        // Curl: 1 set with one clip — the bubble is the tile's height, no more.
        { name: 'Curl', exerciseKey: 'bicep_curl', category: 'strength', notes: null, sets: [set(1, [shot('/logo-mark.png')])] },
        { name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, groupId: G, groupKind: 'circuit', groupRounds: 2, sets: [set(1, [shot('/logo-mark.png')]), set(2, [shot('/favicon-32.png')])] },
        { name: 'Row', exerciseKey: 'barbell_row', category: 'strength', notes: null, groupId: G, groupKind: 'circuit', groupRounds: 2, sets: [set(1, [shot('/apple-touch-icon.png')]), set(2)] },
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    await page.goto(`/app/workout/${workoutId}`);
    const titleField = page.getByRole('textbox', { name: 'Workout title' });
    await expect(titleField).toBeVisible({ timeout: 20_000 });
    await titleField.fill(title);
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20_000 });
    // The review step names the exercise and the clip, never the set.
    await expect(page.getByRole('heading', { name: 'Preview and post' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-share-clips]')).toContainText('Bench Press · clip 1');
    await expect(page.locator('[data-share-clips]')).not.toContainText(/set \d/);
    await page.locator('[data-share-done="post"]').click();
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id, { timeout: 20_000 }).toBeTruthy();
    postId = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id as string;

    // ── The feed card's details ────────────────────────────────────────────
    // Posting takes the athlete to their profile; let that land first, or
    // WebKit cuts the next navigation short (Oct 19 2026 prod probe).
    await page.waitForURL('**/athlete', { timeout: 20_000 });
    await page.goto('/feed');
    const card = page.locator('[data-testid="post-card"]').filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Details' }).click();

    // ONE outer bubble per exercise; ONE inner bubble with every set as a line.
    const bench = card.locator('[data-post-exercise-card]').filter({ hasText: 'Bench Press' });
    await expect(bench).toHaveCount(1, { timeout: 20_000 });
    await expect(bench.locator('[data-post-sets-bubble]')).toHaveCount(1);
    await expect(bench.locator('[data-post-sets-bubble]')).toHaveAttribute('data-post-sets-bubble', '3');
    await expect(bench.locator('[data-post-sets-bubble] [data-post-set-row]')).toHaveCount(3);
    // A set line carries no bubble of its own: the same background as the bubble (transparent).
    const lineBg = await bench.locator('[data-post-set-row="2"]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(lineBg, 'a set line has no background of its own').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await expect(bench.locator('[data-post-set-row]')).toHaveCount(3);

    // The exercise's clips are ONE strip at the right: 4 clips (1 + 0 + 3).
    const strip = bench.locator('[data-post-exercise-media]');
    await expect(strip).toHaveAttribute('data-post-exercise-media', '4');
    const tiles = strip.locator('[data-exercise-media-tile]:visible');
    await expect(tiles).toHaveCount(phone ? 1 : 3);
    await expect(strip.locator('[data-set-image-more]:visible')).toHaveText(phone ? '+3' : '+1');
    const tile = (await tiles.first().boundingBox())!;
    expect(Math.round(tile.height), 'a tile is 64 px').toBe(64);
    expect(Math.round(tile.width), 'a tile is 64 px wide').toBe(64);
    const inner = (await bench.locator('[data-post-sets-bubble]').boundingBox())!;
    const outer = (await bench.boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    expect(stripBox.x, 'the strip sits at the right of the sets').toBeGreaterThanOrEqual(inner.x + inner.width);
    expect(stripBox.x + stripBox.width, 'the strip ends at the card\'s padding edge').toBeGreaterThan(outer.x + outer.width - 12);
    expect(Math.round(stripBox.height), 'the strip is never taller than one tile').toBe(64);

    // The bubble grows with sets, never with media: Bench (3 sets, 4 clips)
    // is as tall as Deadlift (3 sets, no clips); Curl (1 set, 1 clip) is the
    // tile's height and no more.
    const deadlift = card.locator('[data-post-exercise-card]').filter({ hasText: 'Deadlift' });
    const deadliftInner = (await deadlift.locator('[data-post-sets-bubble]').boundingBox())!;
    expect(Math.abs(inner.height - deadliftInner.height), `Bench ${inner.height} vs Deadlift ${deadliftInner.height}`).toBeLessThanOrEqual(1);
    await expect(deadlift.locator('[data-post-exercise-media]')).toHaveCount(0);
    const curl = card.locator('[data-post-exercise-card]').filter({ hasText: 'Curl' });
    const curlInner = (await curl.locator('[data-post-sets-bubble]').boundingBox())!;
    expect(Math.round(curlInner.height), 'a one-set bubble with a clip is the tile\'s height').toBe(64);

    // The circuit: one inner bubble per round, the round's clips at its right.
    const circuit = card.locator('[data-post-group-card="circuit"]');
    await expect(circuit.locator('[data-rounds-slide="1"] [data-post-round-bubble="1"] [data-post-round-member]')).toHaveCount(2);
    await expect(circuit.locator('[data-rounds-slide="1"] [data-post-round-images="1"] [data-post-exercise-media]')).toHaveAttribute('data-post-exercise-media', '2');
    await circuit.locator('[data-rounds-dot="2"]').click();
    await expect(circuit.locator('[data-rounds-current]')).toContainText('2');
    await expect(circuit.locator('[data-rounds-slide="2"] [data-post-round-images="2"] [data-post-exercise-media]')).toHaveAttribute('data-post-exercise-media', '1');

    // A tap opens the viewer over the post — the same tab, no new page — at
    // THAT clip; the caption names the exercise, never a set.
    const pagesBefore = context.pages().length;
    await tiles.first().click();
    const viewer = page.getByRole('dialog', { name: 'Media viewer' });
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('Bench Press');
    await expect(viewer).not.toContainText(/Set \d/);
    expect(context.pages().length, 'no new window').toBe(pagesBefore);
    // Next walks the workout's clips: Bench's four (opened at the first), then Deadlift has none, Curl's one, then the circuit round by round.
    for (let i = 0; i < 3; i++) await viewer.getByRole('button', { name: 'Next' }).click();
    await expect(viewer).toContainText('Bench Press');
    await viewer.getByRole('button', { name: 'Next' }).click();
    await expect(viewer).toContainText('Curl');
    await viewer.getByRole('button', { name: 'Next' }).click();
    await expect(viewer).toContainText('Circuit · Round 1 · Squat');
    await viewer.getByRole('button', { name: 'Close media viewer' }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(/\/feed/);

    // ── The post detail modal: the viewer sits ON TOP; Escape closes only it ─
    await page.goto(`/feed?post=${postId}`);
    const modal = page.locator('[data-post-detail]');
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole('button', { name: 'Details' }).click();
    const roundShot = modal.locator('[data-post-round-images="1"] [data-exercise-media-tile="1"]').first();
    await expect(roundShot).toBeVisible({ timeout: 20_000 });
    await roundShot.click();
    await expect(page.getByRole('dialog', { name: 'Media viewer' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Media viewer' })).toContainText('Circuit · Round 1 · Squat');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Media viewer' })).toHaveCount(0);
    await expect(modal, 'the post stays open under the closed viewer').toBeVisible();
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => undefined);
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
}

const NAME = 'exercise bubbles: one outer bubble per exercise, one inner bubble for all its sets, the exercise\'s clips in one strip at the right; a circuit per round; the in-app viewer';

test(NAME, async ({ page, context }) => {
  test.setTimeout(180_000);
  await exerciseBubbles(page, context, false);
});

test(`${NAME} @mobile`, { tag: '@mobile' }, async ({ page, context }) => {
  test.setTimeout(180_000);
  await exerciseBubbles(page, context, true);
});
