#!/usr/bin/env node
/**
 * `node scripts/vercel-preview-env.mjs` — point Vercel's PREVIEW and
 * DEVELOPMENT environments at the STAGING Supabase project (Round 2, Sep
 * 2026), leaving PRODUCTION's values untouched.
 *
 * What it does, idempotently, through Vercel's REST API with the CLI's
 * own login (~/Library/Application Support/com.vercel.cli/auth.json):
 *   1. For NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY:
 *      an existing entry that spans several environments is NARROWED to
 *      Production only (a PATCH of its `target`; the value is not sent).
 *   2. A Preview + Development entry is created (or its value updated)
 *      with the STAGING value read from .env.local.
 *   3. MEDIA_PROXY_SECRET and ANALYTICS_SALT get a fresh random value for
 *      Preview + Development when none exists there (prod's are never
 *      copied).
 *   4. The Production-only feature FLAGS are mirrored to Preview +
 *      Development so a preview is the same app as prod.
 * It refuses to run when .env.local points at the production project, and
 * never prints a value. Run it from the repo root; `--dry-run` only reports.
 */
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

const dry = process.argv.includes('--dry-run');
const PROD_REF = 'htwhmdoiszhhmwuflgci';
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1];
if (!ref || ref === PROD_REF) {
  console.error(`vercel-preview-env: REFUSED — .env.local must point at STAGING (it points at ${ref ?? 'nothing'}).`);
  process.exit(2);
}

const auth = JSON.parse(readFileSync(join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'), 'utf8'));
const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
const api = async (path, method = 'GET', data) => {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.vercel.com${path}${sep}teamId=${project.orgId}`, {
    method,
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.error?.message ?? ''}`);
  return json;
};

const wanted = {
  NEXT_PUBLIC_SUPABASE_URL: { value: env.NEXT_PUBLIC_SUPABASE_URL, type: 'plain' },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: { value: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, type: 'plain' },
  SUPABASE_SERVICE_ROLE_KEY: { value: env.SUPABASE_SERVICE_ROLE_KEY, type: 'sensitive' },
};
for (const [k, v] of Object.entries(wanted)) if (!v.value) { console.error(`vercel-preview-env: ${k} missing from .env.local`); process.exit(2); }

const { envs } = await api(`/v9/projects/${project.projectId}/env`);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const log = s => console.log(`${dry ? '[dry-run] ' : ''}${s}`);

for (const [key, { value, type }] of Object.entries(wanted)) {
  const rows = envs.filter(e => e.key === key);
  for (const row of rows) {
    if (row.target.includes('production') && row.target.length > 1) {
      log(`${key}: narrowing the existing entry ${row.id} from [${row.target}] to [production]`);
      if (!dry) await api(`/v9/projects/${project.projectId}/env/${row.id}`, 'PATCH', { target: ['production'] });
    }
  }
  const pre = rows.find(r => !r.target.includes('production') && same(r.target, ['preview', 'development']));
  if (pre) {
    log(`${key}: updating the Preview+Development entry ${pre.id} with the staging value`);
    if (!dry) await api(`/v9/projects/${project.projectId}/env/${pre.id}`, 'PATCH', { value });
  } else {
    log(`${key}: creating a Preview+Development entry with the staging value`);
    if (!dry) await api(`/v10/projects/${project.projectId}/env`, 'POST', { key, value, type, target: ['preview', 'development'] });
  }
}
for (const key of ['MEDIA_PROXY_SECRET', 'ANALYTICS_SALT']) {
  if (envs.some(e => e.key === key && e.target.includes('preview'))) { log(`${key}: Preview entry already present`); continue; }
  log(`${key}: creating a Preview+Development entry with a fresh random value`);
  if (!dry) await api(`/v10/projects/${project.projectId}/env`, 'POST', { key, value: randomBytes(32).toString('hex'), type: 'sensitive', target: ['preview', 'development'] });
}

// Feature FLAGS that exist for Production only (a preview built without them
// runs a different app — the guardian routes answered 404 on the first
// preview probe). Mirrored to Preview + Development with the SAME value;
// flags only, never a secret. A NEXT_PUBLIC_* flag is inlined at build time.
// Every flag is ON in production (guardian profiles launched Aug 19 2026,
// the chat dock Jul 28, the roster guardian gate and the public org sites
// Sep 2026). Production's entries are marked Sensitive, so neither the API
// nor `vercel env pull` can read them ("[SENSITIVE]" is the pull's
// placeholder — the first mirror copied that literal, and the preview's
// guardian routes stayed 404): the values are stated here, not read.
const FLAGS = { NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES: '1', NEXT_PUBLIC_FEATURE_ROSTER_GUARDIAN_GATE: '1', NEXT_PUBLIC_FEATURE_CHAT_DOCK: '1', PUBLIC_ORG_SITES: '1' };
for (const [key, value] of Object.entries(FLAGS)) {
  const pre = envs.find(e => e.key === key && e.target.includes('preview'));
  if (pre) {
    const current = await api(`/v1/projects/${project.projectId}/env/${pre.id}`);
    if (current.value === value) { log(`${key}: Preview entry already ${value}`); continue; }
    log(`${key}: setting the Preview+Development entry to ${value}`);
    if (!dry) await api(`/v9/projects/${project.projectId}/env/${pre.id}`, 'PATCH', { value, type: 'plain' });
    continue;
  }
  log(`${key}: creating a Preview+Development entry = ${value}`);
  if (!dry) await api(`/v10/projects/${project.projectId}/env`, 'POST', { key, value, type: 'plain', target: ['preview', 'development'] });
}

const after = (await api(`/v9/projects/${project.projectId}/env`)).envs;
console.log('\nResult:');
for (const e of after.filter(e => Object.keys(wanted).includes(e.key) || ['MEDIA_PROXY_SECRET', 'ANALYTICS_SALT', ...Object.keys(FLAGS)].includes(e.key)).sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`  ${e.key.padEnd(30)} [${[...e.target].sort().join(', ')}]`);
}
console.log('\nNext: redeploy is NOT needed for previews (each new preview build reads the current values).');
