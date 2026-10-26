#!/usr/bin/env node
/**
 * `node scripts/search-capture.mjs <out.json>` — the nine search_all result lists (entity_type, entity_id,
 * match_rank, distance) through scripts/staging-sql.mjs (STAGING ONLY). Capture before a search
 * migration and after; `node scripts/search-capture.mjs --diff before.json after.json` prints the
 * differences per query. Written Oct 25 2026 for 274 (nine lists identical); 279 uses it again.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === "--diff") { diff(args[1], args[2]); process.exit(0); }
const out = args[0];
const QUERIES = {
  common_prefix: "public.search_all('seed', NULL, 20, '{}'::uuid[], true)",
  two_letters: "public.search_all('se', NULL, 20, '{}'::uuid[], true)",
  rare_term: "public.search_all('seed-0042', NULL, 20, '{}'::uuid[], true)",
  edge: "public.search_all('edge', NULL, 20, '{}'::uuid[], true)",
  ottawa: "public.search_all('ottawa', NULL, 20, '{}'::uuid[], true)",
  kanata_course: "public.search_all('kanata golf', ARRAY['course'], 15, '{}'::uuid[], true)",
  near_browse_empty_q: "public.search_all('', NULL, 20, '{}'::uuid[], true, NULL, NULL, 45.42, -75.69, 50)",
  athletes_widen_100: "public.search_all('seed', ARRAY['athlete'], 100, '{}'::uuid[], true)",
  accent_and_case: "public.search_all('SEÉD', NULL, 20, '{}'::uuid[], true)",
};
const result = {};
for (const [name, call] of Object.entries(QUERIES)) {
  const sql = `SELECT json_agg(json_build_object('t', entity_type, 'id', entity_id, 'r', match_rank, 'd', round(distance_km::numeric, 3)) ORDER BY ord) AS rows, count(*) AS n FROM (SELECT s.*, row_number() OVER () AS ord FROM ${call} AS s) q`;
  const raw = execFileSync('node', ['scripts/staging-sql.mjs', '-e', sql], { encoding: 'utf8', timeout: 120000 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
  result[name] = { n: parsed[0].n, rows: parsed[0].rows ?? [] };
  console.log(name.padEnd(22), parsed[0].n, 'rows');
}
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log('saved', out);

function diff(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8')), b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  let identical = 0;
  for (const name of Object.keys(a)) {
    const ra = a[name].rows.map(r => `${r.t}:${r.id}:${r.r}`), rb = (b[name]?.rows ?? []).map(r => `${r.t}:${r.id}:${r.r}`);
    if (ra.join('|') === rb.join('|')) { identical++; console.log(`${name.padEnd(22)} identical (${ra.length})`); continue; }
    const sa = new Set(ra), sb = new Set(rb);
    const dropped = ra.filter(x => !sb.has(x)), added = rb.filter(x => !sa.has(x));
    const reordered = dropped.length === 0 && added.length === 0;
    console.log(`${name.padEnd(22)} DIFFERS: before ${ra.length} after ${rb.length}; dropped ${dropped.length}, added ${added.length}${reordered ? ', same set in a different order' : ''}`);
    for (const d of dropped.slice(0, 5)) console.log(`    - ${d}`);
    for (const d of added.slice(0, 5)) console.log(`    + ${d}`);
  }
  console.log(`\n${identical} of ${Object.keys(a).length} lists identical`);
}
