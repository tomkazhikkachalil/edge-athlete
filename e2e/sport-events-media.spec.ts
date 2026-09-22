import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, goLive, inviteAndAccept, openEventSession, roundTransition } from './helpers/sport-events';

type MediaPayload = { media: Array<{ id: string; media_url: string; media_type: string; uploader: { name: string }; can_remove: boolean; mine: boolean }>; can_add: boolean };

// A 1×1 PNG — enough for the upload route (type + size checked, the bytes stored).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * Events program, phase 4, PR 12 — event media at phone width on Chromium
 * and WebKit. NEEDS MIGRATION 216 ON THE TARGET (self-skips before). A
 * public golf event: A (the host) and B (a player) each add a photo
 * through the upload route + the media POST; a stranger reads the gallery
 * and the bytes through the proxy (public), may not add (401); B may not
 * remove A's (403), A removes B's (an organizer); on B's phone the Gallery
 * tab shows the tile and the Add control, signed out the tile alone; a
 * private event's gallery is a 404 to a stranger; completion mirrors the
 * photo onto the round's post.
 */
test('event media: add, the public gallery + proxy, the remove rights, the tab, the mirror @mobile', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_media').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_media missing — run migration 216');
  let eventId: string | null = null;
  let privateId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Media ${s.stamp}`, visibility: 'public', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Media Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    await inviteAndAccept(s, eventId);
    const mediaUrl = `/api/sport-events/${eventId}/media`;

    const upload = async (api: typeof s.apiA, name: string) => {
      const res = await api.post('/api/upload/post-media', { multipart: { file: { name, mimeType: 'image/png', buffer: PNG } } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const body = (await res.json()) as { url?: string; media_url?: string; type?: string };
      const url = body.url ?? body.media_url;
      expect(url, 'the upload answers a URL').toBeTruthy();
      return url as string;
    };
    const aUrl = await upload(s.apiA, 'a.png');
    const added = await s.apiA.post(mediaUrl, { data: { media_url: aUrl, media_type: 'image', caption: 'The tee box' } });
    expect(added.status(), await readErrorBody(added)).toBe(201);
    const bUrl = await upload(s.apiB, 'b.png');
    const addedB = await s.apiB.post(mediaUrl, { data: { media_url: bUrl, media_type: 'image', round_id: roundId } });
    expect(addedB.status(), await readErrorBody(addedB)).toBe(201);

    // A stranger reads the gallery and the bytes; may not add.
    const anonRes = await s.anon.get(mediaUrl);
    expect(anonRes.status()).toBe(200);
    const anon = (await anonRes.json()) as MediaPayload;
    expect(anon.can_add).toBe(false);
    expect(anon.media).toHaveLength(2);
    expect(anon.media.every(m => m.media_url.startsWith('/api/media/'))).toBe(true);
    expect(anon.media.every(m => !m.can_remove)).toBe(true);
    const bytes = await s.anon.get(anon.media[0].media_url);
    expect(bytes.status(), 'a public event\'s bytes stream to a stranger').toBe(200);
    expect((await s.anon.post(mediaUrl, { data: { media_url: aUrl, media_type: 'image' } })).status()).toBe(401);
    const asB = (await (await s.apiB.get(mediaUrl)).json()) as MediaPayload;
    expect(asB.can_add).toBe(true);
    const bItem = asB.media.find(m => m.mine)!;
    const aItem = asB.media.find(m => !m.mine)!;
    expect(bItem.can_remove).toBe(true);
    expect(aItem.can_remove).toBe(false);
    // B may not remove A's; A (an organizer) removes B's.
    expect((await s.apiB.delete(`${mediaUrl}/${aItem.id}`)).status()).toBe(403);
    const removed = await s.apiA.delete(`${mediaUrl}/${bItem.id}`);
    expect(removed.ok(), await readErrorBody(removed)).toBe(true);
    expect(((await removed.json()) as MediaPayload).media).toHaveLength(1);

    // The Gallery tab on B's phone; signed out the tile alone.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/events/${eventId}?tab=gallery`);
      await expect(pageB.locator('[data-event-media-tile]')).toHaveCount(1, { timeout: 20_000 });
      await expect(pageB.locator('[data-event-media-add]')).toBeVisible();
      await pageB.locator('[data-event-media-tile]').first().click();
      await expect(pageB.locator('[role="dialog"]').last()).toBeVisible();
    } finally {
      await ctxB.close();
    }
    const ctxAnon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const anonPage = await ctxAnon.newPage();
      await anonPage.goto(`/events/${eventId}?tab=gallery`);
      await expect(anonPage.locator('[data-event-media-tile]')).toHaveCount(1, { timeout: 20_000 });
      await expect(anonPage.locator('[data-event-media-add]')).toHaveCount(0);
    } finally {
      await ctxAnon.close();
    }

    // A private event's gallery is a 404 to a stranger.
    const priv = await createEvent(s.apiA, { name: `QA Media Private ${s.stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Media Links', holes: 9, starting_hole: 1 } });
    privateId = priv.event.id;
    expect((await s.anon.get(`/api/sport-events/${privateId}/media`)).status()).toBe(404);

    // Completion mirrors the photo onto the round's post.
    await goLive(s.apiA, eventId, '2030-06-01');
    await roundTransition(s.apiA, eventId, roundId, 'completed', { override: true });
    const post = await admin.from('posts').select('id').eq('sport_event_round_id', roundId).maybeSingle();
    expect(post.data?.id).toBeTruthy();
    const mirrored = await admin.from('post_media').select('media_url').eq('post_id', post.data!.id as string);
    expect((mirrored.data ?? []).map(m => m.media_url)).toContain(aUrl);
    const stamped = await admin.from('sport_event_media').select('mirrored_at').eq('sport_event_id', eventId);
    expect((stamped.data ?? []).every(r => r.mirrored_at !== null)).toBe(true);
    // The page's own visit (A at 390): the gallery still lists it after completion.
    await page.goto(`/events/${eventId}?tab=gallery`);
    await expect(page.locator('[data-event-media-tile]')).toHaveCount(1, { timeout: 20_000 });
  } finally {
    await cleanupEvent(s.apiA, privateId);
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
