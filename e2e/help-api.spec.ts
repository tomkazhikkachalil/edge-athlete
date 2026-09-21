import { test, expect } from '@playwright/test';
import { adminClient, adminEmailForE2E, apiAs, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody, settleStatus } from './helpers/isr';

// Support & Reporting, Spec 3 (mig 224) — the Help Center's backend over
// the API. The PUBLIC article read (drafts never show; a slug read carries
// the body; a YouTube link resolves to an id — the service key seeds and
// removes the rows, so the owner-only CRUD is exercised only when
// E2E_ADMIN_EMAIL is set); the GUEST request (email, honeypot); the
// /contact adapter (a Help ticket, guest or session); the screenshot
// attachment (uploaded under the user's tickets/ prefix, refused under
// another's, served back through the media proxy to the submitter and to a
// moderator, 404 to a stranger). Self-skips pre-224. @mobile.

test('help center API: public articles, the guest request, /contact, the screenshot attachment @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const delta = loadQaUser('user-d.json');
  const probe = await admin.from('help_articles').select('id').limit(1);
  test.skip(!!probe.error, `help_articles missing — run migration 224 (${probe.error?.message})`);

  // The project's `use.storageState` signs the `request` fixture in — an EMPTY state is the signed-out visitor.
  const request = (await browser.newContext({ storageState: { cookies: [], origins: [] } })).request;
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const deltaApi = await apiAs('state-d.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  await resetRateBucket(admin, 'upload', alpha.id);
  await resetRateBucket(admin, 'contact', '');
  const rand = Math.random().toString(36).slice(2, 8);
  const articleIds: string[] = [];
  const ticketIds: string[] = [];
  let attachmentPath: string | null = null;
  try {
    // Seed: one published article with a video, one draft.
    const { data: seeded, error: seedError } = await admin
      .from('help_articles')
      .insert([
        { slug: `qa-posting-a-round-${rand}`, title: 'Posting a round (QA)', body: 'Open the composer.\n\n- Pick the course\n- Enter your scores\n\nSee https://edgeathlete.ca/help.', topic: 'posting_media', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sort_order: 1, published: true },
        // A batch insert sends null for a missing key (PostgREST), so every column is spelled out.
        { slug: `qa-draft-${rand}`, title: 'A draft (QA)', body: 'Not yet.', topic: 'other', video_url: null, sort_order: 2, published: false },
      ])
      .select('id, slug');
    expect(seedError).toBeNull();
    for (const r of seeded ?? []) articleIds.push(r.id as string);

    // The public list: published only, the video id resolved, the excerpt. The
    // list is CDN-cached (s-maxage=60 — Vercel consumes the directive and answers
    // `public`), so on prod the seeded row settles in within a minute.
    let res = await request.get('/api/help/articles');
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(res.headers()['cache-control']).toContain('public');
    const listBody = await settleBody(request, '/api/help/articles', `qa-posting-a-round-${rand}`, true, 30);
    const list = JSON.parse(listBody) as { supported: boolean; articles: Array<{ slug: string; videoId: string | null; excerpt: string }> };
    expect(list.supported).toBe(true);
    const mine = list.articles.find(a => a.slug === `qa-posting-a-round-${rand}`)!;
    expect(mine).toBeTruthy();
    expect(mine.videoId).toBe('dQw4w9WgXcQ');
    expect(mine.excerpt).toBe('Open the composer.');
    expect(list.articles.some(a => a.slug === `qa-draft-${rand}`)).toBe(false);
    // One article: the body; a draft is a 404.
    await settleStatus(request, `/api/help/articles/qa-posting-a-round-${rand}`, 200, 30);
    res = await request.get(`/api/help/articles/qa-posting-a-round-${rand}`);
    expect((await res.json()).article.body).toContain('Pick the course');
    expect((await request.get(`/api/help/articles/qa-draft-${rand}`)).status()).toBe(404);
    expect((await request.get('/api/help/articles/Not%20A%20Slug')).status()).toBe(404);
    // The CRUD is owner-only: a plain member and a moderator are refused.
    expect((await alphaApi.post('/api/admin/help/articles', { data: { title: 'x', topic: 'other' } })).status()).toBe(403);

    // The owner's CRUD, when the target build names an admin.
    const adminEmail = adminEmailForE2E();
    if (adminEmail) {
      const adminUser = await createQaUser({ email: adminEmail, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
      try {
        const adminApi = (await browser.newContext({ storageState: await mintStorageState(adminUser) })).request;
        res = await adminApi.post('/api/admin/help/articles', { data: { title: `Joining an event ${rand}`, body: 'Tap Join.', topic: 'events', video_url: 'https://example.com/not-youtube' } });
        expect(res.status()).toBe(400); // not a YouTube link
        res = await adminApi.post('/api/admin/help/articles', { data: { title: `Joining an event ${rand}`, body: 'Tap Join.', topic: 'events', published: true } });
        expect(res.status(), await readErrorBody(res)).toBe(201);
        const created = (await res.json()).article as { id: string; slug: string };
        articleIds.push(created.id);
        expect(created.slug).toBe(`joining-an-event-${rand}`);
        res = await adminApi.patch(`/api/admin/help/articles/${created.id}`, { data: { published: false } });
        expect(res.status()).toBe(200);
        res = await adminApi.get('/api/admin/help/articles');
        expect(((await res.json()).articles as Array<{ id: string }>).map(a => a.id)).toContain(created.id);
        res = await adminApi.delete(`/api/admin/help/articles/${created.id}`);
        expect(res.status()).toBe(200);
        articleIds.splice(articleIds.indexOf(created.id), 1);
      } finally {
        await deleteQaUser(adminUser.id);
      }
    }

    // The guest request: no session; the honeypot stores nothing.
    res = await request.post('/api/tickets/guest', { data: { email: `edgeqa-guest-${rand}@example.com`, reason: 'account', description: 'I cannot sign in on my phone.', website: 'http://spam' } });
    expect(res.status()).toBe(201);
    expect((await res.json()).number).toBe('EA-0000');
    res = await request.post('/api/tickets/guest', { data: { email: `edgeqa-guest-${rand}@example.com`, reason: 'account', subject: 'Sign-in', description: 'I cannot sign in on my phone.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const guest = (await res.json()) as { number: string };
    expect(guest.number).toMatch(/^EA-\d{4,}$/);
    const { data: guestRow } = await admin.from('tickets').select('id, type, guest_email, reporter_profile_id').eq('guest_email', `edgeqa-guest-${rand}@example.com`).single();
    ticketIds.push(guestRow!.id as string);
    expect(guestRow).toMatchObject({ type: 'help', reporter_profile_id: null });
    expect((await request.post('/api/tickets/guest', { data: { email: 'nope', reason: 'account', description: 'x' } })).status()).toBe(400);
    expect((await request.post('/api/tickets/guest', { data: { email: `g-${rand}@example.com`, reason: 'minor_safety', description: 'x' } })).status()).toBe(400);

    // /contact files a Help ticket — a guest, then a session.
    res = await request.post('/api/contact', { data: { name: 'Pat Visitor', email: `edgeqa-contact-${rand}@example.com`, message: 'Do you support hockey?' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const { data: contactRow } = await admin.from('tickets').select('id, subject, guest_email').eq('guest_email', `edgeqa-contact-${rand}@example.com`).single();
    ticketIds.push(contactRow!.id as string);
    expect(contactRow!.subject).toBe('Contact form — Pat Visitor');
    res = await alphaApi.post('/api/contact', { data: { name: 'Alpha', email: 'ignored@example.com', message: 'Signed in.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const { data: sessionRow } = await admin.from('tickets').select('id, reporter_profile_id, guest_email').eq('reporter_profile_id', alpha.id).eq('subject', 'Contact form — Alpha').order('created_at', { ascending: false }).limit(1).single();
    ticketIds.push(sessionRow!.id as string);
    expect(sessionRow!.guest_email).toBeNull();

    // The screenshot: uploaded under alpha's prefix, refused under bravo's, served to alpha and a moderator, 404 to a stranger.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    res = await alphaApi.post('/api/tickets/attachment', { multipart: { file: { name: 'shot.png', mimeType: 'image/png', buffer: png } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const up = (await res.json()) as { url: string; path: string };
    attachmentPath = up.path;
    expect(up.path.startsWith(`${alpha.id}/tickets/`)).toBe(true);
    res = await bravoApi.post('/api/tickets', { data: { type: 'help', reason: 'account', description: 'not my shot', attachment_url: up.url } });
    expect(res.status()).toBe(400);
    res = await alphaApi.post('/api/tickets', { data: { type: 'help', reason: 'posting_media', description: 'See the screenshot.', attachment_url: up.url } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const withShot = (await res.json()) as { id: string };
    ticketIds.push(withShot.id);
    res = await alphaApi.get(`/api/tickets/${withShot.id}`);
    const view = (await res.json()) as { ticket: { attachment: string | null } };
    expect(view.ticket.attachment).toMatch(/^\/api\/media\//);
    expect(view.ticket.attachment).not.toContain('supabase');
    // The bytes: the submitter yes, a stranger no, a moderator yes.
    expect((await alphaApi.get(view.ticket.attachment!)).status()).toBe(200);
    expect((await bravoApi.get(view.ticket.attachment!)).status()).toBe(404);
    await admin.from('platform_admins').upsert({ profile_id: delta.id, role: 'moderator' }, { onConflict: 'profile_id' });
    expect((await deltaApi.get(view.ticket.attachment!)).status()).toBe(200);
    res = await deltaApi.get(`/api/admin/tickets/${withShot.id}`);
    expect(((await res.json()) as { ticket: { attachment: string | null } }).ticket.attachment).toMatch(/^\/api\/media\//);
  } finally {
    if (articleIds.length > 0) await admin.from('help_articles').delete().in('id', articleIds);
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
    if (attachmentPath) await admin.storage.from('uploads').remove([attachmentPath]);
    await admin.from('platform_admins').delete().eq('profile_id', delta.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical']).in('user_id', [alpha.id, bravo.id, delta.id]);
  }
});
