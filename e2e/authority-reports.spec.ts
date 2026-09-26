import { test, expect, request as pwRequest } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cleanupEvent, createEvent } from './helpers/sport-events';

// ── Authority PR 5 (Sep 25 2026): report, recover, restore ─────────────────
// Anyone can report a club, league or event — the thing, never a person (no
// strike, no intake action; the team decides in the recovery panel). Someone
// locked out can ask to recover one, signed out. A deleted news post comes
// back for 30 days, and the owner's Activity shows who did what — the team's
// acts as "Edge Athlete support". Everything made here goes in `finally`.

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

test('report a club and an event: the thing, never a person; your own is not reportable; no intake action', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('authority_audit').select('id').limit(1);
  test.skip(!!probe.error, 'authority_audit missing — run migration 240');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  await resetRateBucket(admin, 'ticket-create', bravo.id);
  await resetRateBucket(admin, 'sport-event', alpha.id);
  const stamp = Date.now();
  const ticketIds: string[] = [];
  let clubId: string | null = null;
  let eventId: string | null = null;
  try {
    clubId = (await createQaOrg(admin, 'club', { name: `QA Report Club ${stamp}`, owner_profile_id: alpha.id })).id;
    await admin.from('memberships').insert({ org_id: clubId, profile_id: alpha.id, role: 'owner' });

    // Bravo reports alpha's club.
    let res = await bravoApi.post('/api/tickets', { data: { type: 'report', reason: 'impersonation', description: 'This club pretends to be ours.', target: { type: 'org', id: clubId } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const orgTicket = (await res.json()) as { id: string; severity: string };
    ticketIds.push(orgTicket.id);
    const { data: t } = await admin.from('tickets').select('subtype, target_type, target_id, target_profile_id, content_snapshot').eq('id', orgTicket.id).single();
    expect(t).toMatchObject({ subtype: 'org', target_type: 'org', target_id: clubId, target_profile_id: null });
    expect((t!.content_snapshot as { kind: string; name: string }).name).toBe(`QA Report Club ${stamp}`);
    // No intake action and no person touched: alpha stays active.
    const { data: alphaRow } = await admin.from('profiles').select('moderation_state').eq('id', alpha.id).single();
    expect(alphaRow?.moderation_state ?? 'active').toBe('active');
    // The one-click actions point at the recovery panel.
    await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'owner' }, { onConflict: 'profile_id' });
    res = await bravoApi.post(`/api/admin/tickets/${orgTicket.id}/actions`, { data: { action: 'limit' } });
    expect(res.status()).toBe(409);
    expect(await res.text()).toMatch(/recovery panel/);

    // Your own club is not reportable (a 404 like any refusal) — owners use the recovery request.
    res = await alphaApi.post('/api/tickets', { data: { type: 'report', reason: 'other', description: 'x', target: { type: 'org', id: clubId } } });
    expect(res.status()).toBe(404);

    // An event: bravo reports alpha's public event; alpha cannot report their own.
    const created = await createEvent(alphaApi, { name: `QA Report Event ${stamp}`, publish: true, visibility: 'public' });
    eventId = created.event.id;
    res = await bravoApi.post('/api/tickets', { data: { type: 'report', reason: 'spam_scam', description: 'Fake event.', target: { type: 'sport_event', id: eventId } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const evTicket = (await res.json()) as { id: string };
    ticketIds.push(evTicket.id);
    const { data: et } = await admin.from('tickets').select('subtype, target_profile_id').eq('id', evTicket.id).single();
    expect(et).toMatchObject({ subtype: 'sport_event', target_profile_id: null });
    res = await alphaApi.post('/api/tickets', { data: { type: 'report', reason: 'other', description: 'x', target: { type: 'sport_event', id: eventId } } });
    expect(res.status()).toBe(404);

    // The door on the org page, at phone width: a visitor sees Report; ?report=1 opens the sheet.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/club/${clubId}?report=1`);
      await expect(page.getByRole('dialog', { name: 'Report this club' })).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-org-report]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.goto(`/events/${eventId}`);
      await expect(page.locator('[data-event-report]')).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  } finally {
    await cleanupEvent(alphaApi, eventId);
    await deleteQaOrgs(admin, [clubId]);
    if (ticketIds.length) await admin.from('tickets').delete().in('id', ticketIds);
    await admin.from('platform_admins').delete().eq('profile_id', bravo.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical']).in('user_id', [alpha.id, bravo.id]);
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});

test('a signed-out recovery request: HIGH, matched to the club by its link — and the same answer for a link that matches nothing', async () => {
  test.setTimeout(90_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('authority_audit').select('id').limit(1);
  test.skip(!!probe.error, 'authority_audit missing — run migration 240');
  // A real stranger: an EMPTY storageState (the config's state would sign this context in).
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  await admin.from('rate_limits').delete().like('key', 'contact:%');
  const stamp = Date.now();
  const numbers: string[] = [];
  let clubId: string | null = null;
  try {
    clubId = (await createQaOrg(admin, 'club', { name: `QA Recover Club ${stamp}`, owner_profile_id: alpha.id })).id;
    const email = `edgeqa-recover-${stamp}@example.com`;
    let res = await anon.post('/api/tickets/guest', { data: { email, reason: 'recovery', subject: 'Recover a club', description: 'The owner left and nobody can run it.', reference: `${E2E_BASE_URL}/club/${clubId}` } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    numbers.push(((await res.json()) as { number: string }).number);
    res = await anon.post('/api/tickets/guest', { data: { email, reason: 'recovery', description: 'Something else entirely.', reference: 'https://no-such-club-anywhere.example/' } });
    expect(res.status()).toBe(201);
    numbers.push(((await res.json()) as { number: string }).number);
    const ids = numbers.map(n => Number(n.replace('EA-', '')));
    const { data: rows } = await admin.from('tickets').select('number, severity, target_type, target_id, description').in('number', ids).order('number');
    expect(rows![0]).toMatchObject({ severity: 'high', target_type: 'org', target_id: clubId });
    expect(rows![0].description).toMatch(/^Club, league or event: /);
    expect(rows![1]).toMatchObject({ severity: 'high', target_type: null, target_id: null });
    // A reference rides only on a recovery request.
    res = await anon.post('/api/tickets/guest', { data: { email, reason: 'account', description: 'x', reference: 'https://x.example' } });
    expect([201, 400]).toContain(res.status()); // the guest schema ignores it for other categories
  } finally {
    if (numbers.length) await admin.from('tickets').delete().in('number', numbers.map(n => Number(n.replace('EA-', ''))));
    await deleteQaOrgs(admin, [clubId]);
    await anon.dispose();
  }
});

test('a deleted news post comes back; the owner’s Activity shows it; /help has the recover form — at phone width @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('authority_audit').select('id').limit(1);
  test.skip(!!probe.error, 'authority_audit missing — run migration 240');
  const alphaApi = await apiAs('state.json');
  await resetRateBucket(admin, 'org-site', alpha.id);
  await resetRateBucket(admin, 'org-site-pages', alpha.id);
  const stamp = Date.now();
  let clubId: string | null = null;
  try {
    clubId = (await createQaOrg(admin, 'club', { name: `QA News Club ${stamp}`, owner_profile_id: alpha.id })).id;
    await admin.from('memberships').insert({ org_id: clubId, profile_id: alpha.id, role: 'owner' });
    let res = await alphaApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.post(`/api/clubs/${clubId}/site/news`, { data: { title: `Opening day ${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const newsId = ((await res.json()) as { post: { id: string } }).post.id;
    res = await alphaApi.delete(`/api/clubs/${clubId}/site/news/${newsId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // Gone from every reader, kept in "Recently deleted".
    res = await alphaApi.get(`/api/clubs/${clubId}/site/news`);
    const list = (await res.json()) as { posts: { id: string }[]; deleted: { id: string }[] };
    expect(list.posts.map(p => p.id)).not.toContain(newsId);
    expect(list.deleted.map(p => p.id)).toContain(newsId);
    expect((await alphaApi.get(`/api/clubs/${clubId}/site/news/${newsId}`)).status()).toBe(404);

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${clubId}`);
      const activity = page.locator('[data-org-activity]');
      await expect(activity).toBeVisible({ timeout: 30_000 });
      const restore = activity.locator(`[data-org-activity-restore="${newsId}"]`);
      await expect(restore).toBeVisible();
      expect((await restore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await restore.click();
      await expect(page.locator('[data-org-activity-message]')).toHaveText(/Restored/, { timeout: 20_000 });
      await expect(activity.locator('[data-org-activity-action="news_restored"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

      await page.goto('/help#recover');
      await expect(page.locator('[data-recover-form]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-recover-process]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    } finally {
      await ctx.close();
    }
    res = await alphaApi.get(`/api/clubs/${clubId}/site/news`);
    expect(((await res.json()) as { posts: { id: string }[] }).posts.map(p => p.id)).toContain(newsId);
    const { data: log } = await admin.from('authority_audit').select('action').eq('subject_type', 'org').eq('subject_id', clubId);
    expect((log ?? []).map(r => r.action)).toEqual(expect.arrayContaining(['news_deleted', 'news_restored']));
  } finally {
    await deleteQaOrgs(admin, [clubId]);
    await alphaApi.dispose();
  }
});
