// The production reset's second half (Sep 30 2026): AFTER the SQL truncated
// the tables, empty every storage bucket the app writes and delete every
// auth user — through the admin API (never the dashboard; MIGRATIONS / 238).
// Then re-list both and re-count every wiped table, as a second pair of
// eyes on the SQL.
//
//   TARGET_ENV=prod node scripts/prod-reset/wipe.mjs                 # dry run: lists, deletes nothing
//   TARGET_ENV=prod node scripts/prod-reset/wipe.mjs --confirm=edgeathlete-reset-2026-09-30
//
// Refuses when any wiped table still has rows (the SQL has not run) unless
// --after-sql-skip is also passed — the order matters: tables first, so no
// cascade from a user delete runs against live rows.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { goTables } from './tables.mjs';

const CONFIRM = 'edgeathlete-reset-2026-09-30';
const args = process.argv.slice(2);
const confirmed = args.includes(`--confirm=${CONFIRM}`);
const target = process.env.TARGET_ENV === 'prod' ? 'prod' : 'staging';
const envFile = target === 'prod' ? '.env.prod' : '.env.local';
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ref = env.NEXT_PUBLIC_SUPABASE_URL.replace(/https:\/\/([a-z]+)\..*/, '$1');
console.log(`${confirmed ? 'WIPE' : 'DRY RUN'} — ${target} (${ref})`);

// 0. The tables must already be empty (the SQL ran).
const notEmpty = [];
for (const t of goTables()) {
  const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
  if (error) console.error(`  count ${t}: ${error.code} ${error.message}`);
  else if ((count ?? 0) > 0) notEmpty.push(`${t}=${count}`);
}
if (notEmpty.length > 0) {
  console.log(`tables still holding rows (${notEmpty.length}): ${notEmpty.slice(0, 12).join(' ')}${notEmpty.length > 12 ? ' …' : ''}`);
  if (confirmed && !args.includes('--after-sql-skip')) {
    console.error('REFUSED: run database/ops/2026-09-30-prod-reset.sql first (tables before storage and auth).');
    process.exit(1);
  }
} else console.log('every wiped table reads 0 — the SQL ran');

// 1. Storage.
async function walk(bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) {
      console.error(`  storage ${bucket}/${prefix}: ${error.message}`);
      break;
    }
    for (const e of data ?? []) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.metadata === null) found.push(...(await walk(bucket, p)));
      else found.push(p);
    }
    if (!data || data.length < 1000) break;
  }
  return found;
}
for (const bucket of ['uploads', 'avatars', 'consent-evidence']) {
  const objects = await walk(bucket);
  console.log(`  storage ${bucket}: ${objects.length} objects${confirmed ? ' → removing' : ''}`);
  if (!confirmed) continue;
  for (let i = 0; i < objects.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(objects.slice(i, i + 100));
    if (error) console.error(`  remove failed (${bucket}): ${error.message}`);
  }
  const left = await walk(bucket);
  console.log(`  storage ${bucket}: ${left.length} left`);
}

// 2. Auth users.
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error(`  auth list: ${error.message}`);
    break;
  }
  users.push(...data.users);
  if (data.users.length < 1000) break;
}
console.log(`  auth users: ${users.length}${confirmed ? ' → deleting' : ''}`);
for (const u of users) {
  if (!confirmed) {
    console.log(`    ${u.email}`);
    continue;
  }
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) console.error(`  delete ${u.email}: ${error.message}`);
}
if (confirmed) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 10 });
  console.log(`  auth users left: ${data?.users.length ?? '?'}`);
}
console.log(confirmed ? 'done' : 'dry run complete — nothing changed');
