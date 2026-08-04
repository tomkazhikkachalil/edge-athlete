import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createQaUser, mintStorageState, sweepStaleQaUsers } from './helpers/qa-user';

export default async function globalSetup() {
  await sweepStaleQaUsers();

  const user = await createQaUser();
  const state = await mintStorageState(user);

  const authDir = join(process.cwd(), 'e2e', '.auth');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(authDir, 'user.json'), JSON.stringify(user, null, 2));
  console.log(`[e2e] QA user ready: ${user.email}`);
}
