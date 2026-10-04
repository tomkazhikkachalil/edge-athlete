import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { toWire } from '../src/lib/activities/wire';
import { line } from '../src/lib/activities/__tests__/fixtures';

// Live Activities PR 3 (Oct 4 2026): the recorder's finished recording
// through the import door, end to end. A live wire → one row (source
// 'live', the segments kept, a step estimate); the SAME recordingId again →
// 200 duplicate, never a second row; a watch's file of the same walk 20 s
// later → still one row, the segments kept; a photo attached twice is one
// row; a viewer's pin inside the trimmed 200 m is null; share mirrors the
// photos into the post; delete cascades the photos.

const T0 = Date.UTC(2026, 9, 1, 11, 0, 0);
const REC = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f40';

function liveWire(over: Record<string, unknown> = {}) {
  // 600 fixes, 1.4 m a second: an 840 m walk in 10 minutes.
  const w = toWire({ format: 'live', type: 'walk', name: 'Lunch walk', points: line(600, { t0: T0, stepM: 1.4, stepS: 1, climbPerStep: 0.01 }), device: {}, tzOffsetMin: null }, 'America/Toronto');
  return { ...w, recordingId: REC, segments: [{ id: 'sprint-1', kind: 'sprint', from_s: 100, to_s: 160, label: 'Hill' }], ...over };
}

/** The same walk as a watch's GPX, 20 s later start, with heart rate (richer). */
function watchWire() {
  return toWire({ format: 'gpx', type: 'walk', name: null, points: line(590, { t0: T0 + 20_000, stepM: 1.4, stepS: 1, hr: 110 }), device: {}, tzOffsetMin: null }, 'America/Toronto');
}

async function ctxFor(u: QaUser | null): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: u ? await mintStorageState(u) : { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
}

