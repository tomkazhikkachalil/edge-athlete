#!/usr/bin/env node
/**
 * `npm run check:schema` — schema provenance against the LIVE project
 * (data foundation, P1 — Sep 13 2026).
 *
 * Pulls PostgREST's OpenAPI definitions (every table and column the
 * service role can see — the anon key would miss the posture-A tables),
 * parses database/migrations/*.sql for what the numbered chain OWNS, and
 * diffs the two against database/provenance/allowlist.json. Exit 1 on
 * drift or a stale allowlist entry; 0 when every live table and column is
 * owned or documented.
 *
 * LOCAL / DEV ONLY: it needs SUPABASE_SERVICE_ROLE_KEY (from the
 * environment or .env.local, the verify-media-privacy recipe) — it is not
 * part of `npm run verify` and never runs in CI. `--offline <file>` runs
 * the same diff over a saved OpenAPI spec or a `{ table: [columns] }` map
 * (for tests and for a machine without the key).
 *
 *   npm run check:schema
 *   node scripts/schema-inventory.mjs --offline dump.json
 *   node scripts/schema-inventory.mjs --json        # the raw result
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { diff, formatReport, liveFromOpenApi, parseChain } from './schema-inventory-core.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const offline = flag('--offline');
const asJson = args.includes('--json');
const migrationsDir = flag('--migrations') ?? 'database/migrations';
const allowlistPath = flag('--allowlist') ?? 'database/provenance/allowlist.json';

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

async function loadLive() {
  if (offline) {
    const raw = JSON.parse(readFileSync(String(offline), 'utf8'));
    if (raw.definitions) return liveFromOpenApi(raw);
    return { tables: raw, rpcs: [] };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('schema-inventory: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --offline <file>).');
    process.exit(2);
  }
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
  if (!res.ok) {
    console.error(`schema-inventory: PostgREST answered ${res.status}`);
    process.exit(2);
  }
  return liveFromOpenApi(await res.json());
}

function loadChain() {
  const names = readdirSync(migrationsDir)
    .filter(n => /^\d{3}_.*\.sql$/.test(n))
    .sort();
  return names.map(name => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));
}

function loadAllowlist() {
  try {
    const raw = JSON.parse(readFileSync(allowlistPath, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.entries ?? []);
  } catch {
    return [];
  }
}

const live = await loadLive();
const owned = parseChain(loadChain());
const allowlist = loadAllowlist();
const result = diff(live.tables, owned, allowlist);
if (asJson) console.log(JSON.stringify({ ...result, rpcs: live.rpcs }, null, 2));
else console.log(formatReport(result, { liveTables: Object.keys(live.tables).length, ownedTables: owned.tables.size, rpcs: live.rpcs }));
process.exit(result.ok ? 0 : 1);
