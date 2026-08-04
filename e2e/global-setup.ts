import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createQaUser, mintStorageState, sweepStaleQaUsers } from './helpers/qa-user';

// Two disposable users: A drives most specs (default storageState), B exists
// for the two-user flows (follow request, DM, round invite). Names must be
// distinct and neither a substring of the other, or name-based assertions
// ambiguate. Both stay PRIVATE — required for the follow-request path, and
// privacy blocks neither DMs nor invites.
export default async function globalSetup() {
  await sweepStaleQaUsers();

  const authDir = join(process.cwd(), 'e2e', '.auth');
  mkdirSync(authDir, { recursive: true });

  const userA = await createQaUser({
    displayName: 'Edge QA Alpha', firstName: 'Edge', lastName: 'Alpha',
  });
  const stateA = await mintStorageState(userA);
  writeFileSync(join(authDir, 'state.json'), JSON.stringify(stateA, null, 2));
  writeFileSync(join(authDir, 'user.json'), JSON.stringify(userA, null, 2));

  const userB = await createQaUser({
    displayName: 'Edge QA Bravo', firstName: 'Edge', lastName: 'Bravo',
  });
  const stateB = await mintStorageState(userB);
  writeFileSync(join(authDir, 'state-b.json'), JSON.stringify(stateB, null, 2));
  writeFileSync(join(authDir, 'user-b.json'), JSON.stringify(userB, null, 2));

  console.log(`[e2e] QA users ready: ${userA.email} (A), ${userB.email} (B)`);
}
