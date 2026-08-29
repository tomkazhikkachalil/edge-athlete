import { test, expect, request } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// Family console (Aug 19) — the first guardian e2e coverage. The guardian
// feature is behind the build-time flag FEATURE_GUARDIAN_PROFILES: ON in
// .env.local (which the local webServer build reads), NOT set in CI — so the
// suite probes the flag and green-skips when the feature is dark.
//
// Serial: one child profile threads through every test, deleted in the
// cleanup test even when earlier steps fail. NOTE the QA sweep only matches
// edgeqa-* emails; a killed run can orphan the child's @minors.invalid
// shadow user — the always-run cleanup here is the mitigation.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const HANDLE = `eaqa_rider_${stamp}`;
const PIN = '4321';
let flagOn = true;
let childId = '';

test('setup: probe the flag and create a managed athlete', async () => {
  const api = await apiAs('state.json');
  try {
    // Flag probe: with the feature dark the route 404s before validation;
    // with it on, an empty body is a 400.
    const probe = await api.post('/api/guardian/athletes', { data: {} });
    if (probe.status() === 404) {
      flagOn = false;
      test.skip(true, 'guardian flag off in this environment');
      return;
    }
    expect(probe.status()).toBe(400);

    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15))
      .toISOString().split('T')[0];
    const res = await api.post('/api/guardian/athletes', {
      data: { first_name: 'Junior', last_name: 'Console', dob, handle: HANDLE },
    });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    childId = (await res.json()).profileId;
    expect(childId).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('console: roster card, chips, and the attention strip', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  await page.goto('/app/guardian');
  const main = page.locator('main');
  // Scope to main — the always-mounted off-canvas drawer also carries text.
  await expect(main.getByText('Junior Console').first()).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText('Consent needed')).toBeVisible();
  await expect(main.getByText('No login yet', { exact: true }).first()).toBeVisible();
  await expect(main.getByText(`Finish consent for Junior Console`)).toBeVisible();
});

test('per-athlete: safety change persists; going public is consent-gated', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  await page.goto(`/app/guardian/athlete/${childId}`);
  await expect(page.getByRole('heading', { name: 'Safety' })).toBeVisible({ timeout: 15_000 });

  // Messaging: nobody → fans_only, saved via the PATCH, survives a reload.
  await page.getByRole('button', { name: /Fans only/ }).click();
  await expect(page.getByText('Safety settings updated.')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Safety' })).toBeVisible();
  await expect
    .poll(async () =>
      page.getByRole('button', { name: /Fans only/ }).evaluate(el => el.className.includes('border-brand'))
    )
    .toBe(true);

  // Visibility: public must be refused until consent approves, verbatim copy,
  // and the optimistic selection must revert.
  await page.getByRole('button', { name: /^Public/ }).click();
  await expect(
    page.getByText('Complete the consent review before making this profile public.')
  ).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () =>
      page.getByRole('button', { name: /^Private/ }).evaluate(el => el.className.includes('border-brand'))
    )
    .toBe(true);
});

test('athlete side: child login sees their guardian; a pending post rings the guardian bell', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  const child = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const cred = await api.post(`/api/guardian/athletes/${childId}/credentials`, {
      data: { mode: 'pin', secret: PIN },
    });
    expect(cred.ok(), await readErrorBody(cred)).toBe(true);

    const login = await child.post('/api/auth/username-login', {
      data: { username: HANDLE, secret: PIN },
    });
    expect(login.ok(), await readErrorBody(login)).toBe(true);

    // The request context carries the session cookies the login set.
    const guardians = await child.get('/api/profile/guardians');
    expect(guardians.ok(), await readErrorBody(guardians)).toBe(true);
    const body = await guardians.json();
    // The QA user's display name comes from global-setup; assert the LINK
    // exists rather than a specific name (one guardian row, role guardian).
    expect(body.guardians?.length).toBe(1);
    expect(body.guardians[0].role).toBe('guardian');

    // Round 1 (guardian notifications): a supervised author's post is forced
    // to pending_approval AND pushes a notification to the guardian's bell.
    const post = await child.post('/api/posts', {
      data: { caption: `qa pending ${stamp}`, visibility: 'private' },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);

    await page.goto('/app/notifications');
    await expect(
      page.getByText('Junior shared a post that needs your review').first()
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await child.dispose();
    await api.dispose();
  }
});

test('queue + richer cards: hub action row with consent hint; approvals audience chip and athlete filter', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');

  // Wave 2 queue: the pending post from the previous test surfaces as a
  // typed hub row, with the consent coupling made visible (approve will 403
  // until the consent review completes).
  await page.goto('/app/guardian');
  const main = page.locator('main');
  await expect(
    main.getByText('Junior Console shared a post for your review')
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    main.getByText('Consent needed before you can approve').first()
  ).toBeVisible();

  // Richer approval card: audience chip (the post was created private) and
  // the ?athlete= deep-link filter the hub rows and roster badges use.
  await page.goto(`/app/guardian/approvals?athlete=${childId}`);
  await expect(page.getByText('Showing only Junior Console')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Private — fans only').first()).toBeVisible();
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.getByText('Showing only Junior Console')).toHaveCount(0);
});

