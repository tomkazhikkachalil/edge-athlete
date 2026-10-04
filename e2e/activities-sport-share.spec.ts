import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { toWire } from '../src/lib/activities/wire';
import { line } from '../src/lib/activities/__tests__/fixtures';

// The share-time bridge (Live Activities PR 7): a recorded ride posted as a
// CYCLING result — a stat-line post in the sport's own vocabulary, the
// performance row written like every stat line; a swim is never a cycling
// result; one post per activity; the training card is still the other door.

const T0 = Date.UTC(2026, 9, 3, 7, 0, 0);

function rideWire(recordingId: string) {
  // 1,200 fixes at 5 m / s: a 6 km ride in 20 minutes.
  const w = toWire({ format: 'live', type: 'ride', name: 'Morning spin', points: line(1200, { t0: T0, stepM: 5, stepS: 1, hr: 140, climbPerStep: 0.03 }), device: {}, tzOffsetMin: null }, 'America/Toronto');
  return { ...w, recordingId };
}

async function ctxFor(u: QaUser): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, segments').limit(1);
  test.skip(!!probe.error, `migration 251 not applied on this target (${probe.error?.code})`);
});

test('a recorded ride posts as a Cycling result: a stat line, a performance row, the sport\'s tab', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Rider Rae', firstName: 'Rider', lastName: 'Rae' });
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', a.id);
  const api = await ctxFor(a);
  try {
    const created = await api.post('/api/activities', { data: { activity: rideWire('7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f60') } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const { id } = await created.json();

    // A swim is never a cycling result; a ride is never a swimming one.
    const wrong = await api.post('/api/posts', { data: { postType: 'swimming', caption: '', visibility: 'public', stats_data: { type: 'activity', activity_id: id } } });
    expect(wrong.status()).toBe(400);

    const shared = await api.post('/api/posts', { data: { postType: 'cycling', caption: 'Legs good', visibility: 'public', stats_data: { type: 'activity', activity_id: id, stats: { distance_km: 999 } } } });
    expect(shared.status(), await readErrorBody(shared)).toBeLessThan(300);
    const { data: post } = await admin.from('posts').select('id, sport_key, stats_data').eq('profile_id', a.id).single();
    expect(post!.sport_key).toBe('cycling');
    expect(post!.stats_data).toMatchObject({ type: 'stat_line', sport_key: 'cycling', date: '2026-10-03', opponent: 'Morning spin' });
    expect(Number(post!.stats_data.stats.distance_km)).toBeGreaterThan(5.5);
    expect(Number(post!.stats_data.stats.distance_km)).toBeLessThan(6.5);
    expect(post!.stats_data.stats.avg_hr).toBeGreaterThan(100);
    // The dataset row, by the one stat-line mapper.
    const { data: perf } = await admin.from('athlete_performances').select('sport_key, natural_key, metrics, headline, provenance').eq('source_id', post!.id).maybeSingle();
    expect(perf).toMatchObject({ sport_key: 'cycling', natural_key: `post:${post!.id}`, provenance: 'self_reported' });
    expect(Number((perf!.metrics as Record<string, number>).distance_km)).toBeGreaterThan(5.5);
    // Linked; one post per activity.
    const { data: linked } = await admin.from('activities').select('post_id').eq('id', id).single();
    expect(linked!.post_id).toBe(post!.id);
    const twice = await api.post('/api/posts', { data: { postType: 'cycling', caption: '', stats_data: { type: 'activity', activity_id: id } } });
    expect(twice.status()).toBe(409);
    // The sport's own stat-line read sees it.
    const lines = await api.get(`/api/sports/stat-lines?profileId=${a.id}&sport=cycling`);
    if (lines.ok()) expect(JSON.stringify(await lines.json())).toContain(post!.id);
  } finally {
    await api.dispose();
    await deleteQaUser(a.id);
  }
});
