import { readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { adminClient, deleteQaUser, type QaUser } from './helpers/qa-user';
import { createdQaOrgIds, deleteQaOrgs } from './helpers/org';

// Deletes in reverse order of minting (D, C, B, A): cross-user artifacts
// (conversations, follows, notifications) are cleaned by whichever deletion
// runs first, so the later ones exercise the already-cleaned path and prove
// the steps idempotent. Every deletion is attempted even if one throws — a
// leaked QA user in the prod DB must never be silent (the 24h sweep is the
// backstop, not the plan).
//
// Round 1 PR 5 (Sep 21 2026): this list named A and B only. C and D
// (minted since the events program, Sep 16) leaked on EVERY run — 78 of
// them on prod by the time the assessment's count was re-read — and the
// sweep read one page of 200 users, so past a page they were permanent.
export default async function globalTeardown() {
  const authDir = join(process.cwd(), 'e2e', '.auth');
  const errors: unknown[] = [];

  for (const file of ['user-d.json', 'user-c.json', 'user-b.json', 'user.json'] as const) {
    const path = join(authDir, file);
    if (!existsSync(path)) continue;
    const user: QaUser = JSON.parse(readFileSync(path, 'utf8'));
    try {
      await deleteQaUser(user.id);
      console.log(`[e2e] QA user deleted: ${user.email}`);
    } catch (err) {
      console.error(`[e2e] TEARDOWN FAILED for ${user.email}:`, err);
      errors.push(err);
    }
  }
  // Teardown hardening (Sep 24 2026): the orgs a spec minted and never
  // reached its `finally` for (a kill, a timeout) — the run's registry is
  // the list. Loud: a non-zero count is a spec whose teardown is broken.
  const leftover = createdQaOrgIds();
  if (leftover.size) {
    const ids = [...leftover];
    try {
      const removed = await deleteQaOrgs(adminClient(), ids);
      console.warn(`[e2e] teardown removed ${removed} org(s) a spec left behind: ${ids.join(', ')}`);
    } catch (err) {
      console.error('[e2e] TEARDOWN FAILED for the run\'s orgs:', err);
      errors.push(err);
    }
  }
  // The state files are this run's; a stale user.json must never be re-read.
  if (existsSync(authDir)) {
    for (const f of readdirSync(authDir)) if (f.endsWith('.json')) rmSync(join(authDir, f), { force: true });
  }
  if (errors.length) throw errors[0];
}
