import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deleteQaUser, type QaUser } from './helpers/qa-user';

export default async function globalTeardown() {
  const userPath = join(process.cwd(), 'e2e', '.auth', 'user.json');
  if (!existsSync(userPath)) return;
  const user: QaUser = JSON.parse(readFileSync(userPath, 'utf8'));
  try {
    await deleteQaUser(user.id);
    console.log(`[e2e] QA user deleted: ${user.email}`);
  } catch (err) {
    // Surface loudly — a leaked QA user in the prod DB is exactly what the
    // 24h sweep in the NEXT run will catch, but it should never be silent.
    console.error(`[e2e] TEARDOWN FAILED for ${user.email}:`, err);
    throw err;
  }
}
