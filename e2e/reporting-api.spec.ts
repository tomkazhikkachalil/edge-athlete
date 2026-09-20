import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 2 (mig 223) — reporting and enforcement over
// the API. Alpha (made public for the spec) posts; bravo reports the post
// (harassment → High) and the ticket carries the SNAPSHOT; charlie's report
// on the same post MERGES; bravo's minor_safety report on a second post is
// Critical → that post is HIDDEN from delta and alpha's account stays active
// (one incident); charlie's third report against alpha is the repeat
// incident → alpha is LIMITED (a post answers 403 account_limited); delta
// (a moderator through the service key) lifts and unhides; resolving with a
// warning notices alpha, who reads the RESTRICTED view (never the reporter,
// the description or the snapshot) and appeals once; resolving with a
// suspension sets the state + the auth ban, lifted by the cron helper; a
// mute drops alpha from bravo's view. Self-skips pre-223. @mobile.

test('reporting: snapshot, merge, Critical hide, repeat-incident limit, actions, the restricted appeal, suspension + auth ban, mute @mobile', async () => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const charlie = loadQaUser('user-c.json');
  const delta = loadQaUser('user-d.json');
  const probe = await admin.from('user_mutes').select('id').limit(1);
  test.skip(!!probe.error, `user_mutes missing — run migration 223 (${probe.error?.message})`);

  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const charlieApi = await apiAs('state-c.json');
  const deltaApi = await apiAs('state-d.json');
  for (const u of [alpha, bravo, charlie]) {
    await resetRateBucket(admin, 'ticket-create', u.id);
    await resetRateBucket(admin, 'post-create', u.id);
  }
  await resetRateBucket(admin, 'mute', bravo.id);
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const postIds: string[] = [];
  const ticketIds: string[] = [];
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    await admin.from('platform_admins').upsert({ profile_id: delta.id, role: 'moderator' }, { onConflict: 'profile_id' });

    // Alpha posts twice, publicly.
    const mk = async (caption: string) => {
      const res = await alphaApi.post('/api/posts', { data: { caption, visibility: 'public', postType: 'general' } });
      expect(res.status(), await readErrorBody(res)).toBe(201);
      const id = (await res.json()).post.id as string;
      postIds.push(id);
      return id;
    };
    const post1 = await mk(`Reportable one ${Date.now()}`);
    const post2 = await mk(`Reportable two ${Date.now()}`);

    // You cannot report your own post (404, not 403).
    expect((await alphaApi.post('/api/tickets', { data: { type: 'report', reason: 'spam_scam', target: { type: 'post', id: post1 } } })).status()).toBe(404);

    // Bravo reports post 1: High, with the snapshot.
    let res = await bravoApi.post('/api/tickets', { data: { type: 'report', reason: 'harassment_bullying', description: 'They keep at it.', target: { type: 'post', id: post1 } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const t1 = (await res.json()) as { id: string; severity: string; merged: boolean };
    ticketIds.push(t1.id);
    expect(t1.severity).toBe('high');
    expect(t1.merged).toBe(false);
    res = await deltaApi.get(`/api/admin/tickets/${t1.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const detail = (await res.json()) as { ticket: { subtype: string; target_profile_id: string; content_snapshot: { kind: string; caption: string; author: { id: string; name: string } } }; target: { profileId: string } | null };
    expect(detail.ticket.subtype).toBe('post');
    expect(detail.ticket.target_profile_id).toBe(alpha.id);
    expect(detail.ticket.content_snapshot.kind).toBe('post');
    expect(detail.ticket.content_snapshot.caption).toContain('Reportable one');
    expect(JSON.stringify(detail.ticket.content_snapshot)).not.toContain('@example.com');
    expect(JSON.stringify(detail.ticket.content_snapshot)).not.toContain('supervision');

    // Charlie reports the same post → merged into t1.
    res = await charlieApi.post('/api/tickets', { data: { type: 'report', reason: 'spam_scam', target: { type: 'post', id: post1 } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const t1b = (await res.json()) as { id: string; merged: boolean };
    ticketIds.push(t1b.id);
    expect(t1b.merged).toBe(true);
    const { data: open1 } = await admin.from('tickets').select('report_count, merged_into_id').eq('id', t1.id).single();
    expect(open1!.report_count).toBe(2);
    const { data: dup } = await admin.from('tickets').select('merged_into_id').eq('id', t1b.id).single();
    expect(dup!.merged_into_id).toBe(t1.id);
    // The queue lists one; charlie's My requests still shows theirs.
    res = await deltaApi.get('/api/admin/tickets?status=open');
    const queueIds = ((await res.json()).tickets as Array<{ id: string }>).map(t => t.id);
    expect(queueIds).toContain(t1.id);
    expect(queueIds).not.toContain(t1b.id);
    res = await charlieApi.get('/api/tickets');
    expect(((await res.json()).tickets as Array<{ id: string }>).map(t => t.id)).toContain(t1b.id);

    // Bravo's minor_safety report on post 2: Critical → hidden from delta; alpha still sees it; alpha NOT limited (one incident).
    res = await bravoApi.post('/api/tickets', { data: { type: 'report', reason: 'minor_safety', target: { type: 'post', id: post2 } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const t2 = (await res.json()) as { id: string; severity: string };
    ticketIds.push(t2.id);
    expect(t2.severity).toBe('critical');
    const { data: hidden } = await admin.from('posts').select('status, hidden_ticket_id').eq('id', post2).single();
    expect(hidden).toEqual({ status: 'hidden', hidden_ticket_id: t2.id });
    expect((await deltaApi.get(`/api/posts?postId=${post2}`)).status()).toBe(404);
    expect((await alphaApi.get(`/api/posts?postId=${post2}`)).status()).toBe(200);
    const { data: p1 } = await admin.from('profiles').select('moderation_state').eq('id', alpha.id).single();
    expect(p1!.moderation_state).toBe('active');

    // Charlie's third report (the profile) → alpha now has 2 other reports in 90 days → LIMITED.
    res = await charlieApi.post('/api/tickets', { data: { type: 'report', reason: 'impersonation', description: 'Not who they say.', target: { type: 'profile', id: alpha.id } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const t3 = (await res.json()) as { id: string; severity: string };
    ticketIds.push(t3.id);
    expect(t3.severity).toBe('high');
    const { data: p2 } = await admin.from('profiles').select('moderation_state, moderation_ticket_id').eq('id', alpha.id).single();
    expect(p2).toEqual({ moderation_state: 'limited', moderation_ticket_id: t3.id });
    res = await alphaApi.post('/api/posts', { data: { caption: 'blocked?', visibility: 'public', postType: 'general' } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('account_limited');
    // Reading and support stay open.
    expect((await alphaApi.get('/api/posts?limit=1')).status()).toBe(200);
    expect((await alphaApi.get('/api/tickets')).status()).toBe(200);

    // The moderator's one-click actions: lift, then unhide.
    res = await deltaApi.post(`/api/admin/tickets/${t3.id}/actions`, { data: { action: 'lift' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.post('/api/posts', { data: { caption: `After lift ${Date.now()}`, visibility: 'public', postType: 'general' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    postIds.push((await res.json()).post.id);
    res = await deltaApi.post(`/api/admin/tickets/${t2.id}/actions`, { data: { action: 'unhide' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await deltaApi.get(`/api/posts?postId=${post2}`)).status()).toBe(200);
    const { data: ev } = await admin.from('ticket_events').select('kind, new_value').eq('ticket_id', t2.id).eq('kind', 'action_taken');
    expect((ev ?? []).map(e => e.new_value)).toEqual(expect.arrayContaining(['hide_post', 'unhide_post']));

    // Resolve t1 with a WARNING → alpha's notice, the restricted view, one appeal.
    res = await deltaApi.patch(`/api/admin/tickets/${t1.id}`, { data: { status: 'resolved', resolution_code: 'warning', resolution_note: 'Keep it civil.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: notices } = await admin.from('notifications').select('title').eq('user_id', alpha.id).eq('type', 'moderation_notice');
    expect((notices ?? []).some(n => (n.title as string).includes('warning'))).toBe(true);
    res = await alphaApi.get('/api/tickets');
    const mine = (await res.json()) as { aboutMe: Array<{ id: string; role: string }> };
    expect(mine.aboutMe.map(t => t.id)).toContain(t1.id);
    res = await alphaApi.get(`/api/tickets/${t1.id}`);
    expect(res.status()).toBe(200);
    const subjectView = await res.json();
    expect(subjectView.ticket).toMatchObject({ role: 'subject', resolution_code: 'warning', resolution_note: 'Keep it civil.', canReply: true, replyIsAppeal: true });
    const serialised = JSON.stringify(subjectView);
    for (const secret of ['They keep at it', 'Reportable one', bravo.id, charlie.id, 'content_snapshot', 'description']) expect(serialised).not.toContain(secret);
    res = await alphaApi.post(`/api/tickets/${t1.id}/reply`, { data: { body: 'I disagree — that was a joke between friends.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'in_review', appeal: true });
    // Bravo (the reporter) still sees their own ticket; alpha's appeal text is in THEIR thread too.
    res = await bravoApi.get(`/api/tickets/${t1.id}`);
    expect(res.status()).toBe(200);
    // The strike is derived: re-resolve as a warning and count.
    res = await deltaApi.patch(`/api/admin/tickets/${t1.id}`, { data: { status: 'resolved', resolution_code: 'warning', resolution_note: 'Reviewed again; the warning stands.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await alphaApi.post(`/api/tickets/${t1.id}/reply`, { data: { body: 'again' } })).status()).toBe(409);
    res = await deltaApi.get(`/api/admin/tickets/${t3.id}`);
    expect(((await res.json()) as { target: { strikes: number } }).target.strikes).toBe(1);

    // Resolve t3 with a SUSPENSION → the state, the until, the auth ban; then the cron-style lift.
    res = await deltaApi.patch(`/api/admin/tickets/${t3.id}`, { data: { status: 'resolved', resolution_code: 'suspension', resolution_note: 'Seven days.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: p3 } = await admin.from('profiles').select('moderation_state, moderation_until').eq('id', alpha.id).single();
    expect(p3!.moderation_state).toBe('suspended');
    expect(Date.parse(p3!.moderation_until as string)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const { data: authUser } = await admin.auth.admin.getUserById(alpha.id);
    expect((authUser.user as unknown as { banned_until?: string | null }).banned_until ?? null).not.toBeNull();
    res = await alphaApi.post('/api/posts', { data: { caption: 'suspended?', visibility: 'public', postType: 'general' } });
    expect(res.status()).toBe(403);
    // The lift (what the daily cron does when moderation_until passes).
    res = await deltaApi.post(`/api/admin/tickets/${t3.id}/actions`, { data: { action: 'lift' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: authUser2 } = await admin.auth.admin.getUserById(alpha.id);
    expect((authUser2.user as unknown as { banned_until?: string | null }).banned_until ?? null).toBeNull();
    const { data: p4 } = await admin.from('profiles').select('moderation_state').eq('id', alpha.id).single();
    expect(p4!.moderation_state).toBe('active');

    // Mute: bravo mutes alpha → alpha's posts leave bravo's view; unmute restores.
    res = await bravoApi.post('/api/mutes', { data: { profileId: alpha.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await bravoApi.get(`/api/posts?userId=${alpha.id}&limit=20`);
    expect(((await res.json()).posts as Array<{ id: string }>).map(p => p.id)).not.toContain(post1);
    expect((await bravoApi.get('/api/mutes').then(r => r.json())).mutedIds).toContain(alpha.id);
    res = await bravoApi.delete('/api/mutes', { data: { profileId: alpha.id } });
    expect(res.status()).toBe(200);
    res = await bravoApi.get(`/api/posts?userId=${alpha.id}&limit=20`);
    expect(((await res.json()).posts as Array<{ id: string }>).map(p => p.id)).toContain(post1);
  } finally {
    await admin.from('profiles').update({ visibility: prior?.visibility ?? 'private', moderation_state: 'active', moderation_until: null, moderation_ticket_id: null }).eq('id', alpha.id);
    await admin.auth.admin.updateUserById(alpha.id, { ban_duration: 'none' }).catch(() => null);
    if (postIds.length > 0) await admin.from('posts').delete().in('id', postIds);
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
    await admin.from('user_mutes').delete().eq('muter_id', bravo.id);
    await admin.from('platform_admins').delete().eq('profile_id', delta.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical', 'moderation_notice']).in('user_id', [alpha.id, bravo.id, charlie.id, delta.id]);
  }
});