test('send-back loop (129): request_changes with note → child edits → back to pending; comments via scoped edit', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  const child = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const login = await child.post('/api/auth/username-login', {
      data: { username: HANDLE, secret: PIN },
    });
    expect(login.ok(), await readErrorBody(login)).toBe(true);

    // The pending post from the earlier test: find it as the child.
    const feed = await child.get('/api/posts?limit=10');
    expect(feed.ok(), await readErrorBody(feed)).toBe(true);
    const pending = (await feed.json()).posts?.find(
      (p: { status?: string; caption?: string }) =>
        p.status === 'pending_approval' && p.caption?.includes('qa pending')
    );
    expect(pending, 'the pending post from the earlier test should be visible to its author').toBeTruthy();

    // Guardian sends it back with a note.
    const sendBack = await api.patch('/api/posts', {
      data: { postId: pending.id, action: 'request_changes', note: 'Crop out the street sign please' },
    });
    expect(sendBack.ok(), await readErrorBody(sendBack)).toBe(true);
    expect((await sendBack.json()).status).toBe('changes_requested');

    // Terminal-state guard: a sent-back post is no longer decidable.
    const reDecide = await api.patch('/api/posts', {
      data: { postId: pending.id, action: 'request_changes' },
    });
    expect(reDecide.status()).toBe(400);

    // The child sees the state + note; their edit IS the resubmit.
    const asChild = await child.get(`/api/posts?postId=${pending.id}`);
    expect(asChild.ok(), await readErrorBody(asChild)).toBe(true);
    const childView = (await asChild.json()).post;
    expect(childView.status).toBe('changes_requested');
    expect(childView.review_note).toBe('Crop out the street sign please');

    const edit = await child.put('/api/posts', {
      data: { postId: pending.id, caption: `qa pending ${stamp} (edited)` },
    });
    expect(edit.ok(), await readErrorBody(edit)).toBe(true);
    expect((await edit.json()).resubmitted).toBe(true);

    const after = await child.get(`/api/posts?postId=${pending.id}`);
    const afterView = (await after.json()).post;
    expect(afterView.status).toBe('pending_approval');
    expect(afterView.review_note).toBeNull();

    // Guardian bell carries the resubmit notification.
    await page.goto('/app/notifications');
    await expect(
      page.getByText('Junior updated a post for your review').first()
    ).toBeVisible({ timeout: 15_000 });

    // Comment loop: held comment → send back → scoped edit resubmit.
    const commentRes = await child.post('/api/comments', {
      data: { postId: pending.id, content: `qa held comment ${stamp}` },
    });
    expect(commentRes.status(), await readErrorBody(commentRes)).toBe(201);
    const heldComment = (await commentRes.json()).comment;

    const sendBackComment = await api.patch('/api/comments', {
      data: { commentId: heldComment.id, postId: pending.id, action: 'request_changes', note: 'Kinder words please' },
    });
    expect(sendBackComment.ok(), await readErrorBody(sendBackComment)).toBe(true);

    // Guardian cannot use the child's edit path...
    const guardianEdit = await api.patch('/api/comments', {
      data: { commentId: heldComment.id, postId: pending.id, action: 'edit', content: 'nope' },
    });
    expect(guardianEdit.status()).toBe(403);

    // ...the author can, and only from changes_requested.
    const commentEdit = await child.patch('/api/comments', {
      data: { commentId: heldComment.id, postId: pending.id, action: 'edit', content: `qa kinder comment ${stamp}` },
    });
    expect(commentEdit.ok(), await readErrorBody(commentEdit)).toBe(true);
    expect((await commentEdit.json()).status).toBe('pending_approval');

    const reEdit = await child.patch('/api/comments', {
      data: { commentId: heldComment.id, postId: pending.id, action: 'edit', content: 'twice' },
    });
    expect(reEdit.status()).toBe(400);
  } finally {
    await child.dispose();
    await api.dispose();
  }
});

test('calendar surface: invite → hub week strip + queue row → inline decline as child', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    // Probe the calendar flag the same way the suite probes guardian.
    const start = new Date(Date.now() + 2 * 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const created = await api.post('/api/calendar/events', {
      data: {
        title: `QA family practice ${stamp}`,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        guests: { profile_ids: [childId] },
      },
    });
    if (created.status() === 404) {
      test.skip(true, 'calendar flag off in this environment');
      return;
    }
    expect(created.ok(), await readErrorBody(created)).toBe(true);

    await page.goto('/app/guardian');
    const main = page.locator('main');
    // The merged week strip and the queue's calendar_invite row.
    await expect(main.getByText('This week')).toBeVisible({ timeout: 15_000 });
    const inviteRow = main
      .getByText(`Junior Console was invited: QA family practice ${stamp}`);
    await expect(inviteRow).toBeVisible();

    // Inline decline responds AS THE CHILD (guest row stays the child's).
    // The invite row is the only Decline button in this scenario (no fan
    // requests exist at this point in the serial flow).
    await main.getByRole('button', { name: 'Decline' }).click();
    await expect(inviteRow).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await api.dispose();
  }
});

