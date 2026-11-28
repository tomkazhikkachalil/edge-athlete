import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, readErrorBody, type QaUser } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { dragSlide, slideKey } from './helpers/go-live';

// Golf round flow, part 2 (Tom's spec, Nov 24 2026): the Players step with
// its QUICK ADD row and the Tag People dialog in the mechanical dialect, and
// the Start step whose Go Live is a SLIDE. The visuals are wired to the
// round: a quick-added person is a partner of the round that starts; a
// short slide starts nothing; a full one starts the round exactly once.
// Self-seeded: a public QA partner and an earlier round shared with them.

async function openPlayers(page: Page, courseName: string): Promise<Locator> {
  await page.goto('/feed?create=1&sport=golf');
  const flow = page.locator('[data-step-flow="golf-round"]');
  await expect(flow).toBeVisible({ timeout: 20_000 });
  await expect(flow.locator('[data-step-header]')).toHaveText(/Step 1 of 6 · Round type/);
  await flow.locator('[data-step-next]').click();
  await expect(flow).toHaveAttribute('data-step', 'course');
  await page.getByPlaceholder(/search courses/i).fill(courseName);
  await page.locator('[data-course-add-manually]').click();
  await expect(page.locator('[data-course-chosen]')).toContainText(courseName);
  for (const step of ['format', 'conditions', 'players']) {
    await flow.locator('[data-step-next]').click();
    await expect(flow).toHaveAttribute('data-step', step);
  }
  return flow;
}

