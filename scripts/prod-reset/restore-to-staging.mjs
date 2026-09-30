// Restore a snapshot (scripts/prod-reset/export.mjs) into STAGING — the
// restore drill (docs/RUNBOOK_BACKUP.md) and, on Sep 30 2026, the way Tom
// browses the data the production reset removed: on localhost, which runs
// against staging. STAGING ONLY: the management token in .env.staging names
// the staging ref and this refuses anything else (staging-sql.mjs's guard).
//
//   node scripts/prod-reset/restore-to-staging.mjs                       # dry run
//   node scripts/prod-reset/restore-to-staging.mjs --confirm=restore-staging [--snapshot <dir>]
//
// What it does, in order: wipe staging's user data (the reset's own table
// list, every auth user, the three buckets); create the snapshot's auth
// users with their ORIGINAL ids (no FK reaches auth.users; no signup
// trigger fires) and generated passwords written to
// <snapshot>/staging-passwords.txt; load every table with row triggers OFF
// (`SET LOCAL session_replication_role = replica` — search / count /
// notification triggers would otherwise corrupt a bulk load) and the prod
// storage host rewritten to staging's; upload every storage file; verify
// the counts against counts.json and the manifest.

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PARTIAL, goTables } from './tables.mjs';

const CONFIRM = 'restore-staging';
const args = process.argv.slice(2);
const confirmed = args.includes(`--confirm=${CONFIRM}`);
const snapArg = args.find(a => a.startsWith('--snapshot='))?.slice('--snapshot='.length);

const readEnv = file => {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in out)) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* absent */
  }
  return out;
};
const mgmt = readEnv('.env.staging');
const local = readEnv('.env.local');
const prod = readEnv('.env.prod');
const token = mgmt.SUPABASE_ACCESS_TOKEN;
const ref = mgmt.STAGING_PROJECT_REF;
const localRef = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(local.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1];
const prodRef = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(prod.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1] ?? 'htwhmdoiszhhmwuflgci';
if (!token || !ref) throw new Error('restore: SUPABASE_ACCESS_TOKEN and STAGING_PROJECT_REF are required in .env.staging');
if (ref === prodRef || localRef === prodRef) throw new Error('restore: REFUSED — this would touch the production project');
if (localRef !== ref) throw new Error(`restore: .env.local (${localRef}) and .env.staging (${ref}) name different projects`);

