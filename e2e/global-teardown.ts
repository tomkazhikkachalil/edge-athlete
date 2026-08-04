import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deleteQaUser, type QaUser } from './helpers/qa-user';

// Deletes B first, then A: cross-user artifacts (conversations, follows,
// notifications) are cleaned by whichever deletion runs first, so the second
// one exercises the already-cleaned path and proves the steps idempotent.
// Both deletions are attempted even if the first throws — a leaked QA user
// in the prod DB must never be silent (the 24h sweep is the backstop, not
// the plan).
export default async function globalTeardown() {
  const authDir = join(process.cwd(), 'e2e', '.auth');
  const errors: unknown[] = [];

  for (const file of ['user-b.json', 'user.json'] as const) {
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
