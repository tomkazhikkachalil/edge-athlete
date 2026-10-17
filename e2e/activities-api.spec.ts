import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Activities program PR 3 (Sep 29 2026), re-seeded Oct 13 2026 when the file
// import left: the recorder's door, the ONE gate and the projections, end to
// end against a real database and storage. Tom's rules: the route's first
// and last ~200 m are the owner's; a supervised athlete's other viewers never
// receive a position; "Share to feed" is the athlete's choice and the card is
// rebuilt from the row.

const T0 = Date.UTC(2026, 8, 20, 11, 0, 0);
const REC = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f60';

/** A 3 km run at 3 m/s with heart rate and a steady climb. */
function runWire(opts: { t0?: number; stepM?: number; n?: number; recordingId?: string; type?: 'run' | 'walk' } = {}) {
  return liveWire({ t0: opts.t0 ?? T0, n: opts.n ?? 1000, stepM: opts.stepM ?? 3, hr: 150, climbPerStep: 0.02, name: 'Morning Run', type: opts.type ?? 'run', recordingId: opts.recordingId ?? REC });
}

async function ctxFor(u: QaUser | null): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: E2E_BASE_URL,
    storageState: u ? await mintStorageState(u) : { cookies: [], origins: [] },
    extraHTTPHeaders: bypassHeaders(),
  });
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 245 not applied on this target');
});

