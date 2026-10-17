import { test, expect, type BrowserContext, type Page } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Training fixes PR 2 (Oct 17 2026), Tom: a posted workout's set images open
// the app's own viewer over the post (they opened a bare image in a new
// window; in the installed app it could not be closed), and they are laid out
// anew — a single exercise is ONE bordered card with each set's images on the
// right (several = a stack with "+N"); a circuit's images sit under their
// round, inside its card. Same-origin public images stand in for photos.

const G = '6c0a3d55-0000-4000-8000-00000000c17e';
const shot = (path: string) => ({ url: path, type: 'image' });
const set = (n: number, media: Array<{ url: string; type: string }> = []) => ({
  setNumber: n, reps: 8, weight: 95, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media,
});

async function setImages(page: Page, context: BrowserContext) {
  const api = await apiAs('state.json');
  const title = `QA Set Photos ${Date.now()}`;
  let workoutId = '';
  let postId: string | null = null;
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: Date.now(), exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, [shot('/logo.png')]), set(2), set(3, [shot('/icon-192.png'), shot('/icon-512.png'), shot('/og-image.png')])] },
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
    await page.locator('[data-share-done="post"]').click();
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id, { timeout: 20_000 }).toBeTruthy();
    postId = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id as string;

    // ── The feed card's details ────────────────────────────────────────────
    await page.goto('/feed');
    const card = page.locator('[data-testid="post-card"]').filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Details' }).click();

    // A single exercise is one bordered card; each set's images on its row's right.
    const bench = card.locator('[data-post-exercise-card]').filter({ hasText: 'Bench Press' });
    await expect(bench).toHaveCount(1, { timeout: 20_000 });
    await expect(bench.locator('[data-post-set-row]')).toHaveCount(3);
    await expect(bench.locator('[data-post-set-row="1"] [data-set-image-stack]')).toHaveAttribute('data-set-image-stack', '1');
    await expect(bench.locator('[data-post-set-row="2"] [data-set-image-stack]')).toHaveCount(0);
    const stack = bench.locator('[data-post-set-row="3"] [data-set-image-stack]');
    await expect(stack).toHaveAttribute('data-set-image-stack', '3');
    await expect(stack.locator('[data-set-image-more]')).toHaveText('+2');
    const row = (await bench.locator('[data-post-set-row="3"]').boundingBox())!;
    const box = (await stack.boundingBox())!;
    expect(box.x + box.width, 'the stack sits at the row\'s right edge').toBeGreaterThan(row.x + row.width - 4);

    // The circuit: each round's images under the round, inside the card.
    const circuit = card.locator('[data-post-group-card="circuit"]');
    await expect(circuit.locator('[data-rounds-slide="1"] [data-post-round-images="1"] [data-set-image-stack]')).toHaveCount(2);
    await circuit.locator('[data-rounds-dot="2"]').click();
    await expect(circuit.locator('[data-rounds-current]')).toContainText('2');
    await expect(circuit.locator('[data-rounds-slide="2"] [data-post-round-images="2"] [data-set-image-stack]')).toHaveCount(1);

    // A tap opens the viewer over the post — the same tab, no new page.
    const pagesBefore = context.pages().length;
    await stack.click();
    const viewer = page.getByRole('dialog', { name: 'Media viewer' });
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('Bench Press · Set 3');
    expect(context.pages().length, 'no new window').toBe(pagesBefore);
    // Next walks the workout's images: set 3's second, then on.
    await viewer.getByRole('button', { name: 'Next' }).click();
    await expect(viewer).toContainText('Bench Press · Set 3');
    await viewer.getByRole('button', { name: 'Next' }).click();
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
    const roundShot = modal.locator('[data-post-round-images="1"] [data-set-image-stack]').first();
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

const NAME = 'set images: one card per exercise with a stack on the right; circuit images under their round; the in-app viewer, never a new window';

test(NAME, async ({ page, context }) => {
  test.setTimeout(180_000);
  await setImages(page, context);
});

test(`${NAME} @mobile`, { tag: '@mobile' }, async ({ page, context }) => {
  test.setTimeout(180_000);
  await setImages(page, context);
});
