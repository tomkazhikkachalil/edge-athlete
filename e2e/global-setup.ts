import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { adminClient, createQaUser, deleteQaUser, mintStorageState, previewStorageState, resetQaBuckets, sweepStaleQa, type QaUser } from './helpers/qa-user';
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
  await sweepStaleQa();

  const authDir = join(process.cwd(), 'e2e', '.auth');
  mkdirSync(authDir, { recursive: true });

  // Teardown hardening (Sep 24 2026): a failure minting B–D used to leak A–C
  // (and their written .auth files) until the 24 h sweep. Every minted user
  // is deleted and every written file removed before the failure rethrows.
  const minted: QaUser[] = [];
  const written: string[] = [];
  const write = (name: string, value: unknown) => {
    const path = join(authDir, name);
    writeFileSync(path, JSON.stringify(value, null, 2));
    written.push(path);
  };
  try {
    const userA = await createQaUser({
      displayName: 'Edge QA Alpha', firstName: 'Edge', lastName: 'Alpha',
    });
    minted.push(userA);
    // The SIGNED-OUT state (Round 2, Sep 21 2026): empty off a preview; on a
    // Vercel preview it carries the automation-bypass cookie, so a guest
    // context still reaches the app. Every signed-out actor opens this file.
    write('anon.json', await previewStorageState());

    const stateA = await mintStorageState(userA);
    write('state.json', stateA);
    write('user.json', userA);

    const userB = await createQaUser({
      displayName: 'Edge QA Bravo', firstName: 'Edge', lastName: 'Bravo',
    });
    minted.push(userB);
    const stateB = await mintStorageState(userB);
    write('state-b.json', stateB);
    write('user-b.json', userB);

    const userC = await createQaUser({
      displayName: 'Edge QA Charlie', firstName: 'Edge', lastName: 'Charlie',
    });
    minted.push(userC);
    const stateC = await mintStorageState(userC);
    write('state-c.json', stateC);
    write('user-c.json', userC);

    const userD = await createQaUser({
      displayName: 'Edge QA Delta', firstName: 'Edge', lastName: 'Delta',
    });
    minted.push(userD);
    const stateD = await mintStorageState(userD);
    write('state-d.json', stateD);
    write('user-d.json', userD);
    // The run-wide belt: every user-keyed bucket of the four is empty.
    await resetQaBuckets(adminClient(), minted.map(u => u.id));
  } catch (err) {
    console.error('[e2e] global setup failed — deleting what was minted:', (err as Error).message);
    for (const u of minted.reverse()) {
      await deleteQaUser(u.id).catch(e => console.error(`[e2e] could not delete ${u.email}:`, (e as Error).message));
    }
    for (const path of written) rmSync(path, { force: true });
    throw err;
  }
  console.log(`[e2e] QA users ready: ${minted.map((u, i) => `${u.email} (${'ABCD'[i]})`).join(', ')}`);
}
