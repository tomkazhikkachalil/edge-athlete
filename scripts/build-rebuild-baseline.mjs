#!/usr/bin/env node
/**
 * `npm run build:baseline` — regenerate database/baseline/000_rebuild.sql
 * from the LIVE schema (Round 2 — a rebuildable chain, Sep 2026).
 *
 *  1. Calls public.schema_dump() (migration 227, service-role only) and
 *     saves the jsonb under database/provenance/dumps/<date>-schema.json
 *     (evidence, never overwritten — the next free suffix).
 *  2. Writes the file through `buildRebuildSql` (rebuild-baseline-core.mjs).
 *  3. SELF-CHECK: parses the generated SQL with the provenance parser and
 *     diffs it against PostgREST's live inventory — every live table and
 *     column must be in the file and nothing in the file may be missing
 *     live. A generator that dropped a column is a failing build here, not
 *     a surprise in staging. Exit 1 on any difference.
 *
 * LOCAL only (the service key, like check:schema). Never in CI.
 *
 *   npm run build:baseline
 *   node scripts/build-rebuild-baseline.mjs --offline dumps/2026-09-21-schema.json   # no network; the self-check is skipped
 *   node scripts/build-rebuild-baseline.mjs --out /tmp/x.sql
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { buildRebuildSql } from './rebuild-baseline-core.mjs';
import { diff, liveFromOpenApi, parseChain } from './schema-inventory-core.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const offline = flag('--offline');
const out = flag('--out') ?? 'database/baseline/000_rebuild.sql';
const migrationsDir = 'database/migrations';

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

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('build-baseline: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or --offline <dump.json>).');
    process.exit(2);
  }
  return { base: url.replace(/\/$/, ''), key };
}

async function fetchDump() {
  const { base, key } = credentials();
  const res = await fetch(`${base}/rest/v1/rpc/schema_dump`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    let code = null;
    try {
      code = (await res.clone().json()).code ?? null;
    } catch {
      /* not json */
    }
    if (res.status === 404 && (code === 'PGRST202' || code === null)) {
      console.error('build-baseline: schema_dump RPC not found — run migration 227 first.');
      process.exit(2);
    }
    console.error(`build-baseline: schema_dump answered ${res.status}: ${await res.text()}`);
    process.exit(2);
  }
  return res.json();
}

async function fetchLive() {
  const { base, key } = credentials();
  const res = await fetch(`${base}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
  if (!res.ok) {
    console.error(`build-baseline: PostgREST answered ${res.status}`);
    process.exit(2);
  }
  return liveFromOpenApi(await res.json());
}

const dump = offline ? JSON.parse(readFileSync(String(offline), 'utf8')) : await fetchDump();

if (!offline) {
  let target = `database/provenance/dumps/${new Date().toISOString().slice(0, 10)}-schema.json`;
  for (let n = 2; existsSync(target); n++) target = target.replace(/(?:-\d+)?-schema\.json$/, `-${n}-schema.json`);
  writeFileSync(target, JSON.stringify(dump, null, 1) + '\n');
  console.error(`build-baseline: dump saved to ${target}`);
}

const chainFiles = readdirSync(migrationsDir).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort();
const sourceHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://edge-athlete.vercel.app').host;
  } catch {
    return null;
  }
})();
const sql = buildRebuildSql(dump, { chainFiles, sourceHost });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql);
console.error(`build-baseline: wrote ${out} (${sql.length} bytes; ${dump.tables?.length ?? 0} tables, ${dump.functions?.length ?? 0} functions, ${dump.policies?.length ?? 0} policies, ${dump.triggers?.length ?? 0} triggers; ledger head ${dump.meta?.ledger?.head ?? 'none'})`);

// The self-check.
const parsed = parseChain([{ name: '000_rebuild.sql', sql }]);
if (offline) {
  console.error(`build-baseline: offline — parsed back ${parsed.tables.size} tables, ${parsed.functions.size} functions (no live diff)`);
  process.exit(0);
}
const live = await fetchLive();
const result = diff(live.tables, parsed, []);
if (!result.ok) {
  console.error('build-baseline: the generated file does NOT match the live inventory:');
  for (const t of result.unownedTables ?? []) console.error(`  live table missing from the file: ${t}`);
  for (const c of result.unownedColumns ?? []) console.error(`  live column missing from the file: ${typeof c === 'string' ? c : `${c.table}.${c.column}`}`);
  for (const t of result.chainOnlyTables ?? []) console.error(`  file table not live: ${t}`);
  for (const c of result.chainOnlyColumns ?? []) console.error(`  file column not live: ${typeof c === 'string' ? c : `${c.table}.${c.column}`}`);
  process.exit(1);
}
console.error(`build-baseline: self-check OK — the file names every live table and column (${Object.keys(live.tables).length} tables).`);