const admin = createClient(local.NEXT_PUBLIC_SUPABASE_URL, local.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sql ${res.status}: ${text.slice(0, 600)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The snapshot.
const snapshotDir =
  snapArg ??
  readdirSync('database/ops/snapshots')
    .filter(d => d.includes('-prod-'))
    .sort()
    .map(d => path.join('database/ops/snapshots', d))
    .pop();
if (!snapshotDir || !existsSync(path.join(snapshotDir, 'counts.json'))) throw new Error('restore: no snapshot folder with counts.json');
const counts = JSON.parse(readFileSync(path.join(snapshotDir, 'counts.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(snapshotDir, 'storage-manifest.json'), 'utf8'));
const users = JSON.parse(readFileSync(path.join(snapshotDir, 'auth-users.json'), 'utf8'));
const snapshotRef = /-prod-([a-z0-9]+)$/.exec(snapshotDir)?.[1] ?? prodRef;
const tables = [...goTables(), ...Object.keys(PARTIAL)].filter(t => existsSync(path.join(snapshotDir, `${t}.json`)));
console.log(`${confirmed ? 'RESTORE' : 'DRY RUN'} → staging (${ref}) from ${snapshotDir}`);
console.log(`  ${tables.length} tables, ${users.length} auth users, ${Object.values(manifest).reduce((n, o) => n + o.length, 0)} storage objects`);
console.log(`  storage host rewrite: ${snapshotRef} → ${ref}`);

// 1. Insertable columns per table (generated columns excluded; identity noted).
const colRows = await sql(`SELECT table_name, column_name, is_generated, is_identity, ordinal_position
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${tables.map(t => `'${t}'`).join(',')}) ORDER BY table_name, ordinal_position`);
const columns = new Map();
const hasIdentity = new Set();
for (const r of colRows) {
  if (r.is_generated === 'ALWAYS') continue;
  if (r.is_identity === 'YES') hasIdentity.add(r.table_name);
  if (!columns.has(r.table_name)) columns.set(r.table_name, []);
  columns.get(r.table_name).push(r.column_name);
}
const missing = tables.filter(t => !columns.has(t));
if (missing.length > 0) throw new Error(`restore: tables absent on staging: ${missing.join(', ')}`);

if (!confirmed) {
  for (const t of tables) {
    const n = JSON.parse(readFileSync(path.join(snapshotDir, `${t}.json`), 'utf8')).length;
    if (n > 0) console.log(`  would load ${t}: ${n} rows${hasIdentity.has(t) ? ' (identity)' : ''}`);
  }
  console.log('dry run complete — nothing changed');
  process.exit(0);
}

// 2. Wipe staging's user data: tables, auth users, buckets.
console.log('wiping staging…');
await sql(`TRUNCATE TABLE ${goTables().map(t => `public.${t}`).join(', ')} RESTART IDENTITY;`);
for (const [t, where] of Object.entries(PARTIAL)) await sql(`DELETE FROM public.${t} WHERE ${where};`);
let deleted = 0;
for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`auth list: ${error.message}`);
  if (data.users.length === 0) break;
  for (const u of data.users) {
    const { error: e } = await admin.auth.admin.deleteUser(u.id);
    if (e) console.error(`  delete ${u.email}: ${e.message}`);
    else deleted++;
  }
}
console.log(`  auth users deleted: ${deleted}`);
async function walk(bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) break;
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
  for (let i = 0; i < objects.length; i += 100) await admin.storage.from(bucket).remove(objects.slice(i, i + 100));
  console.log(`  storage ${bucket}: ${objects.length} removed`);
}

// 3. Auth users with their original ids.
const passwords = [];
for (const u of users) {
  const password = `${randomBytes(9).toString('base64url')}!Ea1`;
  const { error } = await admin.auth.admin.createUser({ id: u.id, email: u.email, email_confirm: true, password });
  if (error) console.error(`  createUser ${u.email}: ${error.message}`);
  else passwords.push(`${u.email}\t${password}`);
}
writeFileSync(path.join(snapshotDir, 'staging-passwords.txt'), `# staging sign-in passwords (generated ${new Date().toISOString()}) — email<TAB>password\n${passwords.join('\n')}\n`);
console.log(`  auth users created: ${passwords.length} (passwords → ${path.join(snapshotDir, 'staging-passwords.txt')})`);

// 4. Tables, row triggers off, host rewritten.
const BATCH = 500;
for (const t of tables) {
  const rows = JSON.parse(readFileSync(path.join(snapshotDir, `${t}.json`), 'utf8'));
  if (rows.length === 0) continue;
  const cols = columns.get(t).filter(c => c in rows[0]).map(c => `"${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += BATCH) {
    const json = JSON.stringify(rows.slice(i, i + BATCH)).split(snapshotRef).join(ref);
    if (json.includes('$j$')) throw new Error(`restore: ${t} holds the quote tag`);
    await sql(`SET LOCAL session_replication_role = replica;
INSERT INTO public.${t} (${cols}) ${hasIdentity.has(t) ? 'OVERRIDING SYSTEM VALUE ' : ''}
SELECT ${cols} FROM json_populate_recordset(NULL::public.${t}, $j$${json}$j$::json);`);
  }
  console.log(`  loaded ${t}: ${rows.length}`);
}
for (const t of hasIdentity) {
  const idCol = colRows.find(r => r.table_name === t && r.is_identity === 'YES')?.column_name;
  if (idCol) await sql(`SELECT setval(pg_get_serial_sequence('public.${t}', '${idCol}'), COALESCE((SELECT max(${idCol}) FROM public.${t}), 999) + 1, false);`);
}

// 5. Storage.
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf', gz: 'application/gzip', json: 'application/json', svg: 'image/svg+xml' };
let uploaded = 0;
for (const bucket of Object.keys(manifest)) {
  const root = path.join(snapshotDir, 'storage', bucket);
  if (!existsSync(root)) continue;
  const files = [];
  const collect = dir => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) collect(p);
      else files.push(p);
    }
  };
  collect(root);
  for (const f of files) {
    const key = path.relative(root, f).split(path.sep).join('/');
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    let error = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ error } = await admin.storage.from(bucket).upload(key, readFileSync(f), { upsert: true, contentType: MIME[ext] ?? 'application/octet-stream' }));
      if (!error) break; // a transient "fetch failed" gets two more tries
    }
    if (error) console.error(`  upload ${bucket}/${key}: ${error.message}`);
    else uploaded++;
  }
  console.log(`  storage ${bucket}: ${files.length} files`);
}

// 6. Verify.
const problems = [];
for (const t of tables) {
  let q = admin.from(t).select('*', { count: 'exact', head: true });
  if (t in PARTIAL) q = q.neq('entity_type', 'course');
  const { count, error } = await q;
  const expected = counts[t];
  if (error || count !== expected) problems.push(`${t}: staging ${error ? error.code : count} vs snapshot ${expected}`);
}
for (const bucket of Object.keys(manifest)) {
  const have = (await walk(bucket)).length;
  if (have !== manifest[bucket].length) problems.push(`storage ${bucket}: ${have} vs ${manifest[bucket].length}`);
}
const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
if ((after?.users.length ?? 0) !== users.length) problems.push(`auth users: ${after?.users.length} vs ${users.length}`);
console.log(problems.length === 0 ? `verified — every table, ${uploaded} objects and ${users.length} users match the snapshot` : `MISMATCHES:\n  ${problems.join('\n  ')}`);
