import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cleanupEvent, createEvent, readView } from './helpers/sport-events';

// ── Authority PR 4 (Sep 25 2026): the Edge Athlete team's recovery tools ────
// Tom: "Even if there isn't a contact, we need a way to recover and for users
// to manage the site if something were to happen or if someone is being
// malicious." Alpha owns a club and hosts an event; bravo is made a platform
// OWNER through the service key (recovery is owner-only — a moderator is
// refused) and works alpha's support ticket: pause the site (alpha cannot take
// it live or publish), release it, add an owner, remove one, mint a
// recovery link (only alpha's email redeems it), re-host the event, cancel
// it. Every act lands in the authority log as support on the ticket, and in
// the ticket's history. The role, the org, the event and the ticket go in
// `finally`.

type Log = { action: string; actor_kind: string; ticket_id: string | null; target_profile_id: string | null };

test('recovery: owner-only; pause/release; add and remove an owner; the recovery link; re-host and cancel an event', async () => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('authority_audit').select('id').limit(1);
  test.skip(!!probe.error, `authority_audit missing — run migration 240 (${probe.error?.message})`);

  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  for (const [bucket, id] of [['ticket-create', alpha.id], ['org-site', alpha.id], ['org-site-revisions', alpha.id], ['org-claim', alpha.id], ['org-claim', bravo.id], ['authority-admin', bravo.id], ['sport-event', alpha.id]] as const) {
    await resetRateBucket(admin, bucket, id);
  }
  const stamp = Date.now();
  let ticketId: string | null = null;
  let clubId: string | null = null;
  let eventId: string | null = null;

  try {
    // Alpha asks for help. (PR 5 gives this its own "recover" category.)
    let res = await alphaApi.post('/api/tickets', { data: { type: 'help', reason: 'organizations', subject: 'Our club site was vandalised', description: 'Someone changed our club. Please help.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const ticket = (await res.json()) as { id: string; number: string };
    ticketId = ticket.id;

    const club = await createQaOrg(admin, 'club', { name: `QA Recovery Club ${stamp}`, owner_profile_id: alpha.id });
    clubId = club.id;
    expect((await admin.from('memberships').insert({ org_id: clubId, profile_id: alpha.id, role: 'owner' })).error).toBeNull();
    res = await alphaApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Owner-only: nobody, then a moderator, is refused; a platform owner is admitted.
    const panel = `/api/admin/recovery/orgs/${clubId}`;
    expect((await bravoApi.get(panel)).status()).toBe(403);
    expect((await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'moderator' }, { onConflict: 'profile_id' })).error).toBeNull();
    expect((await bravoApi.get(panel)).status()).toBe(403);
    expect((await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'owner' }, { onConflict: 'profile_id' })).error).toBeNull();
    res = await bravoApi.get(panel);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()) as { people: { profileId: string; role: string }[] }).people).toEqual(expect.arrayContaining([expect.objectContaining({ profileId: alpha.id, role: 'owner' })]));

    // Search finds it by name.
    res = await bravoApi.get(`/api/admin/recovery/search?q=${encodeURIComponent(`QA Recovery Club ${stamp}`)}`);
    expect(((await res.json()) as { hits: { id: string }[] }).hits.map(h => h.id)).toContain(clubId);

    const act = (body: Record<string, unknown>) => bravoApi.post(panel, { data: { ticket: ticket.number, note: 'e2e: verified the requester', ...body } });

    // Every act names a real, open ticket.
    res = await bravoApi.post(panel, { data: { action: 'hold', ticket: 'EA-1', note: 'x' } });
    expect(res.status()).toBe(404);

    // Pause: offline now, and no path takes it live or publishes while held.
    res = await act({ action: 'hold' });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: held } = await admin.from('org_sites').select('held_at, published_at').eq('org_id', clubId).single();
    expect(held).toMatchObject({ published_at: null });
    expect(held!.held_at).not.toBeNull();
    res = await alphaApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { held?: boolean }).held).toBe(true);
    res = await alphaApi.post(`/api/clubs/${clubId}/site/revisions`, { data: { action: 'publish' } });
    expect(res.status()).toBe(409);
    expect((await act({ action: 'hold' })).status()).toBe(409); // already paused

    // Release: the owner can take it live again.
    res = await act({ action: 'release' });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Add an owner (bravo, by id), then remove alpha — who becomes a plain member.
    res = await act({ action: 'add_owner', person: bravo.id });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await act({ action: 'remove_owner', profile: alpha.id });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const roleOf = async (id: string) => ((await admin.from('memberships').select('role').eq('org_id', clubId!).eq('profile_id', id).eq('kind', 'follow').maybeSingle()).data as { role?: string } | null)?.role ?? null;
    expect(await roleOf(alpha.id)).toBe('member');
    expect(await roleOf(bravo.id)).toBe('owner');
    // The last owner never goes without a replacement.
    res = await act({ action: 'remove_owner', profile: bravo.id });
    expect(res.status()).toBe(409);

    // A recovery link for alpha's email: bravo cannot use it; alpha can, and is an owner again.
    res = await act({ action: 'recovery_link', email: alpha.email });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const url = ((await res.json()) as { url: string }).url;
    const token = url.split('/org-claim/')[1];
    expect(token.length).toBeGreaterThan(20);
    res = await bravoApi.get(`/api/org-claim/${token}`);
    expect(((await res.json()) as { recovery?: boolean }).recovery).toBe(true);
    res = await bravoApi.post(`/api/org-claim/${token}`);
    expect(res.status()).toBe(409);
    res = await alphaApi.post(`/api/org-claim/${token}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await roleOf(alpha.id)).toBe('owner');
    expect((await alphaApi.post(`/api/org-claim/${token}`)).status()).toBe(410); // single use

    // The org's log: every support act is a platform row on the ticket; the redeem is alpha's own.
    const { data: orgLog } = await admin.from('authority_audit').select('action, actor_kind, ticket_id, target_profile_id').eq('subject_type', 'org').eq('subject_id', clubId);
    const rows = (orgLog ?? []) as Log[];
    for (const a of ['site_held', 'site_released', 'owner_added', 'owner_removed', 'recovery_link_minted']) {
      expect(rows.find(r => r.action === a), a).toMatchObject({ actor_kind: 'platform', ticket_id: ticketId });
    }
    expect(rows.find(r => r.action === 'recovery_link_redeemed')).toMatchObject({ actor_kind: 'member', target_profile_id: alpha.id, ticket_id: ticketId });

    // Events: alpha hosts; support hands it to bravo (alpha stays as a participant), then cancels it.
    const created = await createEvent(alphaApi, { name: `QA Recovery Event ${stamp}`, publish: true });
    eventId = created.event.id;
    const eventPanel = `/api/admin/recovery/events/${eventId}`;
    const eventAct = (body: Record<string, unknown>) => bravoApi.post(eventPanel, { data: { ticket: ticket.number, note: 'e2e: the host is unreachable', ...body } });
    res = await eventAct({ action: 'host', person: bravo.id });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const view = (await readView(bravoApi, eventId)) as unknown as { event: { host_profile_id: string }; participants: { profile_id: string; role: string }[]; viewer: { can_delete: boolean } };
    expect(view.event.host_profile_id).toBe(bravo.id);
    expect(view.viewer.can_delete).toBe(true);
    expect(view.participants.find(p => p.profile_id === alpha.id)?.role).toBe('participant');
    res = await eventAct({ action: 'cancel' });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: ev } = await admin.from('sport_events').select('status').eq('id', eventId).single();
    expect(ev?.status).toBe('cancelled');
    const { data: evLog } = await admin.from('authority_audit').select('action, actor_kind, ticket_id').eq('subject_type', 'sport_event').eq('subject_id', eventId);
    for (const a of ['host_transferred', 'event_cancelled']) {
      expect(((evLog ?? []) as Log[]).find(r => r.action === a), a).toMatchObject({ actor_kind: 'platform', ticket_id: ticketId });
    }

    // The ticket's own history carries every step (internal).
    const { data: history } = await admin.from('ticket_events').select('new_value, visible_to_user').eq('ticket_id', ticketId).eq('kind', 'action_taken');
    const steps = ((history ?? []) as { new_value: string; visible_to_user: boolean }[]);
    for (const a of ['site_held', 'site_released', 'owner_added', 'owner_removed', 'recovery_link_minted', 'host_transferred', 'event_cancelled']) {
      expect(steps.find(s => s.new_value === a), a).toMatchObject({ visible_to_user: false });
    }

    // The owners were told — as Edge Athlete support, never by name.
    const { data: bells } = await admin.from('notifications').select('title, message').eq('user_id', alpha.id).eq('type', 'authority_notice');
    expect((bells ?? []).length).toBeGreaterThan(0);
    for (const b of (bells ?? []) as { title: string; message: string | null }[]) {
      expect(`${b.title} ${b.message ?? ''}`).not.toMatch(new RegExp(bravo.email.split('@')[0], 'i'));
    }
  } finally {
    await cleanupEvent(bravoApi, eventId);
    await cleanupEvent(alphaApi, eventId);
    await deleteQaOrgs(admin, [clubId]);
    if (ticketId) await admin.from('tickets').delete().eq('id', ticketId);
    await admin.from('platform_admins').delete().eq('profile_id', bravo.id);
    await admin.from('notifications').delete().in('type', ['authority_notice', 'ticket_update']).in('user_id', [alpha.id, bravo.id]);
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});

test('the org recovery panel at phone width: ticket + reason gate the actions; pause asks first @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('authority_audit').select('id').limit(1);
  test.skip(!!probe.error, 'authority_audit missing — run migration 240');
  const alphaApi = await apiAs('state.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  await resetRateBucket(admin, 'org-site', alpha.id);
  await resetRateBucket(admin, 'authority-admin', bravo.id);
  const stamp = Date.now();
  let ticketId: string | null = null;
  let clubId: string | null = null;
  try {
    let res = await alphaApi.post('/api/tickets', { data: { type: 'help', reason: 'organizations', subject: 'Pause our site', description: 'Our site was changed by someone.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const ticket = (await res.json()) as { id: string; number: string };
    ticketId = ticket.id;
    clubId = (await createQaOrg(admin, 'club', { name: `QA Recovery Phone ${stamp}`, owner_profile_id: alpha.id })).id;
    await admin.from('memberships').insert({ org_id: clubId, profile_id: alpha.id, role: 'owner' });
    res = await alphaApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'owner' }, { onConflict: 'profile_id' })).error).toBeNull();

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/dashboard/recovery/org/${clubId}?ticket=${encodeURIComponent(ticket.number)}`);
      await expect(page.locator(`[data-recovery-org="${clubId}"]`)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-recovery-ticket]')).toHaveValue(ticket.number);
      const pause = page.locator('[data-recovery-act="hold"]');
      await expect(pause).toBeDisabled(); // no reason yet
      await page.locator('[data-recovery-note]').fill('e2e phone: verified the owner');
      await expect(pause).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      const box = await pause.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await pause.click();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(page.locator('[data-recovery-site-state="held"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-recovery-log-action="site_held"]')).toBeVisible();
    } finally {
      await ctx.close();
    }
  } finally {
    await deleteQaOrgs(admin, [clubId]);
    if (ticketId) await admin.from('tickets').delete().eq('id', ticketId);
    await admin.from('platform_admins').delete().eq('profile_id', bravo.id);
    await admin.from('notifications').delete().in('type', ['authority_notice', 'ticket_update']).in('user_id', [alpha.id, bravo.id]);
    await alphaApi.dispose();
  }
});
