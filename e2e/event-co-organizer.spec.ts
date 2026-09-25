import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, openEventSession, readView } from './helpers/sport-events';

// ── Authority PR 2 (Sep 25 2026): every event gets a BACKUP ──────────────────
// Tom: "there always needs to be two accounts to create an event" — as a
// warning, never a block. The host invites a co-organizer; until they accept
// the backup is pending; once accepted they run the event with the host
// (but never mint peers), and the host can hand the event over. Every change
// lands in the authority log.

type Row = { id: string; profile_id: string; role: string; status: string; playing: boolean };
type View = { event: { id: string; host_profile_id: string; status: string }; participants: Row[]; viewer: { can_manage: boolean; can_delete: boolean; backup?: string | null; participant_id: string | null } };

test('co-organizer: invite → pending → accepted backup; the host hands the event over', async () => {
  test.setTimeout(120_000);
  const s = await openEventSession();
  const admin = adminClient();
  let eventId: string | null = null;
  try {
    const created = await createEvent(s.apiA, { name: `QA Backup ${s.stamp}`, publish: true });
    eventId = created.event.id;
    let asA = (await readView(s.apiA, eventId)) as unknown as View;
    expect(asA.viewer.backup, 'a new event has no backup').toBe('none');

    // A co-organizer who does not play takes no seat.
    const invited = await s.apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [s.userB.id], role: 'co_organizer', playing: false } });
    expect(invited.ok(), await readErrorBody(invited)).toBe(true);
    asA = (await readView(s.apiA, eventId)) as unknown as View;
    expect(asA.viewer.backup, 'invited is pending, not yet a backup').toBe('pending');

    // B, invited but not accepted, cannot run it yet.
    let asB = (await readView(s.apiB, eventId)) as unknown as View;
    expect(asB.viewer.can_manage).toBe(false);
    const accept = await s.apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } });
    expect(accept.ok(), await readErrorBody(accept)).toBe(true);
    asA = (await readView(s.apiA, eventId)) as unknown as View;
    expect(asA.viewer.backup, 'an accepted co-organizer is the backup').toBe('ok');
    const bRow = asA.participants.find(p => p.profile_id === s.userB.id)!;
    expect(bRow).toMatchObject({ role: 'co_organizer', status: 'accepted', playing: false });

    // B runs the event with A — but never mints a peer, and cannot delete.
    asB = (await readView(s.apiB, eventId)) as unknown as View;
    expect(asB.viewer.can_manage).toBe(true);
    expect(asB.viewer.can_delete).toBe(false);
    const renamed = await s.apiB.patch(`/api/sport-events/${eventId}`, { data: { name: `QA Backup renamed ${s.stamp}` } });
    expect(renamed.ok(), await readErrorBody(renamed)).toBe(true);
    const peer = await s.apiB.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [s.userA.id], role: 'co_organizer' } });
    expect(peer.status(), 'a co-organizer cannot invite a co-organizer').toBe(403);

    // A hands the event to B; A stays on as a co-organizer.
    const handover = await s.apiA.post(`/api/sport-events/${eventId}/participants/${bRow.id}`, { data: { action: 'make_host' } });
    expect(handover.ok(), await readErrorBody(handover)).toBe(true);
    asB = (await readView(s.apiB, eventId)) as unknown as View;
    expect(asB.event.host_profile_id).toBe(s.userB.id);
    expect(asB.viewer.can_delete).toBe(true);
    const aRow = asB.participants.find(p => p.profile_id === s.userA.id)!;
    expect(aRow.role).toBe('co_organizer');
    asA = (await readView(s.apiA, eventId)) as unknown as View;
    expect(asA.viewer.can_delete).toBe(false);

    // A steps down to a plain player.
    const down = await s.apiA.post(`/api/sport-events/${eventId}/participants/${aRow.id}`, { data: { action: 'step_down' } });
    expect(down.ok(), await readErrorBody(down)).toBe(true);
    asA = (await readView(s.apiA, eventId)) as unknown as View;
    expect(asA.viewer.can_manage).toBe(false);

    // Every change is in the authority log.
    const { data: log } = await admin.from('authority_audit').select('action').eq('subject_type', 'sport_event').eq('subject_id', eventId);
    const actions = (log ?? []).map(r => r.action as string);
    for (const a of ['co_organizer_invited', 'co_organizer_added', 'event_details_changed', 'host_transferred', 'co_organizer_removed']) {
      expect(actions, a).toContain(a);
    }
  } finally {
    // B is the host now — B tears it down (a stale host id is a no-op).
    await cleanupEvent(s.apiB, eventId);
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});

test('the backup banner on the event page, at phone width @mobile', async ({ browser }) => {
  test.setTimeout(90_000);
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    const created = await createEvent(s.apiA, { name: `QA Backup Banner ${s.stamp}`, publish: true });
    eventId = created.event.id;
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/events/${eventId}`);
      const banner = page.locator('[data-backup-banner="none"][data-backup-subject="event"]');
      await expect(banner).toBeVisible({ timeout: 20_000 });
      // The one action opens the invite window with "Invite as co-organizer" ticked.
      await banner.locator('[data-backup-act]').click();
      await expect(page.locator('[data-event-invite-co-organizer]')).toBeChecked();
      const box = await banner.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    } finally {
      await ctx.close();
    }
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