async function uploadPhoto(api: APIRequestContext): Promise<string> {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0ea5e9' } }).jpeg().toBuffer();
  const intent = await api.post('/api/upload/post-media/intent', { data: { type: 'image/jpeg', size: bytes.length } });
  expect(intent.ok(), await intent.text()).toBe(true);
  const { path, signedUrl } = await intent.json();
  expect((await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': 'image/jpeg' } })).ok()).toBe(true);
  const complete = await api.post('/api/upload/post-media/complete', { data: { path, type: 'image/jpeg' } });
  expect(complete.ok(), await complete.text()).toBe(true);
  return (await complete.json()).url as string;
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, segments').limit(1);
  test.skip(!!probe.error, `migration 251 not applied on this target (${probe.error?.code})`);
});

test('a live recording lands once, keeps its segments through a watch twin, carries photos, and shares them', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Walker Wren', firstName: 'Walker', lastName: 'Wren' });
  const b = await createQaUser({ displayName: 'Viewer Vale', firstName: 'Viewer', lastName: 'Vale' });
  await admin.from('profiles').update({ visibility: 'public', height_cm: 180 }).eq('id', a.id);
  const [apiA, apiB] = await Promise.all([ctxFor(a), ctxFor(b)]);
  let photoUrl: string | null = null;
  try {
    const first = await apiA.post('/api/activities', { data: { activity: liveWire() } });
    expect(first.status(), await readErrorBody(first)).toBe(201);
    const { id } = await first.json();

    const { data: row } = await admin.from('activities').select('*').eq('id', id).single();
    expect(row).toMatchObject({ profile_id: a.id, activity_type: 'walk', source: 'live', source_format: null, external_id: `live:${REC}`, name: 'Lunch walk', has_route: true, steps_source: 'estimated' });
    expect(row!.segments).toEqual([{ id: 'sprint-1', kind: 'sprint', from_s: 100, to_s: 160, label: 'Hill' }]);
    // ~839 m at a 180 cm walking stride (0.743 m) ≈ 1,129 steps.
    expect(row!.steps).toBeGreaterThan(1050);
    expect(row!.steps).toBeLessThan(1200);

    // The recorder retried: the same recording, one row.
    const again = await apiA.post('/api/activities', { data: { activity: liveWire() } });
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ id, duplicate: true });

    // A watch recorded the same walk (20 s skew, heart rate): still ONE row,
    // the richer stream wins, the recorder's segments stay.
    const watch = await apiA.post('/api/activities', { data: { activity: watchWire() } });
    expect(watch.status(), await readErrorBody(watch)).toBe(200);
    expect(await watch.json()).toEqual({ id, duplicate: true });
    const { data: merged } = await admin.from('activities').select('segments, avg_hr, source, steps').eq('id', id).single();
    expect(merged!.avg_hr).toBeGreaterThan(90); // the watch's heart rate arrived — the richer stream won
    expect(merged!.segments).toHaveLength(1);
    // The steps follow the stream: recomputed on the server from the twin's distance.
    expect(merged!.steps).toBeGreaterThan(1000);
    const stepsNow = merged!.steps as number;
    expect((await admin.from('activities').select('id').eq('profile_id', a.id)).data).toHaveLength(1);

    // A photo at the very start (inside a viewer's trimmed 200 m), attached twice.
    photoUrl = await uploadPhoto(apiA);
    const attach = await apiA.post(`/api/activities/${id}/media`, { data: { media_url: photoUrl, media_type: 'image', at_s: 2, caption: 'Front door' } });
    expect(attach.status(), await readErrorBody(attach)).toBe(201);
    const attachAgain = await apiA.post(`/api/activities/${id}/media`, { data: { media_url: photoUrl, media_type: 'image', at_s: 2 } });
    expect(attachAgain.status()).toBe(200);
    expect((await admin.from('activity_media').select('id').eq('activity_id', id)).data).toHaveLength(1);
    // Someone else's file is refused by name; a stranger cannot attach at all.
    expect((await apiA.post(`/api/activities/${id}/media`, { data: { media_url: photoUrl.replace(a.id, b.id), media_type: 'image' } })).status()).toBe(400);
    expect((await apiB.post(`/api/activities/${id}/media`, { data: { media_url: photoUrl, media_type: 'image' } })).status()).toBe(404);

    // The owner sees the pin; a viewer's pin inside the trim is null; the segments reach both.
    const own = (await (await apiA.get(`/api/activities/${id}`)).json()).activity;
    expect(own.media).toHaveLength(1);
    expect(own.media[0]).toMatchObject({ caption: 'Front door', atS: 2 });
    expect(own.media[0].pin).not.toBeNull();
    expect(own.media[0].mediaUrl.startsWith('/api/media/')).toBe(true);
    expect(own.segments).toHaveLength(1);
    expect(own.steps).toBe(stepsNow);
    const theirs = (await (await apiB.get(`/api/activities/${id}`)).json()).activity;
    expect(theirs.media[0].pin).toBeNull();
    expect(theirs.segments).toEqual(own.segments);

    // The owner edits the segments and notes; a stranger cannot.
    const edited = await apiA.patch(`/api/activities/${id}`, { data: { segments: [{ id: 'sprint-1', kind: 'climb', from_s: 100, to_s: 9999 }], notes: 'Felt good.' } });
    expect(edited.status(), await readErrorBody(edited)).toBe(200);
    const ev = (await edited.json()).activity;
    expect(ev.segments[0]).toMatchObject({ kind: 'climb', from_s: 100 });
    expect(ev.segments[0].to_s).toBeLessThanOrEqual(600); // clamped to the activity's seconds
    expect(ev.notes).toBe('Felt good.');
    expect((await apiB.patch(`/api/activities/${id}`, { data: { notes: 'mine' } })).status()).toBe(404);

    // Share: the card carries the segment line and the photo count, the photo rides the post.
    const shared = await apiA.post('/api/posts', { data: { postType: 'general', caption: 'Out for air', visibility: 'public', stats_data: { type: 'activity', activity_id: id } } });
    expect(shared.status(), await readErrorBody(shared)).toBeLessThan(300);
    const { data: post } = await admin.from('posts').select('id, stats_data').eq('profile_id', a.id).single();
    expect(post!.stats_data).toMatchObject({ type: 'activity', activity_id: id, photo_count: 1 });
    expect(post!.stats_data.segments).toHaveLength(1);
    expect(post!.stats_data.segments[0]).toMatchObject({ kind: 'climb', label: null });
    expect(post!.stats_data.steps).toBe(stepsNow);
    const { data: postMedia } = await admin.from('post_media').select('media_url').eq('post_id', post!.id);
    expect(postMedia!.map(m => m.media_url)).toEqual([photoUrl]);
    const { data: mirrored } = await admin.from('activity_media').select('mirrored_at').eq('activity_id', id).single();
    expect(mirrored!.mirrored_at).not.toBeNull();

    // Delete cascades the photos.
    const del = await apiA.delete(`/api/activities/${id}`);
    expect(del.status(), await readErrorBody(del)).toBe(200);
    expect((await admin.from('activity_media').select('id').eq('activity_id', id)).data).toHaveLength(0);
  } finally {
    await Promise.all([apiA.dispose(), apiB.dispose()]);
    if (photoUrl) {
      const key = photoUrl.split('/public/uploads/')[1];
      if (key) await admin.storage.from('uploads').remove([key]).catch(() => undefined);
    }
    for (const u of [a, b]) await deleteQaUser(u.id);
  }
});
