#!/usr/bin/env node
/**
 * `npm run check:schema` — schema provenance against the LIVE project
 * (data foundation P1 — Sep 13 2026; the catalog facets — Sep 15 2026).
 *
 * Three facets, one verdict:
 *  • TABLES / COLUMNS — PostgREST's OpenAPI definitions (every table and
 *    column the service role can see — the anon key would miss the
 *    posture-A tables) against what the numbered chain CREATEs / ADDs
 *    (`schema-inventory-core.mjs`) — BOTH ways since Sep 16 2026: a live
 *    object the chain never named is drift, and so is a chain object the
 *    live database lacks (CHAIN-ONLY = "that migration has not run", by
 *    name). "NNN ran" means this command is OK — never a pasted grid.
 *  • POLICIES, FUNCTIONS, TRIGGERS and GRANTS — `public.provenance_inventory()` (migration
 *    195, service-role only) against the chain's last CREATE POLICY / CREATE
 *    FUNCTION for each object: a policy must be claimed with the same cmd /
 *    roles / permissiveness; a function's live md5(prosrc) must equal the
 *    md5 of the chain's dollar-quoted body, and SECURITY DEFINER / search_path
 *    must agree; a trigger is compared as a normalised tuple; a function's
 *    EXECUTE grantees must equal the set the chain simulates for it
 *    (`schema-inventory-catalog.mjs`). Until 195 has run, the RPC
 *    answers PGRST202 and these facets are SKIPPED with a notice — never an
 *    error.
 *  • THE LEDGER (migration 226, Round 2 — Sep 21 2026) — `schema_migrations`
 *    holds one row per numbered file that has run in THIS database (each
 *    file inserts its own row); every chain number must be in the ledger
 *    (NOT RUN, by name) and every ledger number must be a file (LEDGER-ONLY
 *    = a file the repo lacks). The pure comparison is `diffLedger` in
 *    `schema-inventory-ledger.mjs` (unit-tested). Until 226 has run the
 *    table answers PGRST205 and the facet is SKIPPED with a notice.
 * Both diff against database/provenance/allowlist.json (`kind` = column |
 * policy | function). Exit 1 on drift or a stale allowlist entry; 0 when
 * every live object is owned or documented.
 *
 * LOCAL / DEV ONLY: it needs SUPABASE_SERVICE_ROLE_KEY (from the
 * environment, or .env.local — STAGING since Round 2; `TARGET_ENV=prod`
 * reads .env.prod — see scripts/env-file.mjs) — it is not
 * part of `npm run verify` and never runs in CI.
 *
 *   npm run check:schema
 *   npm run check:schema -- --save-catalog          # also writes database/provenance/dumps/<date>-catalog.json
 *   node scripts/schema-inventory.mjs --offline openapi.json --catalog dumps/2026-09-15-catalog.json
 *   node scripts/schema-inventory.mjs --facet policies   # tables | policies | functions | triggers | grants | ledger
 *   node scripts/schema-inventory.mjs --json              # the raw result
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { TARGET_ENV, loadEnvFile } from './env-file.mjs';
import { join } from 'path';
import { diffCatalog, formatCatalogReport, liveFromCatalog, parseCatalogChain } from './schema-inventory-catalog.mjs';
import { diff, formatReport, liveFromOpenApi, parseChain } from './schema-inventory-core.mjs';
import { diffLedger, formatLedgerReport } from './schema-inventory-ledger.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const offline = flag('--offline');
const catalogPath = flag('--catalog');
const saveCatalog = args.includes('--save-catalog') ? flag('--save-catalog') : null;
const facet = flag('--facet');
const asJson = args.includes('--json');
const migrationsDir = flag('--migrations') ?? 'database/migrations';
const allowlistPath = flag('--allowlist') ?? 'database/provenance/allowlist.json';

if (facet && !['tables', 'policies', 'functions', 'triggers', 'grants', 'ledger'].includes(String(facet))) {
  console.error('schema-inventory: --facet takes tables | policies | functions | triggers | grants | ledger');
  process.exit(2);
}

const envFile = loadEnvFile(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
console.error(`check:schema: target ${TARGET_ENV}${envFile ? ` (${envFile})` : ' (environment only)'}`);

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('schema-inventory: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --offline <file> and --catalog <file>).');
    process.exit(2);
  }
  return { base: url.replace(/\/$/, ''), key };
}

async function loadLive() {
  if (offline) {
    const raw = JSON.parse(readFileSync(String(offline), 'utf8'));
    if (raw.definitions) return liveFromOpenApi(raw);
    return { tables: raw.tables ?? raw, rpcs: [] };
  }
  const { base, key } = credentials();
  const res = await fetch(`${base}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
  if (!res.ok) {
    console.error(`schema-inventory: PostgREST answered ${res.status}`);
    process.exit(2);
  }
  return liveFromOpenApi(await res.json());
}

/** The catalog RPC (migration 195). `null` = not available (PGRST202 before 195 runs). */
async function loadCatalog() {
  if (catalogPath && catalogPath !== true) return { raw: JSON.parse(readFileSync(String(catalogPath), 'utf8')), notice: null };
  if (offline) return { raw: null, notice: 'offline without --catalog — policy/function facets skipped' };
  const { base, key } = credentials();
  const res = await fetch(`${base}/rest/v1/rpc/provenance_inventory`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  });
  if (res.status === 404) {
    let code = null;
    try {
      code = (await res.json()).code ?? null;
    } catch {
      /* not json */
    }
    if (code === 'PGRST202' || code === null) return { raw: null, notice: 'provenance_inventory RPC not found — run migration 195; policy/function facets skipped' };
  }
  if (!res.ok) {
    console.error(`schema-inventory: provenance_inventory answered ${res.status}`);
    process.exit(2);
  }
  return { raw: await res.json(), notice: null };
}

