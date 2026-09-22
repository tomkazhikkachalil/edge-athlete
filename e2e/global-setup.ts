import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createQaUser, mintStorageState, previewStorageState, sweepStaleQaUsers } from './helpers/qa-user';
import { awaitDeployed } from './helpers/deploy';

// Four disposable users: A drives most specs (default storageState), B exists
// for the two-user flows (follow request, DM, round invite), C and D for the
// four-player flows (Events phase 3: four-ball, foursomes, a bracket). Names
// must be distinct and none a substring of another, or name-based assertions
// ambiguate. All stay PRIVATE — required for the follow-request path, and
// privacy blocks neither DMs nor invites.
export default async function globalSetup() {
  // A remote target must be on the commit we expect before anything runs.
  await awaitDeployed();
  await sweepStaleQaUsers();

  const authDir = join(process.cwd(), 'e2e', '.auth');
  mkdirSync(authDir, { recursive: true });

  const userA = await createQaUser({
    displayName: 'Edge QA Alpha', firstName: 'Edge', lastName: 'Alpha',
  });
  // The SIGNED-OUT state (Round 2, Sep 21 2026): empty off a preview; on a
  // Vercel preview it carries the automation-bypass cookie, so a guest
  // context still reaches the app. Every signed-out actor opens this file.
  writeFileSync(join(authDir, 'anon.json'), JSON.stringify(await previewStorageState(), null, 2));

  const stateA = await mintStorageState(userA);
  writeFileSync(join(authDir, 'state.json'), JSON.stringify(stateA, null, 2));
  writeFileSync(join(authDir, 'user.json'), JSON.stringify(userA, null, 2));

  const userB = await createQaUser({
    displayName: 'Edge QA Bravo', firstName: 'Edge', lastName: 'Bravo',
  });
  const stateB = await mintStorageState(userB);
  writeFileSync(join(authDir, 'state-b.json'), JSON.stringify(stateB, null, 2));
  writeFileSync(join(authDir, 'user-b.json'), JSON.stringify(userB, null, 2));

  const userC = await createQaUser({
    displayName: 'Edge QA Charlie', firstName: 'Edge', lastName: 'Charlie',
  });
  const stateC = await mintStorageState(userC);
  writeFileSync(join(authDir, 'state-c.json'), JSON.stringify(stateC, null, 2));
  writeFileSync(join(authDir, 'user-c.json'), JSON.stringify(userC, null, 2));

  const userD = await createQaUser({
    displayName: 'Edge QA Delta', firstName: 'Edge', lastName: 'Delta',
  });
  const stateD = await mintStorageState(userD);
  writeFileSync(join(authDir, 'state-d.json'), JSON.stringify(stateD, null, 2));
  writeFileSync(join(authDir, 'user-d.json'), JSON.stringify(userD, null, 2));

  console.log(`[e2e] QA users ready: ${userA.email} (A), ${userB.email} (B), ${userC.email} (C), ${userD.email} (D)`);
}
