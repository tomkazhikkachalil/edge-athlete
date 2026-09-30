// The production reset's SNAPSHOT (Sep 30 2026): every row of every table
// the reset wipes, every storage object, and the auth user list — to a
// gitignored folder on this Mac (database/ops/snapshots/<date>-<env>/).
// This is the rollback. Read-only against the database.
//
//   TARGET_ENV=prod node scripts/prod-reset/export.mjs
//
// Kept tables (the catalogs) are not exported: nothing touches them.

import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PARTIAL, goTables } from './tables.mjs';

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
const day = new Date().toISOString().slice(0, 10);
const out = path.join('database/ops/snapshots', `${day}-${target}-${ref}`);
mkdirSync(path.join(out, 'storage'), { recursive: true });
console.log(`export → ${out} (${target}, ${ref})`);

const PAGE = 1000;
const counts = {};

async function exportTable(table, where) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin.from(table).select('*').range(from, from + PAGE - 1);
    if (where) q = where(q);
    const { data, error } = await q;
    if (error) {
      console.error(`  ${table}: ERROR ${error.code} ${error.message}`);
      counts[table] = `ERR ${error.code}`;
      return;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  writeFileSync(path.join(out, `${table}.json`), JSON.stringify(rows));
  counts[table] = rows.length;
  if (rows.length > 0) console.log(`  ${table}: ${rows.length}`);
}

for (const t of goTables()) await exportTable(t);
for (const [t] of Object.entries(PARTIAL)) await exportTable(t, q => q.neq('entity_type', 'course'));

// Storage: every object, recursively, downloaded.
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
      else found.push({ path: p, size: e.metadata?.size ?? null, updated: e.updated_at ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return found;
}

const manifest = {};
for (const bucket of ['uploads', 'avatars', 'consent-evidence', 'badges']) {
  const objects = await walk(bucket);
  manifest[bucket] = objects;
  let saved = 0;
  for (const o of objects) {
    const { data, error } = await admin.storage.from(bucket).download(o.path);
    if (error || !data) {
      console.error(`  download failed ${bucket}/${o.path}: ${error?.message}`);
      continue;
    }
    const file = path.join(out, 'storage', bucket, o.path);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await data.arrayBuffer()));
    saved++;
  }
  console.log(`  storage ${bucket}: ${objects.length} objects, ${saved} saved`);
}
writeFileSync(path.join(out, 'storage-manifest.json'), JSON.stringify(manifest, null, 1));

// Auth users (id, email, dates — never the password hash; it is not exposed).
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error(`  auth: ${error.message}`);
    break;
  }
  users.push(...data.users.map(u => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, providers: u.app_metadata?.providers ?? [] })));
  if (data.users.length < 1000) break;
}
writeFileSync(path.join(out, 'auth-users.json'), JSON.stringify(users, null, 1));
console.log(`  auth users: ${users.length}`);

counts._storage = Object.fromEntries(Object.entries(manifest).map(([b, o]) => [b, o.length]));
counts._auth_users = users.length;
writeFileSync(path.join(out, 'counts.json'), JSON.stringify(counts, null, 1));
console.log(`done — counts.json written; ${existsSync(path.join(out, 'counts.json')) ? 'ok' : 'MISSING'}`);
