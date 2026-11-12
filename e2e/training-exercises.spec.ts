import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// Training's Exercises view (Training redesign PR 5, Nov 11 2026): a visitor
// can see an athlete's bests for the first time — folded ONLY from sessions
// that visitor could open. A hidden or undecided workout's numbers never
// surface through a best, a chart or a session row.

const DAY = 86_400_000;
const set = (reps: number, weight: number) => ({ setNumber: 1, reps, weight, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('a visitor sees an exercise\'s bests from the sessions they may open — never a hidden or undecided workout\'s numbers; the privacy aspects hold @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createQaUser({ displayName: 'Lia Lifter', firstName: 'Lia', lastName: 'Lifter' });
  const visitor = await createQaUser({ displayName: 'Vee Viewer', firstName: 'Vee', lastName: 'Viewer' });
  const admin = adminClient();
  const ownerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders() });
  const visitorState = await mintStorageState(visitor);
  const visitorApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: visitorState, extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: visitorState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    expect((await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id)).error).toBeNull();

    const log = async (daysAgo: number, title: string, exercises: Array<{ name: string; exerciseKey: string | null; sets: unknown[] }>, fate: 'decided' | 'hidden' | 'undecided') => {
      const res = await ownerApi.post('/api/workouts', {
        data: { mode: 'manual', startedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), durationSeconds: 1800, title, exercises: exercises.map(e => ({ ...e, category: 'strength', notes: null })) },
      });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const id = (await res.json()).session.id as string;
      if (fate !== 'undecided') {
        const decided = await ownerApi.patch(`/api/workouts/${id}`, { data: { decided: true } });
        expect(decided.ok(), await readErrorBody(decided)).toBe(true);
      }
      if (fate === 'hidden') {
        const hidden = await ownerApi.patch(`/api/workouts/${id}`, { data: { hidden: true } });
        expect(hidden.ok(), await readErrorBody(hidden)).toBe(true);
      }
      return id;
    };
    const a = await log(30, 'QA base', [{ name: 'Bench Press', exerciseKey: 'bench_press', sets: [set(5, 185)] }, { name: 'DB Curl', exerciseKey: null, sets: [set(10, 30)] }], 'decided');
    // Typed by hand: the same lift as the catalog's (one identity).
    const b = await log(20, 'QA better', [{ name: 'bench press', exerciseKey: null, sets: [set(5, 195)] }], 'decided');
    const hiddenId = await log(10, 'QA hidden', [{ name: 'Bench Press', exerciseKey: 'bench_press', sets: [set(1, 250)] }], 'hidden');
    const undecidedId = await log(5, 'QA undecided', [{ name: 'Bench Press', exerciseKey: 'bench_press', sets: [set(1, 240)] }], 'undecided');

    // Every writer stored the reference; one row is put back to NULL — a row a deploy older than 306 wrote is still read.
    const { data: refs } = await admin.from('workout_exercises').select('exercise_ref').eq('profile_id', owner.id);
    expect((refs ?? []).map(r => r.exercise_ref).sort()).toEqual(['bench_press', 'bench_press', 'bench_press', 'bench_press', 'db_curl']);
    expect((await admin.from('workout_exercises').update({ exercise_ref: null }).eq('session_id', a).eq('exercise_key', 'bench_press')).error).toBeNull();

    type List = { exercises: Array<{ ref: string; name: string; area: string; headline: { kind: string; value: number }; lastAt: string | null; sessions: number | null }>; hidden?: boolean; sessionsHidden?: boolean; isOwner: boolean };
    type Detail = { exercise: { bests: { heaviest: number } }; timeline: Array<{ sessionId: string; records: string[] }>; sessionsHidden?: boolean; hidden?: boolean };
    const list = async (api: typeof ownerApi) => {
      const res = await api.get(`/api/profile/${owner.id}/training/bests`);
      expect(res.status()).toBe(200);
      expect(res.headers()['cache-control']).toBe('private, no-store');
      return (await res.json()) as List;
    };
    const detail = async (api: typeof ownerApi) => (await (await api.get(`/api/profile/${owner.id}/training/bests?exercise=bench_press`)).json()) as Detail;

    // ── The owner: everything, the hidden 250 included.
    const mine = await list(ownerApi);
    expect(mine.isOwner).toBe(true);
    expect(mine.exercises.map(e => [e.ref, e.area, e.headline.value, e.sessions])).toEqual([['bench_press', 'chest', 250, 4], ['db_curl', 'other', 30, 1]]);
    expect((await detail(ownerApi)).timeline.map(p => p.sessionId)).toEqual([undecidedId, hiddenId, b, a]);

    // ── The visitor: 195 — never 250 (hidden) or 240 (undecided); two sessions; the record is the second one's.
    const theirs = await list(visitorApi);
    expect(theirs.isOwner).toBe(false);
    expect(theirs.exercises.map(e => [e.ref, e.headline.value, e.sessions])).toEqual([['bench_press', 195, 2], ['db_curl', 30, 1]]);
    const seen = await detail(visitorApi);
    expect(seen.exercise.bests.heaviest).toBe(195);
    expect(seen.timeline.map(p => p.sessionId)).toEqual([b, a]);
    expect(seen.timeline[0].records).toContain('heaviest');
    expect(seen.timeline[1].records).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain('250');
    expect(JSON.stringify(seen)).not.toContain(hiddenId);
    // An exercise nobody logged, a value that is not an identity, a profile that is not there.
    expect((await visitorApi.get(`/api/profile/${owner.id}/training/bests?exercise=squat`)).status()).toBe(404);
    expect((await visitorApi.get(`/api/profile/${owner.id}/training/bests?exercise=${encodeURIComponent('x,exercise_ref.is.null')}`)).status()).toBe(404);
    expect((await visitorApi.get('/api/profile/00000000-0000-4000-8000-000000000000/training/bests')).status()).toBe(404);

    // ── The screen, as the visitor at phone width: the exercise's own address on /athlete/[id].
    const page = await ctx.newPage();
    await page.goto(`/athlete/${owner.id}?tab=training&view=exercises&exercise=bench_press`);
    const exercisePage = page.locator('[data-exercise-detail="bench_press"]');
    await expect(exercisePage.locator('[data-exercise-best="heaviest"]')).toContainText('195 lbs', { timeout: 30_000 });
    await expect(exercisePage.locator('[data-exercise-session]')).toHaveCount(2);
    await expect(exercisePage.locator('[data-exercise-session] a')).toHaveCount(0); // a visitor's rows open nothing
    await expect(page.getByText('250')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('dialog', { name: 'Bench Press' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('[data-exercise-row="bench_press"] [data-exercise-headline="heaviest"]')).toHaveText('195 lbs');
    await expect(page.locator('[data-exercise-area="other"] [data-exercise-row="db_curl"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // ── The privacy aspects. Workouts private: the bests stand, the sessions and their timing are withheld.
    expect((await admin.from('profiles').update({ vitals_privacy: { hidden: false, body: false, records: false, workouts: true } }).eq('id', owner.id)).error).toBeNull();
    const noSessions = await list(visitorApi);
    expect(noSessions.sessionsHidden).toBe(true);
    expect(noSessions.exercises.map(e => [e.ref, e.headline.value, e.lastAt, e.sessions])).toEqual([['bench_press', 195, null, null], ['db_curl', 30, null, null]]);
    const bestsOnly = await detail(visitorApi);
    expect(bestsOnly.exercise.bests.heaviest).toBe(195);
    expect(bestsOnly.timeline).toEqual([]);
    expect(bestsOnly.sessionsHidden).toBe(true);
    // Records private: nothing at all — and the owner still has everything.
    expect((await admin.from('profiles').update({ vitals_privacy: { hidden: false, body: false, records: true, workouts: false } }).eq('id', owner.id)).error).toBeNull();
    const none = await list(visitorApi);
    expect(none.hidden).toBe(true);
    expect(none.exercises).toEqual([]);
    expect((await detail(visitorApi)).hidden).toBe(true);
    expect((await list(ownerApi)).exercises).toHaveLength(2);
    await page.reload();
    await expect(page.locator('[data-training-exercises-empty="hidden"]')).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await visitorApi.dispose();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});
