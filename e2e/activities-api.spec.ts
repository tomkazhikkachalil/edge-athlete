import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { parseGpx } from '../src/lib/activities/parse-gpx';
import { toWire } from '../src/lib/activities/wire';
import { gpxOf, line } from '../src/lib/activities/__tests__/fixtures';

// Activities program PR 3 (Sep 29 2026): the import doors, the ONE gate and
// the projections, end to end against a real database and storage.
// Tom's rules: the route's first and last ~200 m are the owner's; a
// supervised athlete's other viewers never receive a position; "Share to
// feed" is the athlete's choice and the card is rebuilt from the row.

const T0 = Date.UTC(2026, 8, 20, 11, 0, 0);

function gpxWire(opts: { t0?: number; stepM?: number; n?: number } = {}) {
  const parsed = parseGpx(gpxOf(line(opts.n ?? 1000, { t0: opts.t0 ?? T0, stepM: opts.stepM ?? 3, hr: 150, climbPerStep: 0.02 })));
  return toWire({ ...parsed, format: 'gpx' }, 'America/Toronto');
}

/** The same run as a .FIT (same start second → the same activity). */
function fitBytes(): Buffer {
  const encoder = new Encoder();
  const on = (num: number, m: Record<string, unknown>) => encoder.onMesg(num, m as Mesg);
  on(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: new Date(T0), type: 'activity' });
  const pts = line(1000, { t0: T0, stepM: 3, hr: 150, climbPerStep: 0.02 });
  pts.forEach((p, i) =>
    on(Profile.MesgNum.RECORD, {
      timestamp: new Date(p.t),
      positionLat: Math.round(p.lat / (180 / 2 ** 31)),
      positionLong: Math.round(p.lng / (180 / 2 ** 31)),
      altitude: p.ele,
      heartRate: p.hr,
      distance: i * 3,
    })
  );
  on(Profile.MesgNum.SESSION, { timestamp: new Date(pts[pts.length - 1].t), startTime: new Date(T0), sport: 'running', totalElapsedTime: 999, totalTimerTime: 999, totalDistance: 2997 });
  return Buffer.from(encoder.close());
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

test('import (GPX, re-import, the same run as FIT), the three audiences, share to feed, delete', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Runner Ada', firstName: 'Runner', lastName: 'Ada' });
  const b = await createQaUser({ displayName: 'Viewer Bex', firstName: 'Viewer', lastName: 'Bex' });
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', a.id);
  const [apiA, apiB, anon] = await Promise.all([ctxFor(a), ctxFor(b), ctxFor(null)]);
  try {
    const first = await apiA.post('/api/activities', { data: { activity: gpxWire() } });
    expect(first.status(), await readErrorBody(first)).toBe(201);
    const { id } = await first.json();

    const again = await apiA.post('/api/activities', { data: { activity: gpxWire() } });
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ id, duplicate: true });

    const fit = await apiA.post('/api/activities/fit', {
      multipart: { file: { name: 'run.fit', mimeType: 'application/octet-stream', buffer: fitBytes() }, tz: 'America/Toronto' },
    });
    expect(fit.status(), await readErrorBody(fit)).toBe(200);
    expect(await fit.json()).toEqual({ id, duplicate: true });

    const { data: row } = await admin.from('activities').select('*').eq('id', id).single();
    expect(row).toMatchObject({ profile_id: a.id, activity_type: 'run', source: 'file', source_format: 'fit', occurred_on: '2026-09-20', has_route: true, name: 'Morning Run' });
    expect(Number(row!.distance_m)).toBeGreaterThan(2900);

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
    const res = await apiK.post('/api/activities', { data: { activity: gpxWire({ t0: T0 + 86_400_000 }) } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const { id } = await res.json();
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', kid.id);

    // The athlete still sees their own route; a stranger gets no position at all.
    expect((await (await apiK.get(`/api/activities/${id}`)).json()).activity.stream.lat[5]).not.toBeUndefined();
    const text = await (await apiB.get(`/api/activities/${id}`)).text();
    expect(text).not.toMatch(/"lat"|"lng"/);
    const v = JSON.parse(text).activity;
    expect(v).toMatchObject({ hasRoute: false, routePreview: null });
    expect(v.stream.hr.length).toBeGreaterThan(100);
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
    const car = await api.post('/api/activities', { data: { activity: gpxWire({ stepM: 25, n: 200 }) } });
    expect(car.status()).toBe(422);
    expect((await car.json()).error).toMatch(/faster than a run/);

    const bent = gpxWire();
    const misaligned = await api.post('/api/activities', { data: { activity: { ...bent, hr: [1, 2, 3] } } });
    expect(misaligned.status()).toBe(400);

    const notFit = await api.post('/api/activities/fit', { multipart: { file: { name: 'x.fit', mimeType: 'application/octet-stream', buffer: Buffer.from('<gpx></gpx>') } } });
    expect(notFit.status()).toBe(422);
    expect((await notFit.json()).error).toMatch(/not a FIT/);

    expect((await api.get('/api/activities/not-a-uuid')).status()).toBe(404);
    expect((await api.get(`/api/profile/${u.id}/activities?cursor=%%%`)).status()).toBe(400);
  } finally {
    await api.dispose();
    await deleteQaUser(u.id);
  }
});
