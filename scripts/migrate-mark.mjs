#!/usr/bin/env node
/**
 * `npm run migrate:mark <number>` — the ledger's CORRECTION path (migration
 * 226, Round 2). From 227 on every migration records itself in
 * `schema_migrations`; this is for the two cases where it cannot: a file
 * that ran before its footer existed, or a row removed by hand. It writes
 * ONE row with `applied_by = 'migrate:mark'` through PostgREST with the
 * service key — it never runs the migration. LOCAL only, like check:schema.
 *
 *   npm run migrate:mark 227
 *   npm run migrate:mark 227 -- --unmark    # remove the row (the file did NOT run)
 */
import { readFileSync, readdirSync } from 'fs';

const args = process.argv.slice(2).filter(a => a !== '--');
const unmark = args.includes('--unmark');
const number = Number(args.find(a => /^\d+$/.test(a)));
if (!Number.isInteger(number) || number < 1) {
  console.error('migrate-mark: usage — npm run migrate:mark <number> [-- --unmark]');
  process.exit(2);
}

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) continue;
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === key) process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env.local */
  }
}
const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.error('migrate-mark: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (env or .env.local)');
  process.exit(2);
}

const name = readdirSync('database/migrations').find(n => n.startsWith(`${String(number).padStart(3, '0')}_`) && n.endsWith('.sql'));
if (!name) {
  console.error(`migrate-mark: no database/migrations/${String(number).padStart(3, '0')}_*.sql — the ledger records files, not numbers`);
  process.exit(2);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const res = unmark
  ? await fetch(`${base}/rest/v1/schema_migrations?number=eq.${number}`, { method: 'DELETE', headers })
  : await fetch(`${base}/rest/v1/schema_migrations`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ number, name, applied_by: 'migrate:mark' }) });
const body = await res.text();
if (!res.ok) {
  console.error(`migrate-mark: PostgREST answered ${res.status}: ${body}`);
  process.exit(1);
}
console.log(unmark ? `migrate-mark: removed ${number} (${name}) from the ledger` : `migrate-mark: ${name} recorded${body === '[]' ? ' (already there)' : ''}`);
