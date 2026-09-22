#!/usr/bin/env node
/**
 * `node scripts/staging-sql.mjs <file.sql | -e "sql">` — run SQL on the
 * STAGING project through Supabase's management API (Round 2, Sep 2026).
 *
 * Reads SUPABASE_ACCESS_TOKEN and STAGING_PROJECT_REF from .env.staging
 * (gitignored). It refuses any ref that equals the prod URL's ref in
 * .env.prod (or the known prod ref) — staging is a throwaway; production's runner stays the SQL
 * editor, by Tom's rule. The whole file is sent as ONE query (one
 * transaction, like the editor); the last statement's rows are printed.
 * LOCAL only.
 */
import { readFileSync } from 'fs';

const env = {};
// .env.prod names production (Round 2: .env.local is STAGING); the constant
// is the fallback when .env.prod is absent.
const PROD_REF_FALLBACK = 'htwhmdoiszhhmwuflgci';
for (const file of ['.env.staging', '.env.prod']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* absent */
  }
}
const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.STAGING_PROJECT_REF;
const prodRef = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1] ?? PROD_REF_FALLBACK;
if (!token || !ref || ref.startsWith('PASTE')) {
  console.error('staging-sql: SUPABASE_ACCESS_TOKEN and STAGING_PROJECT_REF are required in .env.staging');
  process.exit(2);
}
if (ref === prodRef) {
  console.error('staging-sql: REFUSED — STAGING_PROJECT_REF is the production project');
  process.exit(2);
}
const args = process.argv.slice(2);
const sql = args[0] === '-e' ? args.slice(1).join(' ') : readFileSync(args[0], 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`staging-sql: ${res.status}\n${text.slice(0, 4000)}`);
  process.exit(1);
}
try {
  const rows = JSON.parse(text);
  console.log(Array.isArray(rows) ? JSON.stringify(rows.slice(0, 50), null, 1) : text);
} catch {
  console.log(text.slice(0, 4000));
}
