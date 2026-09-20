import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 2 PR 3 — the visible half at 390×844. Bravo
// reports alpha's post from the feed card's "…" through the one report
// sheet, then mutes alpha from the done state (the post leaves bravo's
// feed); the profile "…" opens the same sheet on /athlete/[id]; delta (a
// moderator) opens the ticket, reads the snapshot and hides the content;
// alpha sees the hidden badge on their own post; after a warning alpha's
// Settings → Support shows "About your account" and the appeal box; an
// admin Limit shows alpha the moderation banner. Self-skips pre-223.

test('reporting UI: the sheet from a post and a profile, mute, the admin snapshot + hide, the hidden badge, the appeal, the banner @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const delta = loadQaUser('user-d.json');
  const probe = await admin.from('user_mutes').select('id').limit(1);
  test.skip(!!probe.error, `user_mutes missing — run migration 223 (${probe.error?.message})`);

  const alphaApi = await apiAs('state.json');
  const deltaApi = await apiAs('state-d.json');
  await resetRateBucket(admin, 'ticket-create', bravo.id);
  await resetRateBucket(admin, 'post-create', alpha.id);
  await resetRateBucket(admin, 'mute', bravo.id);
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  let postId: string | null = null;
  const ticketIds: string[] = [];
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  const ctxA = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
  const ctxD = await browser.newContext({ storageState: 'e2e/.auth/state-d.json' });
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    await admin.from('platform_admins').upsert({ profile_id: delta.id, role: 'moderator' }, { onConflict: 'profile_id' });
    const caption = `Reportable from the feed ${Date.now()}`;
    let res = await alphaApi.post('/api/posts', { data: { caption, visibility: 'public', postType: 'general' } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    postId = (await res.json()).post.id as string;

    // Bravo: the feed card's "…" → Report → the sheet → harassment → send → mute.
    const pageB = await ctxB.newPage();
    await pageB.goto(`/feed?post=${postId}`);
    await pageB.goto('/feed');
    const card = pageB.locator('[data-testid="post-card"]').filter({ hasText: caption }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.locator('[data-post-viewer-menu]').click();
    await pageB.locator('[data-menu-item="report"]').click();
    const sheet = pageB.locator('[data-report-sheet]');
    await expect(sheet.getByRole('dialog', { name: 'Report this post' })).toBeVisible();
    await sheet.getByLabel('Harassment or bullying').check();
    await sheet.locator('[data-report-details]').fill('Keeps at it.');
    await sheet.locator('[data-report-submit]').click();
    const done = sheet.locator('[data-report-done]');
    await expect(done).toBeVisible();
    const number = (await done.getAttribute('data-report-done')) ?? '';
    expect(number).toMatch(/^EA-\d{4,}$/);
    const { data: trow } = await admin.from('tickets').select('id, severity, target_id').eq('reporter_profile_id', bravo.id).eq('target_id', postId).order('created_at', { ascending: false }).limit(1).single();
    ticketIds.push(trow!.id as string);
    expect(trow!.severity).toBe('high');
    await sheet.locator('[data-report-mute]').click();
    await expect(sheet.locator('[data-report-mute]')).toContainText('Muted');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);
    // Muted: the post leaves bravo's feed.
    await pageB.reload();
    await expect(pageB.locator('[data-testid="post-card"]').filter({ hasText: caption })).toHaveCount(0);

    // The profile "…" opens the same sheet.
    await pageB.goto(`/athlete/${alpha.id}`);
    await pageB.locator('[data-profile-menu]').click();
    await pageB.locator('[data-menu-item="report"]').click();
    const profileSheet = pageB.getByRole('dialog', { name: 'Report this profile' });
    await expect(profileSheet).toBeVisible();
    await profileSheet.getByRole('button', { name: 'Close' }).click();

    // Delta: the ticket — the snapshot, then Hide.
    const pageD = await ctxD.newPage();
    await pageD.goto(`/dashboard/tickets/${trow!.id}`);
    await expect(pageD.locator('[data-ticket-snapshot]')).toContainText(caption);
    await expect(pageD.locator('[data-snapshot-kind="post"]')).toBeVisible();
    await expect(pageD.locator('[data-ticket-ladder]')).toContainText('warning');
    await pageD.locator('[data-ticket-action="hide"]').click();
    await expect(pageD.locator('[data-ticket-action="unhide"]')).toBeVisible();
    await expect(pageD.locator('[data-ticket-enforcement]')).toContainText('Content hidden');

    // Alpha: their own post shows the hidden badge.
    const pageA = await ctxA.newPage();
    await pageA.goto(`/feed?post=${postId}`);
    await pageA.goto('/feed');
    const own = pageA.locator('[data-testid="post-card"]').filter({ hasText: caption }).first();
    await expect(own).toBeVisible({ timeout: 20_000 });
    await expect(own.locator('[data-post-hidden]')).toBeVisible();

    // A warning → About your account + the appeal box.
    res = await deltaApi.patch(`/api/admin/tickets/${trow!.id}`, { data: { status: 'resolved', resolution_code: 'warning', resolution_note: 'Keep it civil.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await pageA.goto(`/settings?tab=support&ticket=${trow!.id}`);
    const about = pageA.locator('[data-about-my-account]');
    await expect(about).toBeVisible();
    await expect(about).toContainText('Warning issued');
    const thread = about.locator(`[data-my-request="${trow!.id}"] [data-request-thread]`);
    await expect(thread).toContainText('Keep it civil.');
    await expect(thread.locator('[data-request-send]')).toHaveText('Send appeal');
    await expect(pageA.locator('[data-about-my-account]')).not.toContainText('Keeps at it.');
    await thread.locator('[data-request-reply-box]').fill('That was a joke between friends.');
    await thread.locator('[data-request-send]').click();
    await expect(thread).toContainText('That was a joke between friends.');

    // An admin Limit → alpha's banner.
    res = await deltaApi.post(`/api/admin/tickets/${trow!.id}/actions`, { data: { action: 'limit' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await pageA.reload();
    await expect(pageA.locator('[data-moderation-banner="limited"]')).toBeVisible();
    await expect(pageA.locator('[data-moderation-banner="limited"]')).toContainText('read-only');
  } finally {
    // The fixture disposes contexts at test end; a close after that throws — tolerate it.
    for (const ctx of [ctxA, ctxB, ctxD]) await ctx.close().catch(() => null);
    await admin.from('profiles').update({ visibility: prior?.visibility ?? 'private', moderation_state: 'active', moderation_until: null, moderation_ticket_id: null }).eq('id', alpha.id);
    await admin.auth.admin.updateUserById(alpha.id, { ban_duration: 'none' }).catch(() => null);
    if (postId) await admin.from('posts').delete().eq('id', postId);
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
    await admin.from('user_mutes').delete().eq('muter_id', bravo.id);
    await admin.from('platform_admins').delete().eq('profile_id', delta.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical', 'moderation_notice']).in('user_id', [alpha.id, bravo.id, delta.id]);
  }
});