test('co-guardian lifecycle: invite → claim → roster of two → revoke → last-guardian block', async () => {
  test.skip(!flagOn, 'guardian flag off');
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    // A invites B by email; the URL is returned regardless of SMTP.
    const invite = await apiA.post(`/api/guardian/athletes/${childId}/guardians`, {
      data: { email: userB.email },
    });
    expect(invite.ok(), await readErrorBody(invite)).toBe(true);
    const { inviteUrl } = await invite.json();
    const token = String(inviteUrl).split('/invite/')[1];
    expect(token?.length).toBeGreaterThan(20);

    // B claims — the existing claim route validates and grants.
    const claim = await apiB.post(`/api/invites/${token}/claim`);
    expect(claim.ok(), await readErrorBody(claim)).toBe(true);

    // Roster of two, and the second-invite gate closes.
    const list = await apiA.get(`/api/guardian/athletes/${childId}/guardians`);
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    expect((await list.json()).guardians.length).toBe(2);
    const third = await apiA.post(`/api/guardian/athletes/${childId}/guardians`, {
      data: { email: 'edgeqa-third@example.com' },
    });
    expect(third.status()).toBe(409);

    // While B is a co-guardian: an event UPDATE touching the child bells
    // co-guardians (Wave 2 fan-out — the actor is excluded, so only B can
    // observe it; a solo guardian updating their own event alerts nobody).
    const evStart = new Date(Date.now() + 3 * 86_400_000);
    const ev = await apiA.post('/api/calendar/events', {
      data: {
        title: `QA co-guardian event ${stamp}`,
        starts_at: evStart.toISOString(),
        ends_at: new Date(evStart.getTime() + 3_600_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        guests: { profile_ids: [childId] },
      },
    });
    if (ev.ok()) {
      const evId = (await ev.json()).event?.id;
      const moved = await apiA.patch(`/api/calendar/events/${evId}`, {
        data: { title: `QA co-guardian event ${stamp} (moved)` },
      });
      expect(moved.ok(), await readErrorBody(moved)).toBe(true);
      const bell = await apiB.get('/api/notifications');
      expect(bell.ok(), await readErrorBody(bell)).toBe(true);
      const rows = (await bell.json()).notifications ?? [];
      expect(
        rows.some(
          (n: { type?: string; title?: string }) =>
            n.type === 'calendar_alert' && (n.title ?? '').includes('changed an event')
        ),
        'co-guardian should get the calendar_alert for the event update'
      ).toBe(true);
    }

    // A revokes B; roster back to one.
    const revoke = await apiA.delete(`/api/guardian/athletes/${childId}/guardians`, {
      data: { guardianUserId: userB.id },
    });
    expect(revoke.ok(), await readErrorBody(revoke)).toBe(true);
    const after = await apiA.get(`/api/guardian/athletes/${childId}/guardians`);
    expect((await after.json()).guardians.length).toBe(1);

    // The invariant: the last guardian cannot remove themselves.
    const me = loadQaUser('user.json');
    const selfRemove = await apiA.delete(`/api/guardian/athletes/${childId}/guardians`, {
      data: { guardianUserId: me.id },
    });
    expect(selfRemove.status()).toBe(409);
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('view-only seat (W8, mig 138): viewer invite → claim → reads roster+calendar, writes 403 → revoke', async () => {
  test.skip(!flagOn, 'guardian flag off');
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    // A invites B as VIEW ONLY (B's guardian link from the previous test was
    // revoked; any existing link would 409 the claim).
    const invite = await apiA.post(`/api/guardian/athletes/${childId}/guardians`, {
      data: { email: userB.email, role: 'viewer' },
    });
    expect(invite.ok(), await readErrorBody(invite)).toBe(true);
    const inviteBody = await invite.json();
    expect(inviteBody.role).toBe('viewer');
    const token = String(inviteBody.inviteUrl).split('/invite/')[1];

    const claim = await apiB.post(`/api/invites/${token}/claim`);
    expect(claim.ok(), await readErrorBody(claim)).toBe(true);
    expect((await claim.json()).role).toBe('viewer');

    // B READS: roster (readOnly flag set) and the child's calendar.
    const roster = await apiB.get('/api/guardian/athletes');
    expect(roster.ok(), await readErrorBody(roster)).toBe(true);
    const rosterBody = await roster.json();
    expect(rosterBody.readOnly).toBe(true);
    expect(rosterBody.athletes.some((a: { id: string }) => a.id === childId)).toBe(true);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const cal = await apiB.get(
      `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&targetProfileId=${childId}`
    );
    expect(cal.ok(), await readErrorBody(cal)).toBe(true);

    // B WRITES: every guardian action gate refuses a viewer.
    const patch = await apiB.patch(`/api/guardian/athletes/${childId}`, {
      data: { messaging_permission: 'everyone' },
    });
    expect(patch.status()).toBe(403);
    const household = await apiB.post('/api/guardian/household/apply', { data: {} });
    expect(household.status()).toBe(403);

    // The guardians list shows the seat with its role; A revokes it freely
    // (no last-guardian coupling for viewers).
    const list = await apiA.get(`/api/guardian/athletes/${childId}/guardians`);
    const seats = (await list.json()).guardians as Array<{ user_id: string; role: string }>;
    expect(seats.find(s => s.user_id === userB.id)?.role).toBe('viewer');
    const revoke = await apiA.delete(`/api/guardian/athletes/${childId}/guardians`, {
      data: { guardianUserId: userB.id },
    });
    expect(revoke.ok(), await readErrorBody(revoke)).toBe(true);
    // No link at all → the roster comes back empty for B.
    const after = await apiB.get('/api/guardian/athletes');
    expect(after.ok(), await readErrorBody(after)).toBe(true);
    expect((await after.json()).athletes.length).toBe(0);
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('consent signature (130 + W6 auto-approve): method cards swap the statement; typed signature approves instantly', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');

  // UI: three method cards; picking one swaps the statement's closing.
  await page.goto(`/app/guardian/consent/${childId}`);
  await expect(page.getByRole('radio', { name: /Sign on screen/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('radio', { name: /Type your name/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Upload a signed form/ })).toBeVisible();
  // Default = drawn.
  await expect(page.getByText('sign in the box below')).toBeVisible();
  await page.getByRole('radio', { name: /Type your name/ }).click();
  await expect(page.getByText('type your full legal name below')).toBeVisible();
  await page.getByRole('radio', { name: /Upload a signed form/ }).click();
  await expect(page.getByText('print or write this statement')).toBeVisible();

  // API: a typed-signature submission (signature-card PNG) auto-approves
  // (Wave 6 — the second append-only review_approved row rides the same
  // request; the admin queue is now the after-the-fact audit).
  const api = await apiAs('state.json');
  try {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const bogus = await api.post(`/api/guardian/athletes/${childId}/consent`, {
      multipart: {
        method: 'card_charge', // DB-only value — the API must refuse it
        evidence: { name: 'signature.png', mimeType: 'image/png', buffer: png },
      },
    });
    expect(bogus.status()).toBe(400);

    const res = await api.post(`/api/guardian/athletes/${childId}/consent`, {
      multipart: {
        method: 'typed_signature',
        evidence: { name: 'signature.png', mimeType: 'image/png', buffer: png },
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    expect((await res.json()).state).toBe('approved');

    // Idempotency short-circuit.
    const again = await api.post(`/api/guardian/athletes/${childId}/consent`, {
      multipart: {
        method: 'typed_signature',
        evidence: { name: 'signature.png', mimeType: 'image/png', buffer: png },
      },
    });
    expect(again.ok(), await readErrorBody(again)).toBe(true);
    expect((await again.json()).already).toBe(true);
  } finally {
    await api.dispose();
  }
});

test('first-contact hold (131): tiers first → hold → invisible to child → approve → visible → deny → re-hold', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  const apiB = await apiAs('state-b.json'); // revoked co-guardian = a genuine stranger now
  const child = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    // Tiers run FIRST: the safety test left messaging at fans_only — a
    // stranger's create must 403 before the hold is ever consulted.
    const tierBlocked = await apiB.post('/api/messages', {
      data: { type: 'direct', participantId: childId },
    });
    expect(tierBlocked.status(), await readErrorBody(tierBlocked)).toBe(403);

    // Guardian opens the tier; the stranger's create now HOLDS.
    const open = await api.patch(`/api/guardian/athletes/${childId}`, {
      data: { messaging_permission: 'everyone' },
    });
    expect(open.ok(), await readErrorBody(open)).toBe(true);

    const created = await apiB.post('/api/messages', {
      data: { type: 'direct', participantId: childId },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const { conversationId, held } = await created.json();
    expect(held).toBe(true);
    const sent = await apiB.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'text', content: `qa held hello ${stamp}` },
    });
    expect(sent.status(), await readErrorBody(sent)).toBe(201);

    // The child sees NOTHING: list excludes it, thread 404s, badge is zero.
    const login = await child.post('/api/auth/username-login', {
      data: { username: HANDLE, secret: PIN },
    });
    expect(login.ok(), await readErrorBody(login)).toBe(true);
    const childList = await child.get('/api/messages');
    expect(
      ((await childList.json()).conversations ?? []).some(
        (c: { id: string }) => c.id === conversationId
      )
    ).toBe(false);
    expect((await child.get(`/api/messages/${conversationId}`)).status()).toBe(404);
    expect((await (await child.get('/api/messages/unread-count')).json()).count ?? 0).toBe(0);

    // The SENDER still sees it, with the child's row held.
    const senderList = await apiB.get('/api/messages');
    const senderConv = ((await senderList.json()).conversations ?? []).find(
      (c: { id: string }) => c.id === conversationId
    );
    expect(senderConv, 'sender keeps their view of the held conversation').toBeTruthy();
    expect(
      senderConv.participants.some(
        (p: { profile_id: string; held_at?: string | null }) => p.profile_id === childId && p.held_at
      )
    ).toBe(true);

    // Guardian bell + hub queue row → inline Approve.
    const bell = await api.get('/api/notifications');
    expect(
      ((await bell.json()).notifications ?? []).some(
        (n: { type?: string; title?: string }) =>
          n.type === 'safety_alert' && (n.title ?? '').includes('Someone new wants to message')
      )
    ).toBe(true);
    await page.goto('/app/guardian');
    const main = page.locator('main');
    await expect(main.getByText(/wants to message Junior Console/)).toBeVisible({ timeout: 15_000 });
    await main.getByRole('button', { name: 'Approve' }).click();
    await expect(main.getByText(/wants to message Junior Console/)).toHaveCount(0, { timeout: 10_000 });

    // Approved: the thread appears for the child with its unread count.
    const afterList = await child.get('/api/messages');
    const childConv = ((await afterList.json()).conversations ?? []).find(
      (c: { id: string }) => c.id === conversationId
    );
    expect(childConv, 'approved conversation appears for the child').toBeTruthy();
    expect(childConv.unread_count).toBeGreaterThanOrEqual(1);

    // Approved contacts stay open: another send does not re-hold.
    const sent2 = await apiB.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'text', content: `qa hello again ${stamp}` },
    });
    expect(sent2.status(), await readErrorBody(sent2)).toBe(201);
    const stillVisible = await child.get(`/api/messages/${conversationId}`);
    expect(stillVisible.ok()).toBe(true);

    // Deny (quiet removal): both rows sever; the sender's list drops it.
    const deny = await api.post(`/api/guardian/athletes/${childId}/contacts`, {
      data: { contactProfileId: loadQaUser('user-b.json').id, decision: 'deny' },
    });
    expect(deny.ok(), await readErrorBody(deny)).toBe(true);
    const senderAfterDeny = await apiB.get('/api/messages');
    expect(
      ((await senderAfterDeny.json()).conversations ?? []).some(
        (c: { id: string }) => c.id === conversationId
      )
    ).toBe(false);

    // Repeatable: a retry revives the thread — held again.
    const retry = await apiB.post('/api/messages', {
      data: { type: 'direct', participantId: childId },
    });
    expect(retry.ok(), await readErrorBody(retry)).toBe(true);
    expect((await retry.json()).held).toBe(true);
  } finally {
    await child.dispose();
    await apiB.dispose();
    await api.dispose();
  }
});

test('contact roster + escalation: metadata-only rows; child escalates a thread to the guardian bell', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const child = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    // Fixture state from the hold test: user-b's retry left a HELD thread.
    // Approve it so the child can see (and escalate) the conversation.
    const userB = loadQaUser('user-b.json');
    const approve = await api.post(`/api/guardian/athletes/${childId}/contacts`, {
      data: { contactProfileId: userB.id, decision: 'approve' },
    });
    expect(approve.ok(), await readErrorBody(approve)).toBe(true);

    // Roster: one row for user-b, approved, metadata ONLY — the payload must
    // carry no message content anywhere.
    const roster = await api.get(`/api/guardian/athletes/${childId}/contacts`);
    expect(roster.ok(), await readErrorBody(roster)).toBe(true);
    const { contacts } = await roster.json();
    const row = contacts.find((c: { profileId: string }) => c.profileId === userB.id);
    expect(row, 'user-b appears on the roster').toBeTruthy();
    expect(row.state).toBe('approved');
    expect(['few', 'regular', 'frequent']).toContain(row.volumeBand);
    expect(JSON.stringify(contacts)).not.toContain('qa held hello');

    // Non-guardian access is refused.
    const stranger = await apiB.get(`/api/guardian/athletes/${childId}/contacts`);
    expect(stranger.status()).toBe(403);

    // Child escalates the (now visible) conversation.
    const login = await child.post('/api/auth/username-login', {
      data: { username: HANDLE, secret: PIN },
    });
    expect(login.ok(), await readErrorBody(login)).toBe(true);
    const childList = await child.get('/api/messages');
    const conv = ((await childList.json()).conversations ?? []).find(
      (c: { type: string }) => c.type === 'direct'
    );
    expect(conv, 'the approved conversation is visible to the child').toBeTruthy();
    const escalate = await child.post(`/api/messages/${conv.id}/escalate`);
    expect(escalate.ok(), await readErrorBody(escalate)).toBe(true);

    // Adults can't use the child's lever.
    const adultEscalate = await apiB.post(`/api/messages/${conv.id}/escalate`);
    expect(adultEscalate.status()).toBe(403);

    // The guardian bell carries the escalation with the ?contact= deep link.
    const bell = await api.get('/api/notifications');
    const alert = ((await bell.json()).notifications ?? []).find(
      (n: { type?: string; title?: string }) =>
        n.type === 'safety_alert' && (n.title ?? '').includes('wants you to see a conversation')
    );
    expect(alert, 'escalation safety_alert reaches the guardian').toBeTruthy();
    expect(alert.action_url).toContain(`/app/guardian/athlete/${childId}?contact=`);

    // The deep link lands on a highlighted roster row.
    await page.goto(alert.action_url);
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('never what was said')).toBeVisible();
  } finally {
    await child.dispose();
    await apiB.dispose();
    await api.dispose();
  }
});

