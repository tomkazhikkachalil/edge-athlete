import { test, expect, type Page } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Training fixes (Oct 17 2026), Tom: the screen must not turn itself off during
// a workout (the recorder already kept it on), and a long exercise name ends in
// "…" with a tap showing it whole. The browser's lock is stubbed so every
// project can see what the page asks for; a device without one runs as today.

const LONG = 'Single-arm landmine press to rotational overhead reach with a pause';
const set = (n: number) => ({ setNumber: n, reps: 8, weight: 45, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

/** A fake navigator.wakeLock that counts what the page asks for and releases. */
async function stubWakeLock(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __wl: { requests: number; released: number } };
    w.__wl = { requests: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__wl.requests++;
          const listeners: Array<() => void> = [];
          return {
            release: async () => { w.__wl.released++; listeners.forEach(l => l()); },
            addEventListener: (_t: string, l: () => void) => listeners.push(l),
          };
        },
      },
    });
  });
}

const wl = (page: Page) => page.evaluate(() => (window as unknown as { __wl: { requests: number; released: number } }).__wl);

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate(s => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function liveWorkout(exercises: Array<{ name: string; key: string }>) {
  const api = await apiAs('state.json');
  const started = await api.post('/api/workouts', { data: { mode: 'live' } });
  expect(started.ok(), await readErrorBody(started)).toBe(true);
  const startedSession = (await started.json()).session;
  const id = startedSession.id as string;
  const seeded = await api.put(`/api/workouts/${id}/entries`, {
    data: { savedAt: savedAfter(startedSession), exercises: exercises.map(e => ({ name: e.name, exerciseKey: e.key, category: 'strength', notes: null, sets: [set(1)] })) },
  });
  expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
  return { api, id };
}

test('the screen stays on through a live workout, comes back after the page returns, and sleeps at Finish @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  await stubWakeLock(page);
  const { api, id } = await liveWorkout([{ name: 'Bench Press', key: 'bench_press' }]);
  try {
    await page.goto(`/app/workout/${id}`);
    await expect(page.locator('[data-exercise-name]')).toHaveText('Bench Press', { timeout: 20_000 });
    await expect.poll(async () => (await wl(page)).requests).toBe(1);

    // Hidden (the OS drops the lock) → back: asked again, the old one let go.
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await expect.poll(async () => (await wl(page)).requests).toBe(2);
    expect((await wl(page)).released).toBe(1);

    // Finish: the screen may sleep again.
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.locator('[data-summary-duration]')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await wl(page)).released).toBe(2);
  } finally {
    await api.delete(`/api/workouts/${id}`);
    await api.dispose();
  }
});

test('leaving the workout lets the screen sleep; a device without the lock runs the workout as before @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  await stubWakeLock(page);
  const { api, id } = await liveWorkout([{ name: 'Bench Press', key: 'bench_press' }]);
  try {
    await page.goto(`/app/workout/${id}`);
    await expect.poll(async () => (await wl(page)).requests, { timeout: 20_000 }).toBe(1);
    // Leave inside the app (the session continues behind the pill): the lock goes.
    await page.getByRole('button', { name: 'Edge Athlete — go to feed' }).click();
    await expect(page).toHaveURL(/\/feed/, { timeout: 20_000 });
    await expect.poll(async () => (await wl(page)).released).toBe(1);

    // No lock at all: nothing breaks.
    await page.addInitScript(() => { Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }); });
    await page.goto(`/app/workout/${id}`);
    await expect(page.locator('[data-exercise-name]')).toHaveText('Bench Press', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Mark set complete/ })).toHaveCount(1);
  } finally {
    await api.delete(`/api/workouts/${id}`);
    await api.dispose();
  }
});

test('a long exercise name ends in "…"; a tap shows it whole, a tap elsewhere closes it; a short name does not react @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  const { api, id } = await liveWorkout([{ name: LONG, key: 'custom' }, { name: 'Squat', key: 'squat' }]);
  try {
    await page.goto(`/app/workout/${id}`);
    const long = page.locator('[data-exercise-name]', { hasText: LONG });
    const short = page.locator('[data-exercise-name]', { hasText: 'Squat' });
    await expect(long).toHaveAttribute('data-exercise-name-state', 'cut', { timeout: 20_000 });
    expect(await long.evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis');
    const cutHeight = (await long.boundingBox())!.height;

    await long.click();
    await expect(long).toHaveAttribute('data-exercise-name-state', 'open');
    await expect(long).toHaveAttribute('aria-expanded', 'true');
    expect((await long.boundingBox())!.height, 'the whole name wraps onto more lines').toBeGreaterThan(cutHeight * 1.5);

    // A tap elsewhere closes it; so does a second tap on the name.
    await page.locator('[data-exercise-card]').last().locator('..').click({ position: { x: 4, y: 4 } });
    await expect(long).toHaveAttribute('data-exercise-name-state', 'cut');
    await long.click();
    await expect(long).toHaveAttribute('data-exercise-name-state', 'open');
    await long.click();
    await expect(long).toHaveAttribute('data-exercise-name-state', 'cut');

    // A name that fits is plain text.
    await expect(short).toHaveAttribute('data-exercise-name-state', 'fits');
    expect(await short.getAttribute('role')).toBeNull();
  } finally {
    await api.delete(`/api/workouts/${id}`);
    await api.dispose();
  }
});