/** The ledger (migration 226). `null` = not live yet (PGRST205 before 226 runs). */
async function loadLedger() {
  if (offline) return { rows: null, notice: 'offline — the ledger facet is skipped' };
  const { base, key } = credentials();
  const res = await fetch(`${base}/rest/v1/schema_migrations?select=number,name,applied_at,applied_by&order=number.asc&limit=10000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (res.status === 404 || res.status === 406) {
    let code = null;
    try {
      code = (await res.json()).code ?? null;
    } catch {
      /* not json */
    }
    if (code === 'PGRST205' || code === '42P01' || code === null) return { rows: null, notice: 'schema_migrations not found — run migration 226; the ledger facet is skipped' };
  }
  if (!res.ok) {
    console.error(`schema-inventory: schema_migrations answered ${res.status}`);
    process.exit(2);
  }
  return { rows: await res.json(), notice: null };
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

const chainFiles = loadChain();
const allowlist = loadAllowlist();
const columnAllow = allowlist.filter(e => !e.kind || e.kind === 'column');
const catalogAllow = allowlist.filter(e => ['policy', 'function', 'trigger', 'grant'].includes(e.kind));

const wantTables = !facet || facet === 'tables';
const wantCatalog = !facet || ['policies', 'functions', 'triggers', 'grants'].includes(String(facet));

let tablesResult = null;
let live = null;
if (wantTables) {
  live = await loadLive();
  tablesResult = diff(live.tables, parseChain(chainFiles), columnAllow);
}

let catalogResult = null;
let catalogNotice = null;
if (wantCatalog) {
  const { raw, notice } = await loadCatalog();
  catalogNotice = notice;
  if (raw) {
    if (saveCatalog) {
      // The default name is today's date; a saved catalog is EVIDENCE a
      // baseline cites, so never overwrite one — take the next free suffix.
      let target = saveCatalog === true ? `database/provenance/dumps/${new Date().toISOString().slice(0, 10)}-catalog.json` : String(saveCatalog);
      if (saveCatalog === true) {
        for (let n = 2; existsSync(target); n++) target = target.replace(/(?:-\d+)?-catalog\.json$/, `-${n}-catalog.json`);
      }
      // The catalog is a snapshot of ONE database at ONE ledger head; the
      // test that diffs the chain against it ignores claims from migrations
      // newer than that head (a trigger added by 231 is not stale against a
      // catalog saved at 230 — it is newer).
      const ledgerRows = await loadLedger().then(l => l.rows).catch(() => null);
      if (ledgerRows) raw.meta = { ...(raw.meta ?? {}), ledgerHead: Math.max(0, ...ledgerRows.map(r => Number(r.number))) };
      const text = JSON.stringify(raw, null, 1) + '\n';
      writeFileSync(target, text);
      console.error(`schema-inventory: catalog saved to ${target} (${text.length} bytes; ${raw.policies?.length ?? 0} policies, ${raw.functions?.length ?? 0} functions, ${raw.triggers?.length ?? 0} triggers)`);
    }
    const catalogChain = parseCatalogChain(chainFiles);
    catalogResult = diffCatalog(liveFromCatalog(raw), catalogChain, catalogAllow);
    if (facet && facet !== 'tables') {
      // One facet: blank the other classes and judge only this one's.
      const classes = {
        policies: ['unownedPolicies', 'stalePolicyClaims', 'policyMismatch'],
        functions: ['unownedFunctions', 'bodyDrift', 'configDrift'],
        triggers: ['unownedTriggers', 'staleTriggerClaims', 'triggerDrift'],
        grants: ['grantDrift'],
      };
      const kindOf = { policies: 'policy', functions: 'function', triggers: 'trigger', grants: 'grant' };
      const keep = new Set(classes[facet]);
      const blanked = { ...catalogResult, whitespaceOnly: [], chainOnlyFunctions: [], secdefPublic: facet === 'grants' ? catalogResult.secdefPublic : [] };
      for (const cls of Object.values(classes).flat()) if (!keep.has(cls)) blanked[cls] = [];
      blanked.staleAllowlist = catalogResult.staleAllowlist.filter(e => e.kind === kindOf[facet]);
      blanked.ok = [...keep].every(cls => !blanked[cls].length) && !blanked.staleAllowlist.length;
      catalogResult = blanked;
    }
  }
}

let ledgerResult = null;
let ledgerNotice = null;
if (!facet || facet === 'ledger') {
  const { rows, notice } = await loadLedger();
  ledgerNotice = notice;
  if (rows) ledgerResult = diffLedger(chainFiles.map(f => f.name), rows);
}

const ok = (tablesResult ? tablesResult.ok : true) && (catalogResult ? catalogResult.ok : true) && (ledgerResult ? ledgerResult.ok : true);

if (asJson) {
  console.log(JSON.stringify({ ...(tablesResult ?? {}), rpcs: live?.rpcs ?? [], catalog: catalogResult, catalogNotice, ledger: ledgerResult, ledgerNotice, ok }, null, 2));
} else {
  const out = [];
  if (tablesResult) {
    out.push(formatReport(tablesResult, { liveTables: Object.keys(live.tables).length, ownedTables: parseChain(chainFiles).tables.size }));
    if (live.rpcs?.length) out.push(`Live RPCs: ${live.rpcs.length}${catalogResult ? ' (function provenance below)' : ''}`);
  }
  if (catalogNotice) out.push(`\nschema-inventory: ${catalogNotice}`);
  if (catalogResult) out.push('\n' + formatCatalogReport(catalogResult));
  if (ledgerNotice) out.push(`\nschema-inventory: ${ledgerNotice}`);
  if (ledgerResult) out.push('\n' + formatLedgerReport(ledgerResult));
  console.log(out.join('\n'));
}
process.exit(ok ? 0 : 1);
