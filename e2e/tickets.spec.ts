import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 1 (mig 222) — the ticket backend over the API.
// Alpha (a plain member) files a Help ticket and sees it under My requests;
// bravo is granted a MODERATOR row through the service key (so the queue is
// testable in CI without E2E_ADMIN_EMAIL) and works it: the queue lists it
// with counts, a note stays internal, a reply reaches alpha with the actor
// masked as "support", resolving needs a code, alpha appeals ONCE and a
// second reply is refused, the owner-only routes refuse the moderator, and
// a plain member never sees another's ticket (404, not 403). The rows and
// the role are removed in `finally`. Self-skips pre-222. @mobile.

test('tickets: file, My requests, the moderator queue, reply, resolve, the one appeal, the gates @mobile', async () => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('tickets').select('id').limit(1);
  test.skip(!!probe.error, `tickets missing — run migration 222 (${probe.error?.message})`);

  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  await resetRateBucket(admin, 'ticket-reply', alpha.id);
  const ticketIds: string[] = [];
  try {
    // Pre-role: bravo is a plain member — the queue is 403 and admin/me is 403.
    expect((await bravoApi.get('/api/admin/tickets')).status()).toBe(403);
    expect((await bravoApi.get('/api/admin/me')).status()).toBe(403);

    // Alpha files a Help ticket. The reason must come from the type's list.
    let res = await alphaApi.post('/api/tickets', { data: { type: 'help', reason: 'minor_safety', description: 'x' } });
    expect(res.status()).toBe(400);
    res = await alphaApi.post('/api/tickets', { data: { type: 'help', reason: 'account', subject: 'Cannot change my handle', description: 'The handle field says taken but it is mine.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const created = (await res.json()) as { id: string; number: string; severity: string };
    ticketIds.push(created.id);
    expect(created.number).toMatch(/^EA-\d{4,}$/);
    expect(created.severity).toBe('medium');

    // My requests: the ticket, the user projection only.
    res = await alphaApi.get('/api/tickets');
    const mine = (await res.json()) as { supported: boolean; tickets: Array<Record<string, unknown>> };
    expect(mine.supported).toBe(true);
    const row = mine.tickets.find(t => t.id === created.id)!;
    expect(row).toMatchObject({ number: created.number, status: 'new', canReply: true, replyIsAppeal: false, responseTarget: 'within 2 business days' });
    expect(row).not.toHaveProperty('assignee_profile_id');
    expect(row).not.toHaveProperty('reporter_email');
    // Another member never sees it: 404, not 403 (existence is not disclosed).
    expect((await bravoApi.get(`/api/tickets/${created.id}`)).status()).toBe(404);

    // Bravo becomes a moderator through the service key (the owner-only route is what an owner would use).
    const { error: roleError } = await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'moderator' }, { onConflict: 'profile_id' });
    expect(roleError).toBeNull();
    res = await bravoApi.get('/api/admin/me');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ admin: false, role: 'moderator' });
    // Owner-only routes refuse a moderator by name.
    expect((await bravoApi.get('/api/admin/roles')).status()).toBe(403);
    expect((await bravoApi.delete(`/api/admin/tickets/${created.id}`)).status()).toBe(403);
    expect((await bravoApi.get('/api/admin/reports')).status()).toBe(403); // the pre-222 admin tools stay owner-only

    // The queue lists it with counts; the search by number finds it.
    res = await bravoApi.get('/api/admin/tickets?status=open');
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const queue = (await res.json()) as { supported: boolean; tickets: Array<{ id: string; numberLabel: string; overdue: boolean }>; counts: { openByType: { help: number } } };
    expect(queue.supported).toBe(true);
    expect(queue.tickets.map(t => t.id)).toContain(created.id);
    expect(queue.counts.openByType.help).toBeGreaterThanOrEqual(1);
    res = await bravoApi.get(`/api/admin/tickets?q=${created.number}`);
    expect((await res.json()).tickets.map((t: { id: string }) => t.id)).toEqual([created.id]);

    // Detail: the admin projection, the reporter context, the assignable admins.
    res = await bravoApi.get(`/api/admin/tickets/${created.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const detail = (await res.json()) as { ticket: { status: string; first_response_at: string | null }; reporter: { ticketsFiled: number; strikes: number } | null; assignees: Array<{ profile_id: string }>; events: Array<{ kind: string }> };
    expect(detail.ticket.status).toBe('new');
    expect(detail.reporter?.ticketsFiled).toBeGreaterThanOrEqual(1);
    expect(detail.assignees.map(a => a.profile_id)).toContain(bravo.id);
    expect(detail.events.map(e => e.kind)).toEqual(['created']);

    // An internal note: on the admin history, never on the user's; it stamps the first response.
    res = await bravoApi.post(`/api/admin/tickets/${created.id}/notes`, { data: { body: 'Looks like the handle cache.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.get(`/api/tickets/${created.id}`);
    let userView = (await res.json()) as { ticket: { status: string }; events: Array<{ kind: string; by: string; body: string | null }> };
    expect(JSON.stringify(userView)).not.toContain('handle cache');
    detail.ticket = (await (await bravoApi.get(`/api/admin/tickets/${created.id}`)).json()).ticket;
    expect(detail.ticket.first_response_at).not.toBeNull();

    // Assign + take it into review; then a reply the user sees, masked as "support".
    res = await bravoApi.patch(`/api/admin/tickets/${created.id}`, { data: { status: 'in_review', assignee_profile_id: bravo.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await bravoApi.post(`/api/admin/tickets/${created.id}/reply`, { data: { body: 'Which handle did you try?' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).status).toBe('waiting_on_user');
    res = await alphaApi.get(`/api/tickets/${created.id}`);
    userView = await res.json();
    expect(userView.ticket.status).toBe('waiting_on_user');
    const reply = userView.events.find(e => e.kind === 'reply_to_user')!;
    expect(reply).toMatchObject({ by: 'support', body: 'Which handle did you try?' });
    expect(JSON.stringify(userView)).not.toContain(bravo.id);
    // Alpha's bell.
    const { data: bells } = await admin.from('notifications').select('type, action_url').eq('user_id', alpha.id).eq('type', 'ticket_update');
    expect((bells ?? []).some(b => (b.action_url as string).includes(created.id))).toBe(true);

    // Alpha answers → back in review.
    res = await alphaApi.post(`/api/tickets/${created.id}/reply`, { data: { body: 'tomk' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'in_review', appeal: false });

    // Resolving needs a code; then the outcome reaches alpha with the note.
    res = await bravoApi.patch(`/api/admin/tickets/${created.id}`, { data: { status: 'resolved' } });
    expect(res.status()).toBe(400);
    res = await bravoApi.patch(`/api/admin/tickets/${created.id}`, { data: { status: 'resolved', resolution_code: 'no_action', resolution_note: 'The handle freed up after the cache expired.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.get(`/api/tickets/${created.id}`);
    userView = await res.json();
    expect(userView.ticket).toMatchObject({ status: 'resolved', resolution_code: 'no_action', canReply: true, replyIsAppeal: true });

    // The one appeal reopens it; a second reply after re-resolve is refused.
    res = await alphaApi.post(`/api/tickets/${created.id}/reply`, { data: { body: 'It is still taken.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'in_review', appeal: true });
    res = await bravoApi.patch(`/api/admin/tickets/${created.id}`, { data: { status: 'resolved', resolution_code: 'no_action', resolution_note: 'Confirmed free now.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.post(`/api/tickets/${created.id}/reply`, { data: { body: 'Again?' } });
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain('already been appealed');
    // Close: terminal for the user.
    res = await bravoApi.patch(`/api/admin/tickets/${created.id}`, { data: { status: 'closed' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await alphaApi.post(`/api/tickets/${created.id}/reply`, { data: { body: 'Hello?' } })).status()).toBe(409);
    // The history has every step, append-only.
    const { data: events } = await admin.from('ticket_events').select('kind').eq('ticket_id', created.id).order('created_at');
    // email_sent rows appear only where SMTP is configured — not part of the shape.
    expect((events ?? []).map(e => e.kind).filter(k => k !== 'email_sent')).toEqual([
      'created', 'note', 'status_changed', 'assigned', 'reply_to_user', 'status_changed', 'status_changed', 'user_reply',
      'status_changed', 'reopened', 'user_reply', 'status_changed', 'status_changed',
    ]);

    // Stats answer.
    res = await bravoApi.get('/api/admin/tickets/stats');
    expect(res.status()).toBe(200);
    expect((await res.json()).supported).toBe(true);

    // A Critical report (incident, safety of a minor) bells the moderator now.
    res = await alphaApi.post('/api/tickets', { data: { type: 'report', reason: 'minor_safety', description: 'Someone is messaging kids at our club.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const critical = (await res.json()) as { id: string; severity: string };
    ticketIds.push(critical.id);
    expect(critical.severity).toBe('critical');
    const { data: alerts } = await admin.from('notifications').select('type').eq('user_id', bravo.id).eq('type', 'ticket_critical');
    expect((alerts ?? []).length).toBeGreaterThanOrEqual(1);
  } finally {
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
    await admin.from('platform_admins').delete().eq('profile_id', bravo.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical']).in('user_id', [alpha.id, bravo.id]);
  }
});
