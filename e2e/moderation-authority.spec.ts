import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { cleanupEvent, createEvent, readView } from './helpers/sport-events';

// ── Authority PR 3 (Sep 25 2026): moderation strips authority ───────────────
// Tom: a limited, suspended or banned account loses its org and event
// authority automatically (a limited owner used to keep every power). The
// owner is limited through the service role; their org edit and event edit
// are refused while they still SEE both; lifted, both work again.

test('a limited owner and host cannot run their club or event until the limit lifts', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const stamp = Date.now();
  const owner = loadQaUser('user-b.json');
  const api = await apiAs('state-b.json');
  const club = await createQaOrg(admin, 'club', { name: `QA Ceiling Club ${stamp}`, owner_profile_id: owner.id });
  let eventId: string | null = null;
  try {
    expect((await admin.from('memberships').insert({ org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null })).error).toBeNull();
    const created = await createEvent(api, { name: `QA Ceiling Open ${stamp}`, publish: true });
    eventId = created.event.id;

    // Active: both work.
    expect((await api.patch(`/api/clubs/${club.id}`, { data: { description: `before ${stamp}` } })).ok()).toBe(true);

    // Limited: the power goes, the view stays.
    expect((await admin.from('profiles').update({ moderation_state: 'limited' }).eq('id', owner.id)).error).toBeNull();
    const clubEdit = await api.patch(`/api/clubs/${club.id}`, { data: { description: `during ${stamp}` } });
    expect([401, 403], await readErrorBody(clubEdit)).toContain(clubEdit.status());
    const view = await readView(api, eventId) as unknown as { viewer: { can_manage: boolean; can_delete: boolean; authority_paused?: boolean } };
    expect(view.viewer).toMatchObject({ can_manage: false, can_delete: false, authority_paused: true });
    expect((await api.patch(`/api/sport-events/${eventId}`, { data: { name: `QA Ceiling during ${stamp}` } })).status()).toBe(403);

    // Lifted: back.
    expect((await admin.from('profiles').update({ moderation_state: 'active' }).eq('id', owner.id)).error).toBeNull();
    expect((await api.patch(`/api/clubs/${club.id}`, { data: { description: `after ${stamp}` } })).ok()).toBe(true);
    const after = await readView(api, eventId) as unknown as { viewer: { can_manage: boolean } };
    expect(after.viewer.can_manage).toBe(true);
  } finally {
    // Never leave the shared QA user limited — later specs depend on it.
    await admin.from('profiles').update({ moderation_state: 'active' }).eq('id', owner.id);
    await cleanupEvent(api, eventId);
    await deleteQaOrgs(admin, [club.id]);
    await api.dispose();
  }
});