test('household policy (132): defaults save on the settings page; a new athlete inherits with the visibility clamp', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  test.setTimeout(120_000); // settings UI + polls + a full athlete create
  const api = await apiAs('state.json');
  const inheritHandle = `eaqa_h_${stamp}`; // ≤20 chars (handle cap)
  let inheritedId = '';
  try {
    // Settings page: adopt fans_only messaging + a PUBLIC default (the clamp
    // proof) via the RadioCards.
    await page.goto('/app/guardian/settings');
    await expect(page.getByRole('heading', { name: 'Household defaults' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Fans only/ }).first().click();
    await expect(page.getByText('Household defaults saved').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Public/ }).first().click();
    await expect(page.getByText('New athletes still start private')).toBeVisible({ timeout: 10_000 });

    // Server echo carries the sanitized policy. Poll — the helper text
    // renders optimistically, so the PATCH may still be in flight.
    await expect
      .poll(async () => {
        const echo = await api.get('/api/guardian/household');
        const { policy } = await echo.json();
        return [policy?.defaults?.messaging_permission, policy?.defaults?.visibility];
      }, { timeout: 10_000 })
      .toEqual(['fans_only', 'public']);

    // A new athlete inherits messaging — and visibility clamps to private.
    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15))
      .toISOString().split('T')[0];
    const created = await api.post('/api/guardian/athletes', {
      data: { first_name: 'Heir', last_name: 'Console', dob, handle: inheritHandle },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    inheritedId = (await created.json()).profileId;

    const roster = await api.get('/api/guardian/athletes');
    const heir = ((await roster.json()).athletes ?? []).find(
      (a: { id: string }) => a.id === inheritedId
    );
    expect(heir, 'inherited athlete on the roster').toBeTruthy();
    expect(heir.messaging_permission).toBe('fans_only');
    expect(heir.visibility).toBe('private');
  } finally {
    if (inheritedId) {
      await api.delete(`/api/guardian/athletes/${inheritedId}`, {
        data: { confirmHandle: inheritHandle },
      }).catch(() => {});
    }
    // Reset the policy so earlier-test assumptions hold on re-runs.
    await api.patch('/api/guardian/household', { data: null }).catch(() => {});
    await api.dispose();
  }
});