for (const tag of ['', ' @mobile']) {
  test(`players: quick add and Tag People; start: a short slide does nothing, a full slide goes live${tag}`, async ({ page }) => {
    test.setTimeout(150_000);
    const admin = adminClient();
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const last = `Fairway${stamp}`;
    const partnerName = `Quinn ${last}`;
    let partner: QaUser | null = null;
    let earlierRound = '';
    let groupPostId = '';
    // After Go Live the feed offers to resume the round: say no, every time.
    await page.addLocatorHandler(page.getByRole('heading', { name: 'Pick up where you left off?' }), async () => {
      await page.getByRole('button', { name: 'Not now' }).click();
    });
    try {
      partner = await createQaUser({ displayName: partnerName, firstName: 'Quinn', lastName: last });
      const made = await admin.from('profiles').update({ visibility: 'public' }).eq('id', partner.id);
      expect(made.error, made.error?.message).toBeNull();
      const res = await api.post('/api/group-posts', {
        data: {
          type: 'golf_round',
          title: `QA Earlier Round ${stamp}`,
          date: new Date().toISOString().split('T')[0],
          participant_ids: [partner.id],
        },
      });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      earlierRound = ((await res.json()) as { group_post?: { id?: string } }).group_post?.id ?? '';

      // The route itself: the caller's own partners, never cached.
      const recent = await api.get('/api/golf/partners/recent');
      expect(recent.ok(), await readErrorBody(recent)).toBe(true);
      expect(recent.headers()['cache-control']).toContain('no-store');
      const body = (await recent.json()) as { partners: { id: string; name: string }[] };
      expect(body.partners.map(p => p.id)).toContain(partner.id);

      // ── Step 5: Players ───────────────────────────────────────────────────
      const flow = await openPlayers(page, `QA Slide Links ${stamp}`);
      await expect(flow.locator('[data-step-header]')).toHaveText(/Step 5 of 6 · Players/);
      // Opens blank (A5): nobody listed, the list itself absent.
      await expect(flow.locator('[data-round-partner]')).toHaveCount(0);
      await expect(flow.locator('[data-round-partners]')).toHaveCount(0);
      // The info text is behind the button.
      await expect(flow.locator('[data-round-players-info]')).toHaveCount(0);
      await flow.getByRole('button', { name: /More information about Playing partners/i }).click();
      await expect(flow.locator('[data-round-players-info]')).toContainText('Playing solo');
      await flow.getByRole('button', { name: /More information about Playing partners/i }).click();
      await expect(flow.locator('[data-round-players-info]')).toHaveCount(0);

      // Quick add (A6): a picture only, named for assistive tech, 48 px.
      const quick = flow.locator(`[data-round-quick-add-person="${partner.id}"]`);
      await expect(quick).toBeVisible({ timeout: 15_000 });
      await expect(quick).toHaveAttribute('aria-label', `Add ${partnerName}`);
      // No name beside the picture (a person without one shows the app's initials).
      await expect(quick).not.toContainText('Quinn');
      await expect(quick).not.toContainText(last);
      const q = (await quick.boundingBox())!;
      expect(Math.round(q.width)).toBe(48);
      expect(Math.round(q.height)).toBe(48);
      await quick.click();
      // Added, and off the row.
      const row = flow.locator(`[data-round-partner="${partner.id}"]`);
      await expect(row).toContainText(partnerName);
      await expect(quick).toHaveCount(0);
      // A7: no handicap, nothing in its place (this account has no rated rounds).
      await expect(row.locator('[data-round-partner-handicap]')).toHaveCount(0);
      await expect(row).not.toContainText(/HCP|—|\b0\b/);
      expect(Math.round((await row.boundingBox())!.height)).toBe(56);
      // Removed: back on the row.
      await row.getByRole('button', { name: `Remove ${partnerName}` }).click();
      await expect(row).toHaveCount(0);
      await expect(quick).toBeVisible();

      // ── Tag People, in the dialect ────────────────────────────────────────
      await flow.locator('[data-round-add-players]').click();
      const dialog = page.locator('[data-tag-people="mech"]');
      await expect(dialog.getByRole('heading', { name: 'Tag People' })).toBeVisible();
      await expect(dialog.locator('[data-tag-people-empty="idle"]')).toHaveText('Type to search for people');
      const submit = dialog.locator('[data-tag-people-submit]');
      await expect(submit).toHaveText('Tag');
      await expect(submit).toBeDisabled();
      const search = dialog.getByPlaceholder('Search people');
      await search.fill(`Zzqx${stamp}`);
      await expect(dialog.locator('[data-tag-people-empty="none"]')).toHaveText('No one found', { timeout: 15_000 });
      await search.fill(last);
      const result = dialog.locator(`[data-tag-people-row="${partner.id}"]`);
      await expect(result).toBeVisible({ timeout: 20_000 });
      await expect(result).toHaveAttribute('aria-pressed', 'false');
      expect(Math.round((await result.boundingBox())!.height)).toBe(56);
      await result.click();
      await expect(result).toHaveAttribute('aria-pressed', 'true');
      const chip = dialog.locator(`[data-tag-people-chip="${partner.id}"]`);
      await expect(chip).toContainText(partnerName);
      await expect(submit).toHaveText('Tag (1)');
      // The old heading is gone; tapping the chip removes the person.
      await expect(dialog.getByText(/Selected \(/)).toHaveCount(0);
      await chip.click();
      await expect(chip).toHaveCount(0);
      await expect(submit).toHaveText('Tag');
      await result.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await submit.click();
      await expect(dialog).toHaveCount(0);
      await expect(row).toContainText(partnerName);
      // Tagged = a partner, so no longer suggested.
      await expect(quick).toHaveCount(0);

      // ── Step 6: Start ─────────────────────────────────────────────────────
      await flow.locator('[data-step-next]').click();
      await expect(flow.locator('[data-step-header]')).toHaveText(/Step 6 of 6 · Start/);
      await expect(flow.getByRole('heading', { name: 'Ready to go live' })).toBeVisible();
      await expect(flow.locator('[data-round-preview]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
      await expect(flow.locator('[data-round-summary-row="round-type"]')).toContainText('Outdoor');
      await expect(flow.locator('[data-round-summary-row="format"]')).toContainText('Stroke Play');
      await expect(flow.locator('[data-round-summary-row="players"] [data-round-player]')).toHaveCount(2);
      await expect(flow.locator(`[data-round-player="${partner.id}"]`)).toContainText(partnerName);
      // The helper sentence swaps with the title, in place.
      const lampY = (await flow.locator('[data-round-summary-row="course"]').boundingBox())!.y;
      await flow.getByRole('button', { name: /More information about Ready to go live/i }).click();
      await expect(flow.locator('[data-round-start-info]')).toHaveText('Go Live opens the round. Score hole by hole, add partners any time.');
      await expect(flow.getByRole('heading', { name: 'Ready to go live' })).toHaveCount(0);
      expect(Math.abs((await flow.locator('[data-round-summary-row="course"]').boundingBox())!.y - lampY)).toBeLessThanOrEqual(1);
      await flow.getByRole('button', { name: /More information about Ready to go live/i }).click();

      // The slide: 56 px track beside a 72 px Back, the key 48 px.
      const track = flow.locator('[data-slide-track]');
      await expect(track).toContainText('Go Live');
      const t = (await track.boundingBox())!;
      const b = (await flow.locator('[data-step-back]').boundingBox())!;
      const k = (await slideKey(flow).boundingBox())!;
      expect(Math.round(t.height)).toBe(56);
      expect(Math.round(b.width)).toBe(72);
      expect(Math.round(b.height)).toBe(56);
      expect(Math.round(k.width)).toBe(48);
      expect(Math.round(t.x - (b.x + b.width))).toBe(8);

      const started: string[] = [];
      page.on('request', req => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/group-posts') started.push(req.url());
      });
      // A tap on the key is not a slide — nor is a tap anywhere on the track,
      // its far end included (the key follows the distance dragged; it never
      // jumps to the finger).
      await slideKey(flow).click();
      await expect(track).toHaveAttribute('data-slide-state', 'rest');
      await page.mouse.click(t.x + t.width - 12, t.y + t.height / 2);
      await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
      await expect(track).toHaveAttribute('data-slide-state', 'rest');
      // The drag may start on the track, away from the screen's edge: the
      // key moves by the distance dragged.
      await page.mouse.move(t.x + t.width * 0.45, t.y + t.height / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.width * 0.45 + 60, t.y + t.height / 2, { steps: 6 });
      await expect(track).toHaveAttribute('data-slide-state', 'dragging');
      expect(Math.round((await slideKey(flow).boundingBox())!.x - k.x)).toBe(60);
      await page.mouse.up();
      await expect(track).toHaveAttribute('data-slide-state', 'rest');
      // Half way and let go: the key returns, nothing starts.
      await dragSlide(page, flow, 0.5);
      await expect(track).toHaveAttribute('data-slide-state', 'rest');
      await expect.poll(async () => Math.round((await slideKey(flow).boundingBox())!.x)).toBe(Math.round(k.x));
      await expect(track).toContainText('Go Live');
      expect(started).toHaveLength(0);
      await expect(page).not.toHaveURL(/\/live\//);

      // All the way: locked, "Live", and the round starts ONCE.
      await dragSlide(page, flow, 1);
      await expect(track).toHaveAttribute('data-slide-state', 'locked');
      await expect(track).toContainText('Live');
      await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
      groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
      expect(groupPostId).not.toBe('');
      expect(started).toHaveLength(1);

      // The round holds the partner who was added on the way.
      const people = await admin.from('group_post_participants').select('profile_id').eq('group_post_id', groupPostId);
      expect(people.error, people.error?.message).toBeNull();
      expect((people.data ?? []).map(p => p.profile_id)).toContain(partner.id);
    } finally {
      await cleanup('golf-part2', [
        () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
        () => earlierRound && admin.from('group_posts').delete().eq('id', earlierRound),
        () => admin.from('group_posts').delete().like('title', `QA Earlier Round ${stamp}`),
        () => partner && deleteQaUser(partner.id),
        () => api.dispose(),
      ]);
    }
  });
}

// The general post took the dialect on Nov 26 2026: its Tag People is the same dialog.
test('the general composer opens the same Tag People dialog', async ({ page }) => {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await page.locator('[data-compose-tag-people]').click();
  await expect(page.getByRole('heading', { name: 'Tag People' })).toBeVisible();
  await expect(page.locator('[data-tag-people="mech"]')).toHaveCount(1);
  await expect(page.getByPlaceholder('Search people', { exact: true })).toBeVisible();
});

// Keyboard: the key is focusable and Enter starts the round. The outline is
// the keyboard's alone.
test('start: a mouse press rings nothing, the keyboard rings the track; Enter on the slide key goes live', async ({ page }) => {
  const admin = adminClient();
  let groupPostId = '';
  try {
    const flow = await openPlayers(page, `QA Key Links ${Date.now()}`);
    await flow.locator('[data-step-next]').click();
    await expect(flow).toHaveAttribute('data-step', 'finish');
    const key = slideKey(flow);
    await expect(key).toHaveAttribute('aria-label', 'Slide to go live');

    // The outline is the keyboard's (Nov 28 2026). A mouse pressing the key
    // focuses it but rings nothing: on a desktop the outline used to show
    // mid-slide with its bottom edge cut off. A half slide, held, then let go.
    const track = flow.locator('[data-slide-track]');
    const outline = () => track.evaluate(el => getComputedStyle(el).outlineStyle);
    const k = (await key.boundingBox())!;
    const t = (await track.boundingBox())!;
    await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
    await page.mouse.down();
    for (let s = 1; s <= 6; s++) await page.mouse.move(k.x + k.width / 2 + (t.width * 0.4 * s) / 6, k.y + k.height / 2);
    await expect(track).toHaveAttribute('data-slide-state', 'dragging');
    await expect(key).toBeFocused();
    await expect(track).not.toHaveAttribute('data-kbd-focus', '');
    expect(await outline()).toBe('none');
    // Dragged, the key stays inside its track, and no text is selected.
    const mid = (await key.boundingBox())!;
    expect(mid.x).toBeGreaterThanOrEqual(t.x);
    expect(mid.x + mid.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
    expect(mid.y).toBeGreaterThanOrEqual(t.y);
    expect(mid.y + mid.height).toBeLessThanOrEqual(t.y + t.height + 0.5);
    expect(await page.evaluate(() => String(getSelection()))).toBe('');
    await page.mouse.up();
    await expect(track).toHaveAttribute('data-slide-state', 'rest');

    // The keyboard reaching the key rings the track, and the whole ring
    // (2 px, 2 px away) is inside whatever clips the footer.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(key).toBeFocused();
    await expect(track).toHaveAttribute('data-kbd-focus', '');
    expect(await outline()).toBe('solid');
    const room = await track.evaluate(el => {
      const r = el.getBoundingClientRect();
      let clip = Infinity;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowY !== 'visible') clip = Math.min(clip, p.getBoundingClientRect().bottom);
      }
      return Math.min(clip, window.innerHeight) - r.bottom;
    });
    expect(room, 'room under the track for its 4 px outline').toBeGreaterThanOrEqual(4);
    await key.press('Enter');
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
  } finally {
    await cleanup('golf-part2-key', [
      () => groupPostId && admin.from('group_posts').delete().eq('id', groupPostId),
    ]);
  }
});
