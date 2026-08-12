import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody, adminClient } from './helpers/qa-user';
import { request as pwRequest } from '@playwright/test';

// The Tagged tab round-trip: B tags A in a post; A shares a round with B
// (participants auto-tag); assert the dashboard (hero math, attribution),
// the notification rules (round = invite only, never a duplicate 'tag'),
// working untag, and the privacy pins migrations 066 AND 068 exist to hold:
// a private author's posts stay OFF other people's tagged tabs (066) and
// All/Stats tabs (068) for anonymous viewers, badge counts equal grid
// contents (068), and a private profile's badge counts read zero.
// Requires 068 applied to the target DB — the All/Stats pins fail pre-068.
test('tagged: tag → round auto-tag → hero → untag → privacy pins', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  // ── Seed ──────────────────────────────────────────────────────────────
  // B posts, tagging A (the ordinary tag path).
  const apiB = await apiAs('state-b.json');
  let taggedPostId = '';
  try {
    const postRes = await apiB.post('/api/posts', {
      data: {
        caption: `Range session with a teammate ${stamp}`,
        visibility: 'public',
        sport_key: 'golf',
        // Non-golf postType keeps stats_data, which puts this post in the
        // Stats-tab queries — the 068 Stats pin below is non-vacuous.
        stats_data: { score: 42 },
        taggedProfiles: [userA.id],
      },
    });
    expect(postRes.ok(), await readErrorBody(postRes)).toBe(true);
    taggedPostId = (await postRes.json()).post.id;   // pinned at the end of this spec
  } finally {
    await apiB.dispose();
  }

  // A shares a round with B (the auto-tag path — participants ARE the tags).
  const apiA = await apiAs('state.json');
  try {
    const roundRes = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `Tagged Round ${stamp}`,
        description: `Back nine at dusk ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        visibility: 'public',
        participant_ids: [userB.id],
      },
    });
    expect(roundRes.ok(), await readErrorBody(roundRes)).toBe(true);
  } finally {
    await apiA.dispose();
  }

  // ── A's own tab: attribution + count pill ─────────────────────────────
  await page.goto('/athlete');
  await page.getByRole('button', { name: /tagged/i }).first().click();
  // The seed post carries stats_data, so its tile renders the stat line, not
  // the caption — the caption survives only as the tile's accessible name.
  await expect(page.getByRole('button', { name: `Range session with a teammate ${stamp}` }).first())
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('by Edge Bravo').first()).toBeVisible();

  // The FilterBar count pill agrees, and the real-data filter dropdowns are
  // live (fed by the summary RPC from 066 — golf is a real option).
  await expect(page.getByText('1 post', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All Sports' })).toBeEnabled();

  // A authored the round, so it must NOT appear on A's own tagged tab.
  await expect(page.getByText(`Back nine at dusk ${stamp}`)).toHaveCount(0);

  // ── B's tab: the round auto-tag, and no duplicate 'tag' notification ──
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto('/athlete');
    await pageB.getByRole('button', { name: /tagged/i }).first().click();
    await expect(pageB.getByText(`Back nine at dusk ${stamp}`).first())
      .toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText('by Edge Alpha').first()).toBeVisible();

    // Round participants get the invite notification — never a 'tag' one.
    await pageB.goto('/app/notifications');
    await expect(pageB.getByText('Edge Alpha added you to a shared round').first())
      .toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText('tagged you in a post')).toHaveCount(0);
  } finally {
    await ctxB.close();
  }

  // ── Privacy pins (the 066 fixes), at the API layer ────────────────────
  // A public; B stays private (QA default). /athlete/[id] requires a
  // session, so the anonymous-viewer pins hit the endpoints directly —
  // which is where the hardening lives.
  await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  // storageState MUST be explicitly empty: a bare newContext here inherited
  // the config's default state.json and sent A's session cookie — the
  // "anonymous" pin was silently running as A (viewer = tagged athlete, the
  // one grant that bypasses the owner clause).
  const anonApi = await pwRequest.newContext({
    baseURL: 'http://localhost:3000',
    storageState: { cookies: [], origins: [] },
  });
  try {
    // The private author B's post must NOT be in A's tagged list for an
    // anonymous viewer (the 021 hole 066 closes)...
    const listRes = await anonApi.get(`/api/profile/${userA.id}/media?tab=tagged&limit=50`);
    expect(listRes.ok()).toBe(true);
    const list = await listRes.json();
    const captions = (list.items ?? []).map((i: { caption: string | null }) => i.caption ?? '');
    expect(captions.join('|')).not.toContain(`Range session with a teammate ${stamp}`);

    // ...and the anonymous summary agrees (hero would show 0).
    const sumRes = await anonApi.get(`/api/profile/${userA.id}/tagged-summary`);
    expect(sumRes.ok()).toBe(true);
    expect((await sumRes.json()).timesTagged).toBe(0);

    // ── 068 pins: the same owner clause on All/Stats ──────────────────
    // Private-B's tagging post must be off A's All grid for anonymous —
    // pre-068 it rendered there as a real tile, author name included.
    const allRes = await anonApi.get(`/api/profile/${userA.id}/media?tab=all&limit=50`);
    expect(allRes.ok()).toBe(true);
    const allList = await allRes.json();
    const allCaptions = (allList.items ?? []).map((i: { caption: string | null }) => i.caption ?? '');
    expect(allCaptions.join('|')).not.toContain(`Range session with a teammate ${stamp}`);

    // ...and off the Stats grid (the seed post carries stats_data, so this
    // pin is non-vacuous — pre-068 the post appears here too).
    const statsRes = await anonApi.get(`/api/profile/${userA.id}/media?tab=stats&limit=50`);
    expect(statsRes.ok()).toBe(true);
    const statsList = await statsRes.json();
    const statsCaptions = (statsList.items ?? []).map((i: { caption: string | null }) => i.caption ?? '');
    expect(statsCaptions.join('|')).not.toContain(`Range session with a teammate ${stamp}`);

    // Badges equal grid contents for the same anonymous viewer — the
    // invariant 068 exists to restore. Exact equality is race-free only
    // because the suite runs workers:1; if it ever goes parallel,
    // downgrade these two to membership pins.
    const aCountsRes = await anonApi.post(`/api/profile/${userA.id}/media`);
    expect(aCountsRes.ok()).toBe(true);
    const aCounts = await aCountsRes.json();
    expect(aCounts.all).toBe((allList.items ?? []).length);
    expect(aCounts.stats).toBe((statsList.items ?? []).length);

    // Private profile's badge counts read zero for anonymous viewers (the
    // hoisted counts gate) — B is private.
    const countsRes = await anonApi.post(`/api/profile/${userB.id}/media`);
    expect(countsRes.ok()).toBe(true);
    const counts = await countsRes.json();
    expect(counts.tagged).toBe(0);
    expect(counts.all).toBe(0);
  } finally {
    await anonApi.dispose();
  }

  // A's own view is unchanged (viewer = tagged athlete grant).
  await page.reload();
  await page.getByRole('button', { name: /tagged/i }).first().click();
  await expect(page.getByRole('button', { name: `Range session with a teammate ${stamp}` }).first())
    .toBeVisible({ timeout: 15_000 });

  // ── Untag: A removes B's tag of them; it sticks ───────────────────────
  await page.getByRole('button', { name: 'Remove tag from post by Edge Bravo' }).first().click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('button', { name: `Range session with a teammate ${stamp}` })).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: /tagged/i }).first().click();
  await expect(page.getByText('No tags yet')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `Range session with a teammate ${stamp}` })).toHaveCount(0);

  // The untag must leave a status='removed' MARKER, not just disappear from
  // the UI. src/lib/group-posts/mirror-tags.ts reads that marker to keep an
  // untagged participant untagged; without it a group-round resync re-tags
  // them. The UI assertions above all passed while this was broken in prod
  // (the route logs the marker failure and continues), which is exactly how
  // the bug survived — so pin the row, not the pixels.
  // REQUIRES migration 081. Pre-081 every UPDATE on post_tags raises
  // 42703 "record \"new\" has no field \"tags\"" and this fails.
  const admin = adminClient();
  const { data: markers, error: markerErr } = await admin
    .from('post_tags')
    .select('status')
    .eq('post_id', taggedPostId)
    .eq('tagged_profile_id', userA.id);
  expect(markerErr).toBeNull();
  expect(markers?.map(m => m.status)).toEqual(['removed']);
});
