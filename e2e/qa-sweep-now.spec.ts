import { test, expect } from './helpers/test';
import { adminClient, sweepStaleQa } from './helpers/qa-user';

// The sweep-now door (Oct 27 2026). A production probe that is KILLED never
// reaches its teardown, and its edgeqa-* users stay until the next run's
// sweep finds them older than 3 h (two killed waves on Oct 26 left eight
// "Edge QA Alpha … Delta" profiles that Tom saw). This spec runs the same
// sweep with a 15-minute cutoff — one command, every existing guard:
//
//   E2E_SWEEP_NOW=1 E2E_TARGET=prod E2E_ALLOW_PROD=1 E2E_BASE_URL=https://edgeathlete.ca \
//     npx playwright test --project=desktop e2e/qa-sweep-now.spec.ts
//
// It self-skips without E2E_SWEEP_NOW, so the normal sets never run it; it
// only ever touches the addresses the sweep recognises (edgeqa-*, the QA org
// shapes, the shadow users no live holder protects).
test('sweep now: every QA shape older than 15 minutes is gone', async () => {
  test.skip(process.env.E2E_SWEEP_NOW !== '1', 'the sweep-now door is opened by E2E_SWEEP_NOW=1');
  test.setTimeout(600_000);
  const cutoffMs = 15 * 60_000;
  await sweepStaleQa({ cutoffMs });
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  expect(error).toBeNull();
  const cutoff = Date.now() - cutoffMs;
  const left = (data?.users ?? []).filter(u => /^edgeqa-/i.test(u.email ?? '') && new Date(u.created_at).getTime() < cutoff);
  console.log(`[sweep now] QA users older than 15 min after the sweep: ${left.length}`, left.map(u => u.email));
  expect(left).toEqual([]);
});