test('a recording (saved, retried, a second phone\'s twin), the three audiences, share to feed, delete', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Runner Ada', firstName: 'Runner', lastName: 'Ada' });
  const b = await createQaUser({ displayName: 'Viewer Bex', firstName: 'Viewer', lastName: 'Bex' });
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', a.id);
  const [apiA, apiB, anon] = await Promise.all([ctxFor(a), ctxFor(b), ctxFor(null)]);
  try {
    const first = await apiA.post('/api/activities', { data: { activity: runWire() } });
    expect(first.status(), await readErrorBody(first)).toBe(201);
    const { id } = await first.json();

    // The recorder retried the SAME recording: one row.
    const again = await apiA.post('/api/activities', { data: { activity: runWire() } });
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ id, duplicate: true });

    // A second phone recorded the same run (its own recording, 2 s later): the same activity.
    const twin = await apiA.post('/api/activities', { data: { activity: runWire({ t0: T0 + 2000, recordingId: '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f61' }) } });
    expect(twin.status(), await readErrorBody(twin)).toBe(200);
    expect(await twin.json()).toEqual({ id, duplicate: true });

    const { data: row } = await admin.from('activities').select('*').eq('id', id).single();
    expect(row).toMatchObject({ profile_id: a.id, activity_type: 'run', source: 'live', source_format: null, external_id: `live:${REC}`, occurred_on: '2026-09-20', has_route: true, name: 'Morning Run' });
    expect(Number(row!.distance_m)).toBeGreaterThan(2500);

    // Owner: the whole route and the controls.
    const own = (await (await apiA.get(`/api/activities/${id}`)).json()).activity;
    expect(own.owner).toMatchObject({ onlyMe: false });
    expect(own.stream.lat[0]).not.toBeNull();
    // A stranger and a signed-out visitor: trimmed, no controls, no storage path.
    for (const api of [apiB, anon]) {
      const res = await api.get(`/api/activities/${id}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['cache-control']).toContain('no-store');
      const text = await res.text();
      expect(text).not.toContain('activities/');
      const v = JSON.parse(text).activity;
      expect(v.owner).toBeNull();
      expect(v.stream.lat[0]).toBeNull();
      expect(v.stream.lat.some((x: number | null) => x !== null)).toBe(true);
      expect(v.routePreview).toBe(row!.route_preview);
    }

    const list = await (await apiB.get(`/api/profile/${a.id}/activities`)).json();
    expect(list).toMatchObject({ count: 1, isOwner: false, next: null });
    expect(list.items[0].id).toBe(id);
    expect(list.totals).toHaveLength(12);

    // Only the owner edits.
    expect((await apiB.patch(`/api/activities/${id}`, { data: { name: 'Mine now' } })).status()).toBe(404);
    const renamed = await apiA.patch(`/api/activities/${id}`, { data: { name: 'Harbourfront 3k' } });
    expect(renamed.status(), await readErrorBody(renamed)).toBe(200);

    // Share to feed: the card comes from the row, whatever the client sent.
    const shared = await apiA.post('/api/posts', {
      data: { postType: 'general', caption: 'Easy one', visibility: 'public', stats_data: { type: 'activity', activity_id: id, distance_m: 99_999, route_preview: 'forged' } },
    });
    expect(shared.status(), await readErrorBody(shared)).toBeLessThan(300);
    const { data: post } = await admin.from('posts').select('id, stats_data').eq('profile_id', a.id).single();
    expect(post!.stats_data).toMatchObject({ type: 'activity', activity_id: id, name: 'Harbourfront 3k', route_preview: row!.route_preview });
    expect(Number(post!.stats_data.distance_m)).toBeLessThan(3100);
    const { data: linked } = await admin.from('activities').select('post_id').eq('id', id).single();
    expect(linked!.post_id).toBe(post!.id);
    const twice = await apiA.post('/api/posts', { data: { postType: 'general', caption: '', stats_data: { type: 'activity', activity_id: id } } });
    expect(twice.status()).toBe(409);
    expect((await apiB.post('/api/posts', { data: { postType: 'general', caption: '', stats_data: { type: 'activity', activity_id: id } } })).status()).toBe(404);
    const onlyMe = await apiA.patch(`/api/activities/${id}`, { data: { onlyMe: true } });
    expect(onlyMe.status()).toBe(409);

    // Delete: the row, the post and the stream go together.
    const del = await apiA.delete(`/api/activities/${id}`);
    expect(del.status(), await readErrorBody(del)).toBe(200);
    expect((await admin.from('activities').select('id').eq('id', id)).data).toHaveLength(0);
    expect((await admin.from('posts').select('id').eq('id', post!.id)).data).toHaveLength(0);
    const { data: objs } = await admin.storage.from('uploads').list(`activities/${a.id}`);
    expect(objs ?? []).toHaveLength(0);
  } finally {
    await Promise.all([apiA.dispose(), apiB.dispose(), anon.dispose()]);
    for (const u of [a, b]) await deleteQaUser(u.id);
  }
});

test('a supervised athlete’s route never leaves; Only me, a private profile and a block refuse', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const kid = await createQaUser({ displayName: 'Junior Kit', firstName: 'Junior', lastName: 'Kit' });
  const b = await createQaUser({ displayName: 'Viewer Bo', firstName: 'Viewer', lastName: 'Bo' });
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', kid.id);
  const [apiK, apiB] = await Promise.all([ctxFor(kid), ctxFor(b)]);
  try {
    const res = await apiK.post('/api/activities', { data: { activity: runWire({ t0: T0 + 86_400_000, recordingId: '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f62' }) } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const { id } = await res.json();
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', kid.id);

    // The athlete still sees their own route; a stranger gets no position at all.
    expect((await (await apiK.get(`/api/activities/${id}`)).json()).activity.stream.lat[5]).not.toBeUndefined();
    const text = await (await apiB.get(`/api/activities/${id}`)).text();
    expect(text).not.toMatch(/"lat"|"lng"/);
    const v = JSON.parse(text).activity;
    expect(v).toMatchObject({ hasRoute: false, routePreview: null });
    // A recording's stream is the GPS filter's emitted points (only while
    // moving — far fewer than the raw fixes), so "the stats still travel" is
    // a presence check, not a count.
    expect(v.stream.hr.length).toBeGreaterThan(10);
    const listed = await (await apiB.get(`/api/profile/${kid.id}/activities`)).json();
    expect(listed.items[0].routePreview).toBeNull();

    // Only me: gone for everyone else, still the athlete's.
    expect((await apiK.patch(`/api/activities/${id}`, { data: { onlyMe: true } })).status()).toBe(200);
    expect((await apiB.get(`/api/activities/${id}`)).status()).toBe(404);
    expect((await (await apiB.get(`/api/profile/${kid.id}/activities`)).json()).count).toBe(0);
    expect((await (await apiK.get(`/api/profile/${kid.id}/activities`)).json()).count).toBe(1);
    await apiK.patch(`/api/activities/${id}`, { data: { onlyMe: false } });

    // A private profile: followers only.
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', kid.id);
    expect((await apiB.get(`/api/activities/${id}`)).status()).toBe(404);
    await admin.from('follows').insert({ follower_id: b.id, following_id: kid.id, status: 'accepted' });
    expect((await apiB.get(`/api/activities/${id}`)).status()).toBe(200);

    // A block either way: nothing.
    await admin.from('user_blocks').insert({ blocker_id: kid.id, blocked_id: b.id });
    expect((await apiB.get(`/api/activities/${id}`)).status()).toBe(404);
    expect((await apiB.get(`/api/profile/${kid.id}/activities`)).status()).toBe(404);
  } finally {
    await adminClient().from('user_blocks').delete().eq('blocker_id', kid.id);
    await Promise.all([apiK.dispose(), apiB.dispose()]);
    for (const u of [kid, b]) await deleteQaUser(u.id);
  }
});

test('the refusals say why', async () => {
  test.setTimeout(90_000);
  const u = await createQaUser({ displayName: 'Refusal Rae', firstName: 'Refusal', lastName: 'Rae' });
  const api = await ctxFor(u);
  try {
    // A "walk" at 4.5 m/s: faster than a walk can go (inside the GPS jump
    // gate's slack, so the fixes are kept and the SPEED is what is refused).
    const car = await api.post('/api/activities', { data: { activity: runWire({ stepM: 4.5, n: 200, type: 'walk' }) } });
    expect(car.status()).toBe(422);
    expect((await car.json()).error).toMatch(/faster than a walk/);

    const bent = runWire();
    const misaligned = await api.post('/api/activities', { data: { activity: { ...bent, hr: [1, 2, 3] } } });
    expect(misaligned.status()).toBe(400);

    // A file's wire is refused by name since Oct 13 2026 — the import left.
    const file = await api.post('/api/activities', { data: { activity: { ...bent, format: 'gpx' } } });
    expect(file.status()).toBe(400);
    expect((await file.json()).error).toMatch(/format/);
    const noId = await api.post('/api/activities', { data: { activity: { ...bent, recordingId: undefined } } });
    expect(noId.status()).toBe(400);

    expect((await api.get('/api/activities/not-a-uuid')).status()).toBe(404);
    expect((await api.get(`/api/profile/${u.id}/activities?cursor=%%%`)).status()).toBe(400);
  } finally {
    await api.dispose();
    await deleteQaUser(u.id);
  }
});