test('apply-to-all + deviation + safety feed: chips appear, one confirm reverts, the audit feed names the actor', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    // Adopt a policy (fans_only messaging), then push the child OFF it.
    const adopt = await api.patch('/api/guardian/household', {
      data: { defaults: { messaging_permission: 'fans_only' } },
    });
    expect(adopt.ok(), await readErrorBody(adopt)).toBe(true);
    const push = await api.patch(`/api/guardian/athletes/${childId}`, {
      data: { messaging_permission: 'nobody' },
    });
    expect(push.ok(), await readErrorBody(push)).toBe(true);

    // Deviation surfaces server-side first (poll — writes may still be
    // settling), then the chips.
    await expect
      .poll(async () => {
        const roster = await api.get('/api/guardian/athletes');
        const me = ((await roster.json()).athletes ?? []).find(
          (a: { id: string }) => a.id === childId
        );
        return me?.deviations ?? [];
      }, { timeout: 10_000 })
      .toContain('messaging_permission');

    // Deviation chips: hub roster + athlete-page per-field.
    await page.goto('/app/guardian');
    await expect(
      page.locator('main').getByText('Differs from household').first()
    ).toBeVisible({ timeout: 15_000 });
    await page.goto(`/app/guardian/athlete/${childId}`);
    await expect(page.getByText('Differs from household').first()).toBeVisible({ timeout: 15_000 });

    // Apply-to-all: one confirm, then the child matches and chips clear.
    await page.goto('/app/guardian/settings');
    await expect(page.getByRole('heading', { name: 'Apply to your athletes' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Apply to all athletes' }).click();
    await expect(page.getByText('Apply household defaults to all athletes?')).toBeVisible();
    await page.getByRole('button', { name: 'Apply to all', exact: true }).click();
    await expect(page.getByText(/Updated 1 athlete|Already matching/).first()).toBeVisible({ timeout: 10_000 });

    const roster = await api.get('/api/guardian/athletes');
    const child = ((await roster.json()).athletes ?? []).find(
      (a: { id: string }) => a.id === childId
    );
    expect(child.messaging_permission).toBe('fans_only');
    expect(child.deviations).toEqual([]);

    // The safety feed (first reader of 091) names the actor and the flip.
    const audit = await api.get('/api/guardian/audit');
    expect(audit.ok(), await readErrorBody(audit)).toBe(true);
    const { events } = await audit.json();
    const applied = events.find(
      (e: { field: string; oldValue: string | null; newValue: string }) =>
        e.field === 'messaging_permission' && e.oldValue === 'nobody' && e.newValue === 'fans_only'
    );
    expect(applied, 'apply-to-all change recorded in the feed').toBeTruthy();
    expect(applied.actor?.name, 'actor attributed').toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Recent safety changes' })).toBeVisible();
  } finally {
    await api.patch('/api/guardian/household', { data: null }).catch(() => {});
    await api.dispose();
  }
});

test('age-preset prompt (133): seeded crossing → queue card with change list → Apply confirm updates + stamps', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  let transferId = '';
  try {
    // Differing older overrides (the prompt's precondition).
    const adopt = await api.patch('/api/guardian/household', {
      data: {
        defaults: { messaging_permission: 'fans_only' },
        olderDefaults: { messaging_permission: 'everyone' },
      },
    });
    expect(adopt.ok(), await readErrorBody(adopt)).toBe(true);

    // Seed the crossing row directly (cron isn't triggered from e2e) —
    // service-role REST via the e2e env (transfer-ceremony precedent).
    const { requireEnv } = await import('./helpers/qa-user');
    const { url, serviceKey } = requireEnv();
    const seed = await fetch(`${url}/rest/v1/profile_transfers`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        profile_id: childId,
        state: 'eligible_notified',
        initiated_by: 'system',
        dob_snapshot: '2012-06-15',
        age_preset_prompt: 'pending',
      }),
    });
    expect(seed.ok, JSON.stringify(await seed.clone().json().catch(() => ({})))).toBe(true);
    transferId = (await seed.json())[0].id;

    // The queue derives the card with the change list; Apply → one confirm.
    await page.goto('/app/guardian');
    const main = page.locator('main');
    await expect(
      main.getByText('Junior Console is old enough for your older-athlete settings')
    ).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText(/Messaging: .* → everyone/).first()).toBeVisible();
    await main.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('Apply your older-athlete settings?')).toBeVisible();
    await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
    await expect(
      main.getByText('Junior Console is old enough for your older-athlete settings')
    ).toHaveCount(0, { timeout: 10_000 });

    // Settings applied + stamped; a second decision is refused.
    const roster = await api.get('/api/guardian/athletes');
    const child = ((await roster.json()).athletes ?? []).find(
      (a: { id: string }) => a.id === childId
    );
    expect(child.messaging_permission).toBe('everyone');
    const again = await api.post('/api/guardian/age-preset', {
      data: { transferId, decision: 'keep' },
    });
    expect(again.status()).toBe(400);
  } finally {
    if (transferId) {
      const { requireEnv } = await import('./helpers/qa-user');
      const { url, serviceKey } = requireEnv();
      await fetch(`${url}/rest/v1/profile_transfers?id=eq.${transferId}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }).catch(() => {});
    }
    await api.patch('/api/guardian/household', { data: null }).catch(() => {});
    await api.dispose();
  }
});

test('household blocks: one action covers guardian + athletes; unblock clears both', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  const userB = loadQaUser('user-b.json');
  try {
    const block = await api.post('/api/guardian/blocks', {
      data: { blockedId: userB.id },
    });
    expect(block.ok(), await readErrorBody(block)).toBe(true);
    expect((await block.json()).appliedTo.length).toBeGreaterThanOrEqual(2);

    const list = await api.get('/api/guardian/blocks');
    const row = ((await list.json()).blocks ?? []).find(
      (b: { blocked: { id: string } }) => b.blocked.id === userB.id
    );
    expect(row, 'household block listed').toBeTruthy();
    expect(row.full).toBe(true);

    // The CHILD's own user_blocks row exists (service REST truth).
    const { requireEnv } = await import('./helpers/qa-user');
    const { url, serviceKey } = requireEnv();
    const childRows = await (
      await fetch(
        `${url}/rest/v1/user_blocks?blocker_id=eq.${childId}&blocked_id=eq.${userB.id}&select=blocker_id`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      )
    ).json();
    expect(childRows.length).toBe(1);

    // Settings page renders the section.
    await page.goto('/app/guardian/settings');
    await expect(page.getByRole('heading', { name: 'Household block list' })).toBeVisible({ timeout: 15_000 });

    const unblock = await api.delete(`/api/guardian/blocks?blockedId=${userB.id}`);
    expect(unblock.ok(), await readErrorBody(unblock)).toBe(true);
    const after = await (
      await fetch(
        `${url}/rest/v1/user_blocks?blocker_id=eq.${childId}&blocked_id=eq.${userB.id}&select=blocker_id`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      )
    ).json();
    expect(after.length).toBe(0);
  } finally {
    await api.delete(`/api/guardian/blocks?blockedId=${userB.id}`).catch(() => {});
    await api.dispose();
  }
});

test('batch upload (Wave 5): multi-assign copies bytes per athlete; confirmed event suggestion stamps event_id', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  test.setTimeout(120_000); // editor pass + sequential uploads + two posts
  const api = await apiAs('state.json');
  const guardian = loadQaUser('user.json');
  const { requireEnv } = await import('./helpers/qa-user');
  const { url, serviceKey } = requireEnv();
  const sibHandle = `eaqa_sib_${stamp}`; // ≤20 chars (handle cap)
  let sibId = '';
  try {
    // Day-window guardian buckets fill across serial runs: the flag probe +
    // two creates spend guardian-athlete-create (5/day), and since Wave 6
    // split the household routes off it, apply/block spend their own
    // guardian-household-apply / guardian-block buckets. Clear all three for
    // the QA guardian (service REST truth — a test-sequencing artifact,
    // never a reason to loosen the prod limits).
    const dayBuckets = ['guardian-athlete-create', 'guardian-household-apply', 'guardian-block']
      .map(action => `"${action}:${guardian.id}"`)
      .join(',');
    await fetch(
      `${url}/rest/v1/rate_limits?key=in.(${encodeURIComponent(dayBuckets)})`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );

    // Second athlete — multi-assign needs a household of two.
    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15))
      .toISOString().split('T')[0];
    const created = await api.post('/api/guardian/athletes', {
      data: { first_name: 'Sibling', last_name: 'Console', dob, handle: sibHandle },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    sibId = (await created.json()).profileId;

    // Acting-as PUBLISHING requires APPROVED consent (the resolver matrix) —
    // approve both children via the append-only ledger (service REST truth;
    // latest action wins, so this supersedes the earlier typed-signature
    // submission without touching its row).
    const consent = await fetch(`${url}/rest/v1/consent_records`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(
        [childId, sibId].map(profileId => ({
          profile_id: profileId,
          subject_dob_year: new Date().getUTCFullYear() - 10,
          guardian_user_id: guardian.id,
          guardian_email_snapshot: guardian.email,
          method: 'signed_form',
          action: 'review_approved',
          policy_version: 'qa-e2e',
          jurisdiction: 'US',
          threshold_age: 13,
        }))
      ),
    });
    expect(consent.ok, `consent seed ${consent.status}`).toBe(true);

    // An event around NOW for child A only — buffer-payload setInputFiles
    // stamps File.lastModified ≈ now, so containment matches this and
    // nothing else (the earlier tests' events sit days out).
    const evStart = new Date(Date.now() - 30 * 60_000);
    const seeded = await api.post('/api/calendar/events', {
      data: {
        title: `QA batch event ${stamp}`,
        starts_at: evStart.toISOString(),
        ends_at: new Date(evStart.getTime() + 3_600_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        guests: { profile_ids: [childId] },
      },
    });
    const calendarOn = seeded.status() !== 404;
    const seededEventId = calendarOn ? (await seeded.json()).event?.id : null;
    if (calendarOn) expect(seededEventId, 'seeded event id').toBeTruthy();

    await page.goto('/app/guardian/upload');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Family upload' })).toBeVisible({ timeout: 15_000 });

    // Buffer payload (NOT a path): a path would carry the fixture's on-disk
    // mtime and never match the seeded event window.
    const fs = await import('fs');
    const path = await import('path');
    const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer });

    // Every pick goes through the shared editor — Done accepts as-is.
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    // Assign BOTH athletes on the one item (44px pills).
    await main.getByRole('button', { name: 'Junior Console', exact: true }).click();
    await main.getByRole('button', { name: 'Sibling Console', exact: true }).click();

    if (calendarOn) {
      // The suggestion is an OFFER — nothing attaches until the tap.
      await expect(main.getByText(`QA batch event ${stamp}`).first()).toBeVisible({ timeout: 15_000 });
      await main.getByRole('button', { name: 'Attach', exact: true }).click();
    }

    await main.getByLabel(/Caption/).fill(`qa batch ${stamp}`);
    await expect(main.getByText('Will create 2 posts across 2 athletes.')).toBeVisible();
    await main.getByRole('button', { name: 'Post the batch' }).click();
    await expect(main.getByRole('heading', { name: 'Batch posted' })).toBeVisible({ timeout: 60_000 });
    await expect(
      main.getByText(calendarOn ? '2 posts created, 1 attached to a calendar event.' : '2 posts created.')
    ).toBeVisible();

    // Service REST truth (children are private — the list GET hides them
    // from a non-following viewer): one post per child, each child's media
    // under their OWN storage prefix (the copy endpoint, not a shared
    // object), guardian attributed, event stamped on child A only.
    const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const fetchPost = async (profileId: string) =>
      (await (
        await fetch(
          `${url}/rest/v1/posts?profile_id=eq.${profileId}&caption=eq.${encodeURIComponent(
            `qa batch ${stamp}`
          )}&select=id,event_id,created_by_user_id,post_media(media_url)`,
          { headers: restHeaders }
        )
      ).json()) as Array<{
        id: string;
        event_id: string | null;
        created_by_user_id: string | null;
        post_media: Array<{ media_url: string }>;
      }>;

    const postsA = await fetchPost(childId);
    const postsB = await fetchPost(sibId);
    expect(postsA.length).toBe(1);
    expect(postsB.length).toBe(1);
    expect(postsA[0].created_by_user_id).toBe(guardian.id);
    expect(postsB[0].created_by_user_id).toBe(guardian.id);
    expect(postsA[0].post_media[0]?.media_url).toContain(`/posts/${childId}/`);
    expect(postsB[0].post_media[0]?.media_url).toContain(`/posts/${sibId}/`);
    expect(postsA[0].post_media[0]?.media_url).not.toBe(postsB[0].post_media[0]?.media_url);
    if (calendarOn) {
      expect(postsA[0].event_id).toBe(seededEventId);
    }
    expect(postsB[0].event_id).toBeNull();
  } finally {
    if (sibId) {
      await api.delete(`/api/guardian/athletes/${sibId}`, {
        data: { confirmHandle: sibHandle },
      }).catch(() => {});
    }
    await api.dispose();
  }
});

test('payoff line (Wave 5): a seeded future event surfaces as Next: on the roster card; actions survive an empty snapshot', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    // Tomorrow, well inside the 14-day family-week window.
    const start = new Date(Date.now() + 86_400_000);
    const seeded = await api.post('/api/calendar/events', {
      data: {
        title: `QA payoff event ${stamp}`,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        guests: { profile_ids: [childId] },
      },
    });
    test.skip(seeded.status() === 404, 'calendar flag off in this environment');
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    await page.goto('/app/guardian');
    const main = page.locator('main');
    // The payoff line is the only 'Next:' on the hub; the child has no sport,
    // so the line renders event-only (a null statsCard must never blank it).
    await expect(main.getByText('Next:').first()).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText(`QA payoff event ${stamp}`).first()).toBeVisible();
    // Card actions render regardless of snapshot content.
    await expect(main.getByRole('link', { name: 'View profile' }).first()).toBeVisible();
  } finally {
    await api.dispose();
  }
});

test('urgent safety emails (135): settings toggle round-trips both directions via server echo', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    // Baseline: ON by default (the mig-135 column default).
    const before = await api.get('/api/notifications/preferences');
    expect(before.ok(), await readErrorBody(before)).toBe(true);
    expect((await before.json()).preferences?.urgent_email_enabled).toBe(true);

    await page.goto('/settings?tab=notifications');
    const toggle = page.getByRole('switch', { name: 'Urgent safety emails' });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // OFF — poll the SERVER echo (saves are optimistic; the UI flips first).
    await toggle.click();
    await expect
      .poll(async () => {
        const echo = await api.get('/api/notifications/preferences');
        return (await echo.json()).preferences?.urgent_email_enabled;
      }, { timeout: 10_000 })
      .toBe(false);

    // Back ON.
    await toggle.click();
    await expect
      .poll(async () => {
        const echo = await api.get('/api/notifications/preferences');
        return (await echo.json()).preferences?.urgent_email_enabled;
      }, { timeout: 10_000 })
      .toBe(true);
  } finally {
    await api.dispose();
  }
});

// afterAll, not a test: serial mode skips remaining TESTS after a failure,
// which would orphan the child's @minors.invalid shadow user. Hooks run
// regardless.
test.afterAll(async () => {
  if (!flagOn || !childId) return;
  const api = await apiAs('state.json');
  try {
    const res = await api.delete(`/api/guardian/athletes/${childId}`, {
      data: { confirmHandle: HANDLE },
    });
    if (!res.ok()) {
      console.error('[e2e] guardian-console cleanup failed:', await readErrorBody(res));
    }
  } finally {
    await api.dispose();
  }
});
