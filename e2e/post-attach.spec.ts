import { test, expect, request as pwRequest } from './helpers/test';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, type QaUser } from './helpers/qa-user';
import { captionField, composeFooter, postSlide, slidePost } from './helpers/composer';

// Attach activity, the stat plate and a location (Tom's General post spec,
// Nov 26 2026; migration 321). A post attaches ONE of its author's logged
// activities — never one hidden from the profile or marked Only me — and the
// card draws its stat plate, read from the source on every read: a round
// hidden later takes its plate away, the post stays. A post is valid with
// an attached activity alone. One location per post.

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

for (const tag of ['', ' @mobile']) {
  test(`attach an activity: the picker, the plate in the preview and on the feed, a location; a hidden source takes the plate away${tag}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const admin = adminClient();
    const stamp = Date.now();
    const course = `QA Loch ${stamp}`;
    let owner: QaUser | null = null;
    let visitor: QaUser | null = null;
    const ctx = await browser.newContext({ extraHTTPHeaders: bypassHeaders() });
    try {
      owner = await createQaUser({ displayName: `Attie Plate${stamp}`, firstName: 'Attie', lastName: `Plate${stamp}` });
      visitor = await createQaUser({ displayName: `Vera Viewer${stamp}`, firstName: 'Vera', lastName: `Viewer${stamp}` });
      expect((await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id)).error).toBeNull();
      const ownerState = await mintStorageState(owner);
      await ctx.addCookies(ownerState.cookies);
      const ownerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: ownerState, extraHTTPHeaders: bypassHeaders() });
      const visitorApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(visitor), extraHTTPHeaders: bypassHeaders() });

      // The author's log: a round kept hole by hole, a round hidden from the profile, a workout, a run, an Only me walk.
      const round = (extra: Record<string, unknown>) => ({ profile_id: owner!.id, date: '2026-11-20', course, holes: 18, par: 72, gross_score: 78, is_complete: true, round_type: 'outdoor', ...extra });
      const rounds = await admin.from('golf_rounds').insert([round({}), round({ course: `${course} hidden`, date: '2026-11-21', profile_hidden_at: new Date().toISOString() })]).select('id, course');
      expect(rounds.error, rounds.error?.message).toBeNull();
      const roundId = rounds.data!.find(r => r.course === course)!.id as string;
      const hiddenRoundId = rounds.data!.find(r => r.course !== course)!.id as string;
      // 78 on a par 72: six bogeys, twelve pars.
      expect((await admin.from('golf_holes').insert(Array.from({ length: 18 }, (_, i) => ({ round_id: roundId, hole_number: i + 1, par: 4, strokes: i < 6 ? 5 : 4 })))).error).toBeNull();
      const started = new Date(stamp - 3_600_000).toISOString();
      const session = await admin.from('workout_sessions').insert({ profile_id: owner.id, title: `QA legs ${stamp}`, status: 'completed', source: 'manual', started_at: started, ended_at: started, duration_seconds: 1800, last_activity_at: started, share_decided_at: started }).select('id').single(); // decided: no "Pick up where you left off?" prompt
      expect(session.error, session.error?.message).toBeNull();
      const exercise = await admin.from('workout_exercises').insert({ session_id: session.data!.id, profile_id: owner.id, name: 'Back squat', position: 0 }).select('id').single();
      expect(exercise.error, exercise.error?.message).toBeNull();
      expect((await admin.from('workout_sets').insert([{ exercise_id: exercise.data!.id, profile_id: owner.id, set_number: 1, reps: 5, weight: 140, weight_unit: 'kg' }, { exercise_id: exercise.data!.id, profile_id: owner.id, set_number: 2, reps: 5, weight: 120, weight_unit: 'kg' }])).error).toBeNull();
      const activity = (name: string, only_me: boolean) => ({ profile_id: owner!.id, activity_type: only_me ? 'walk' : 'run', source: 'file', external_id: `qa-${stamp}-${name}`, name, started_at: new Date(stamp - 7_200_000).toISOString(), occurred_on: '2026-11-22', elapsed_s: 3000, moving_s: 2892, distance_m: 10200, only_me });
      expect((await admin.from('activities').insert([activity(`QA morning run ${stamp}`, false), activity(`QA private walk ${stamp}`, true)])).error).toBeNull();

      const page = await ctx.newPage();
      await page.goto('/feed');
      await expect(async () => {
        await page.getByRole('button', { name: /create a post/i }).click();
        await expect(captionField(page)).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      const frame = page.locator('[data-composer-frame="compose"]');
      const footer = composeFooter(page);

      // The picker: what may be attached, newest first; never the hidden round or the Only me walk.
      await expect(postSlide(page)).toHaveAttribute('aria-disabled', 'true');
      await frame.locator('[data-compose-open="activity"]').click();
      const picker = page.locator('[data-attach-picker]');
      await expect(picker.getByRole('heading', { name: 'Attach activity' })).toBeVisible();
      const options = picker.locator('[data-attach-option]');
      await expect(options).toHaveCount(3, { timeout: 20_000 });
      await expect(picker).not.toContainText('hidden');
      await expect(picker).not.toContainText('private walk');
      await expect(options.nth(0)).toContainText('Strength');
      await expect(options.nth(0)).toContainText('Back squat');
      await expect(options.nth(0)).toContainText('140');
      await expect(picker.locator('[data-attach-option="activity"]')).toContainText(/10\.2|6\.3/);

      // One per post: the workout, then the round in its place.
      await options.nth(0).click();
      await expect(picker).toHaveCount(0);
      await expect(frame.locator('[data-compose-open="activity"]')).toContainText('Strength · Back squat');
      await expect(frame.locator('[data-compose-activity-chip]')).toHaveText('140 kg');
      await frame.locator('[data-compose-open="activity"]').click();
      await expect(picker.locator('[data-attach-option="workout"]')).toHaveAttribute('aria-pressed', 'true');
      await picker.locator('[data-attach-option="round"]').click();
      await expect(frame.locator('[data-compose-open="activity"]')).toContainText(`Golf · ${course}`);
      await expect(frame.locator('[data-compose-activity-chip]')).toHaveText('78');
      // Removed and attached again.
      await frame.locator('[data-compose-remove="activity"]').click();
      await expect(frame.locator('[data-compose-open="activity"]')).toContainText('Attach activity');
      await expect(postSlide(page)).toHaveAttribute('aria-disabled', 'true');
      await frame.locator('[data-compose-open="activity"]').click();
      await picker.locator('[data-attach-option="round"]').click();

      // A3: an attached activity alone is a post.
      await expect(captionField(page)).toHaveValue('');
      await expect(postSlide(page)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(footer.locator('[data-slide-label]')).toHaveText('Slide to post');

      // A location: typed as written, shown on the row, removable.
      await frame.locator('[data-compose-open="location"]').click();
      const where = page.locator('[data-location-dialog]');
      await where.locator('#post-location').fill(`QA Rink ${stamp}`);
      await where.locator('[data-location-add]').click();
      await expect(frame.locator('[data-compose-open="location"]')).toContainText(`QA Rink ${stamp}`);
      await frame.locator('[data-compose-remove="location"]').click();
      await expect(frame.locator('[data-compose-open="location"]')).toContainText('Add location');
      await frame.locator('[data-compose-open="location"]').click();
      await where.locator('#post-location').fill(`QA Rink ${stamp}`);
      await where.locator('[data-location-add]').click();

      // The preview draws the plate: the score, the course, a block per hole.
      await frame.locator('[data-compose-preview-key]').click();
      const previewPlate = page.locator('[data-compose-preview] [data-stat-plate="round"]');
      await expect(previewPlate.locator('[data-stat-plate-headline]')).toHaveText('78', { timeout: 20_000 });
      await expect(previewPlate.locator('[data-stat-plate-name]')).toHaveText(course);
      await expect(previewPlate.locator('[data-stat-plate-detail]')).toHaveText('+6 · 18 holes');
      await expect(previewPlate.locator('[data-stat-plate-holes] li')).toHaveCount(18);
      await expect(page.locator('[data-compose-preview] [data-post-location]')).toHaveText(`QA Rink ${stamp}`);
      await page.locator('[data-compose-preview-edit]').click();

      await slidePost(page);
      await expect(captionField(page)).toBeHidden({ timeout: 60_000 });

      // Stored as a reference, never as the round's own card.
      const { data: post } = await admin.from('posts').select('id, caption, round_id, attached_round_id, attached_workout_id, location_label, on_feed, stats_data').eq('profile_id', owner.id).eq('attached_round_id', roundId).single();
      expect(post).toMatchObject({ caption: '', round_id: null, attached_round_id: roundId, attached_workout_id: null, location_label: `QA Rink ${stamp}`, on_feed: true, stats_data: null });

      // The feed card: the plate from the round as it stands (the card kept hole by hole: +6, eighteen blocks), the location beside the time.
      const card = page.locator('[data-testid="post-card"]').filter({ hasText: course }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      const plate = card.locator('[data-stat-plate="round"]');
      await expect(plate.locator('[data-stat-plate-headline]')).toHaveText('78');
      await expect(plate.locator('[data-stat-plate-detail]')).toHaveText('+6 · 18 holes');
      await expect(plate.locator('[data-stat-plate-holes] li')).toHaveCount(18);
      await expect(plate.locator('[data-hole-tone="text"]')).toHaveCount(6);
      await expect(plate.locator('[data-hole-tone="good"]')).toHaveCount(12);
      await expect(card.locator('[data-post-location]')).toHaveText(`QA Rink ${stamp}`);
      // Every size: the plate sits inside the card, its number and its name on one line each, nothing cut off the screen.
      const start = page.viewportSize()!;
      for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        await plate.scrollIntoViewIfNeeded();
        const box = (await plate.boundingBox())!;
        const cardBox = (await card.boundingBox())!;
        expect(box.x >= cardBox.x - 0.5 && box.x + box.width <= cardBox.x + cardBox.width + 0.5, `the plate sits inside the card at ${size.width}`).toBe(true);
        expect(box.x + box.width <= size.width + 0.5, `the plate is on screen at ${size.width}`).toBe(true);
        const head = (await plate.locator('[data-stat-plate-headline]').boundingBox())!;
        const name = (await plate.locator('[data-stat-plate-name]').boundingBox())!;
        expect(head.x + head.width <= name.x + 0.5, `the number and the name do not overlap at ${size.width}`).toBe(true);
        if (process.env.FIT_SHOTS) await card.screenshot({ path: `${process.env.FIT_SHOTS}/stat-plate-${size.width}.png` });
      }
      await page.setViewportSize(start);

      // A visitor reads the same plate; the round hidden later takes it away, the post stays.
      const seen = await visitorApi.get(`/api/posts?postId=${post!.id}`);
      expect(seen.ok()).toBe(true);
      const seenPost = (await seen.json()).post as { attached_plate: { headline: string; holes?: string[] } | null; location: string | null };
      expect(seenPost.attached_plate?.headline).toBe('78');
      expect(seenPost.attached_plate?.holes).toHaveLength(18);
      expect(seenPost.location).toBe(`QA Rink ${stamp}`);
      const listed = await visitorApi.get(`/api/posts?userId=${owner.id}&limit=20`);
      expect(((await listed.json()).posts as Array<{ id: string; attached_plate: unknown }>).find(p => p.id === post!.id)?.attached_plate).toBeTruthy();
      await admin.from('golf_rounds').update({ profile_hidden_at: new Date().toISOString() }).eq('id', roundId);
      const after = await visitorApi.get(`/api/posts?postId=${post!.id}`);
      expect(after.ok()).toBe(true);
      expect(((await after.json()).post as { attached_plate: unknown }).attached_plate).toBeNull();

      // The write gate: not yours, hidden, malformed, or on a repost — refused.
      const refuse = async (api: typeof ownerApi, attached: unknown) => (await api.post('/api/posts', { data: { postType: 'general', caption: `QA refuse ${stamp}`, attached } })).status();
      expect(await refuse(visitorApi, { kind: 'round', id: roundId })).toBe(400);
      expect(await refuse(ownerApi, { kind: 'round', id: hiddenRoundId })).toBe(400);
      expect(await refuse(ownerApi, { kind: 'round', id: 'not-a-uuid' })).toBe(400);
      expect(await refuse(ownerApi, { kind: 'workout', id: roundId })).toBe(400);
      const picked = await ownerApi.get('/api/posts/attachable');
      expect(picked.headers()['cache-control']).toContain('no-store');
      expect((await visitorApi.get(`/api/posts/attachable?profileId=${owner.id}`)).status()).toBe(403);
      await ownerApi.dispose();
      await visitorApi.dispose();
    } finally {
      await ctx.close();
      if (owner) await deleteQaUser(owner.id);
      if (visitor) await deleteQaUser(visitor.id);
    }
  });
}
