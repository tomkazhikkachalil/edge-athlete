import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deleteQaUser, type QaUser } from './helpers/qa-user';

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
  if (errors.length) throw errors[0];
}
