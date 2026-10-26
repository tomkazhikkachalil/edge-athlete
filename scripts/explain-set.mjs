#!/usr/bin/env node
/**
 * `node scripts/explain-set.mjs [--template database/provenance/explain/template.json] [--out database/provenance/explain/YYYY-MM-DD] [--subject seed-subject@staging.invalid]`
 *
 * The audit's EXPLAIN set (docs/SCALE_AUDIT.md §2.1), re-runnable: every query
 * in the template runs through scripts/staging-sql.mjs (STAGING ONLY — that
 * script refuses the production ref) as `EXPLAIN (ANALYZE, BUFFERS, FORMAT
 * JSON)`; `__SUBJECT__` is the seed subject's profile id (looked up by email).
 * One JSON plan per query lands in `--out`, plus summary.json and README.md
 * (the table the audit quotes). Times are shape, not capacity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const tplPath = opt('--template', 'database/provenance/explain/template.json');
const outDir = opt('--out', path.join('database', 'provenance', 'explain', new Date().toISOString().slice(0, 10)));
const subjectEmail = opt('--subject', 'seed-subject@staging.invalid');

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
if (!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL.includes('htwhmdoiszhhmwuflgci')) { console.error('explain-set: STAGING ONLY'); process.exit(2); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: subject } = await admin.from('profiles').select('id').eq('email', subjectEmail).maybeSingle();
if (!subject) { console.error(`explain-set: no profile for ${subjectEmail}`); process.exit(1); }

const sizes = {};
for (const t of ['profiles', 'posts', 'follows', 'notifications', 'search_documents', 'messages']) {
  const { count } = await admin.from(t).select('*', { count: 'exact', head: true });
  sizes[t] = count;
}

const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
const walk = (n, acc) => { acc.push(n); for (const c of n.Plans ?? []) walk(c, acc); return acc; };
for (const [name, sqlT] of Object.entries(tpl)) {
  const sql = sqlT.replaceAll('__SUBJECT__', subject.id);
  let raw;
  try {
    raw = execFileSync('node', ['scripts/staging-sql.mjs', '-e', sql], { encoding: 'utf8', timeout: 180_000 });
  } catch (e) {
    rows.push({ name, error: String(e.stdout || e.message).slice(0, 300) }); continue;
  }
  let parsed;
  try { parsed = JSON.parse(raw.slice(raw.indexOf('['))); } catch { rows.push({ name, error: 'unparsable: ' + raw.slice(0, 200) }); continue; }
  const plan = parsed?.[0]?.['QUERY PLAN']?.[0] ?? parsed?.[0]?.['query plan']?.[0] ?? parsed?.[0];
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(plan, null, 1));
  const root = plan?.Plan ?? {};
  const nodes = walk(root, []);
  const seq = nodes.filter(n => n['Node Type'] === 'Seq Scan').map(n => `${n['Relation Name']}(${n['Actual Rows']}r)`);
  const idx = nodes.filter(n => /Index/.test(n['Node Type'] || '')).map(n => n['Index Name']).filter(Boolean);
  const r = { name, exec_ms: plan?.['Execution Time'], plan_ms: plan?.['Planning Time'], rows: root['Actual Rows'], shared_hit: root['Shared Hit Blocks'], shared_read: root['Shared Read Blocks'], top: root['Node Type'], seq: seq.join(' '), idx: [...new Set(idx)].join(' ') };
  rows.push(r);
  console.log(`${name.padEnd(36)} ${String(r.exec_ms?.toFixed(2)).padStart(9)} ms  rows ${String(r.rows).padStart(5)}  hit ${String(r.shared_hit).padStart(6)}  ${r.seq ? 'SEQ ' + r.seq : ''}`);
  await new Promise(res => setTimeout(res, 400));
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ sizes, rows }, null, 1));
const md = [`# EXPLAIN (ANALYZE, BUFFERS) — staging (Micro), ${new Date().toISOString().slice(0, 10)}`, '',
  `Volume: ${Object.entries(sizes).map(([k, v]) => `${v?.toLocaleString('en-US')} ${k}`).join(', ')}. Run with \`scripts/explain-set.mjs\` through \`scripts/staging-sql.mjs\`; the queries (\`template.json\`) stand in for the hot routes of docs/SCALE_AUDIT.md §2.1. Times are shape, not capacity.`, '',
  '| query | exec ms | plan ms | rows | shared hit | top node | seq scans | indexes |', '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => r.error ? `| ${r.name} | ERROR ${r.error.slice(0, 80)} | | | | | | |` : `| ${r.name} | ${r.exec_ms?.toFixed(2)} | ${r.plan_ms?.toFixed(2)} | ${r.rows} | ${r.shared_hit} | ${r.top} | ${r.seq || '-'} | ${r.idx || '-'} |`), ''].join('\n');
fs.writeFileSync(path.join(outDir, 'README.md'), md);
console.log(`\nexplain-set: ${rows.length} plans → ${outDir}`);
