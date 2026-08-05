import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody, adminClient } from './helpers/qa-user';
import { request as pwRequest } from '@playwright/test';

// The Tagged tab round-trip: B tags A in a post; A shares a round with B
// (participants auto-tag); assert the dashboard (hero math, attribution),
// the notification rules (round = invite only, never a duplicate 'tag'),
// working untag, and the privacy pins migration 066 exists to hold:
// a private author's posts stay OFF other people's tagged tabs for
// anonymous viewers, and a private profile's badge counts read zero.
test('tagged: tag → round auto-tag → hero → untag → privacy pins', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  // ── Seed ──────────────────────────────────────────────────────────────
  // B posts, tagging A (the ordinary tag path).
  const apiB = await apiAs('state-b.json');
  try {
    const postRes = await apiB.post('/api/posts', {
      data: {
        caption: `Range session with a teammate ${stamp}`,
        visibility: 'public',
        sport_key: 'golf',
        taggedProfiles: [userA.id],
      },
    });
    expect(postRes.ok(), await readErrorBody(postRes)).toBe(true);
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
  await expect(page.getByText(`Range session with a teammate ${stamp}`).first())
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
  await expect(page.getByText(`Range session with a teammate ${stamp}`).first())
    .toBeVisible({ timeout: 15_000 });

  // ── Untag: A removes B's tag of them; it sticks ───────────────────────
  await page.getByRole('button', { name: 'Remove tag from post by Edge Bravo' }).first().click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText(`Range session with a teammate ${stamp}`)).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: /tagged/i }).first().click();
  await expect(page.getByText('No tags yet')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Range session with a teammate ${stamp}`)).toHaveCount(0);
});
