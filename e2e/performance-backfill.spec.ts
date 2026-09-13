import { test, expect, request as pwRequest } from '@playwright/test';
import {
  adminClient, adminEmailForE2E, apiAs, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL,
} from './helpers/qa-user';

// Data foundation F5 (Sep 13 2026): POST /api/admin/performance-backfill —
// admin-only, dry-run by default, one source per call. The gate is asserted
// (a signed-in non-admin is a 403), the contract (a bad source is a 400, a
// foreign cursor is a 400, a dry run writes nothing), and the idempotent
// live run: a stat-line post whose performance row was removed by hand
// comes back through the posts source. Skips without E2E_ADMIN_EMAIL; the
// live half skips pre-194.
const adminEmail = adminEmailForE2E();

test('performance backfill: admin gate, contract, and an idempotent live run over posts', async () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(120_000);

  const qa = await apiAs('state.json');
  let postId = '';
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser) });
  try {
    // The gate: a signed-in non-admin is refused.
    const denied = await qa.post('/api/admin/performance-backfill', { data: { source: 'posts' } });
    expect(denied.status()).toBe(403);

    // The contract.
    const badSource = await adminApi.post('/api/admin/performance-backfill', { data: { source: 'profiles' } });
    expect(badSource.status()).toBe(400);
    const badCursor = await adminApi.post('/api/admin/performance-backfill', { data: { source: 'posts', cursor: 'not-a-cursor' } });
    expect(badCursor.status()).toBe(400);

    const dry = await adminApi.post('/api/admin/performance-backfill', { data: { source: 'posts' } });
    expect(dry.ok(), await readErrorBody(dry)).toBe(true);
    const dryBody = await dry.json();
    expect(dryBody).toMatchObject({ dryRun: true, source: 'posts', upserted: 0, truncated: false });
    expect(typeof dryBody.scanned).toBe('number');
    expect(dryBody.mapped + Object.values(dryBody.skipped as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(dryBody.scanned);

    // The live half needs the table.
    const admin = adminClient();
    const probe = await admin.from('athlete_performances').select('id').limit(1);
    test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 194 not applied on this target');

    const post = await qa.post('/api/posts', {
      data: {
        caption: `Backfill hockey ${Date.now()}`,
        visibility: 'private',
        postType: 'ice_hockey',
        stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', stats: { goals: 1, assists: 2 } },
      },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    postId = (await post.json()).post.id;
    const key = `post:${postId}`;
    // The hook wrote it; remove it by hand so the backfill has something to restore.
    for (let i = 0; i < 20; i++) {
      const { data } = await admin.from('athlete_performances').select('id').eq('natural_key', key).maybeSingle();
      if (data) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await admin.from('athlete_performances').delete().eq('natural_key', key);
    expect((await admin.from('athlete_performances').select('id').eq('natural_key', key).maybeSingle()).data).toBeNull();

    // Walk the posts source to the end, writing.
    let cursor: string | null = null;
    let upserted = 0;
    for (let i = 0; i < 20; i++) {
      const live = await adminApi.post('/api/admin/performance-backfill', { data: { source: 'posts', dryRun: false, ...(cursor ? { cursor } : {}) } });
      expect(live.ok(), await readErrorBody(live)).toBe(true);
      const body = await live.json();
      expect(body.dryRun).toBe(false);
      upserted += body.upserted;
      cursor = body.nextCursor;
      if (!body.truncated) break;
    }
    expect(upserted).toBeGreaterThan(0);
    const { data: restored } = await admin.from('athlete_performances').select('metrics, headline, provenance').eq('natural_key', key).maybeSingle();
    expect(restored).toMatchObject({ metrics: { goals: 1, assists: 2 }, provenance: 'self_reported' });
    expect(Number(restored?.headline)).toBe(3);
  } finally {
    if (postId) await qa.delete(`/api/posts?postId=${postId}`).catch(() => {});
    await adminApi.dispose();
    await qa.dispose();
    await deleteQaUser(adminUser.id);
  }
});
