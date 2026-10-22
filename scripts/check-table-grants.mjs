#!/usr/bin/env node
/**
 * check-table-grants — the live side of the Oct 30 2026 rule (Supabase stops
 * granting the Data API roles on a new `public` table automatically).
 *
 * Reads public.schema_dump() (migration 227/228: table grants through
 * has_table_privilege per role, visible whoever calls) and judges:
 *   ERROR  a table in `public` where service_role holds no privilege — the app
 *          cannot reach it through supabaseAdmin; the migration that created it
 *          forgot its GRANT (database/MIGRATIONS.md "Table grants").
 *   INFO   a table with RLS on, ZERO policies, still holding anon / authenticated
 *          privileges — harmless (zero policies deny every row) but not posture A;
 *          docs/HARDENING.md B7 keeps the list.
 * Exit 1 on an ERROR, 0 otherwise. Runs after schema-inventory in
 * `npm run check:schema` (local → staging) and `check:schema:prod`.
 */
import { TARGET_ENV, loadEnvFile } from './env-file.mjs';

const envFile = loadEnvFile(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.error('check-table-grants: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}
console.log(`check-table-grants: target ${TARGET_ENV}${envFile ? ` (${envFile})` : ' (environment only)'}`);

const res = await fetch(`${base}/rest/v1/rpc/schema_dump`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (!res.ok) {
  const text = await res.text();
  if (res.status === 404 || /PGRST202/.test(text)) {
    console.log('check-table-grants: schema_dump RPC not found (migration 227) — skipped');
    process.exit(0);
  }
  console.error(`check-table-grants: schema_dump failed ${res.status}: ${text.slice(0, 200)}`);
  process.exit(2);
}
const dump = await res.json();
const tables = (dump.tables ?? []).filter(t => (t.schema ?? 'public') === 'public');
const policiesByTable = new Map();
for (const p of dump.policies ?? []) {
  if ((p.schema ?? 'public') !== 'public') continue;
  policiesByTable.set(p.table, (policiesByTable.get(p.table) ?? 0) + 1);
}

const errors = [];
const hygiene = [];
for (const t of tables) {
  const g = t.grants ?? {};
  const has = role => Array.isArray(g[role]) && g[role].length > 0;
  if (!has('service_role')) errors.push(t.name);
  const policies = policiesByTable.get(t.name) ?? 0;
  if (t.rls && policies === 0 && (has('anon') || has('authenticated'))) hygiene.push(t.name);
}

console.log(`check-table-grants: ${tables.length} tables in public; service_role can reach ${tables.length - errors.length}`);
if (hygiene.length) console.log(`  INFO  ${hygiene.length} zero-policy tables still hold anon/authenticated privileges (hygiene, HARDENING B7): ${hygiene.sort().join(', ')}`);
if (errors.length) {
  console.error(`  ERROR ${errors.length} tables with NO service_role privilege — unreachable for the app: ${errors.sort().join(', ')}`);
  console.error('  Fix: GRANT ALL ON TABLE public.<name> TO service_role; (and the migration that created it needs the line — MIGRATIONS.md "Table grants")');
  process.exit(1);
}
console.log('✓ every public table is reachable by service_role');
