#!/usr/bin/env node
/**
 * `node scripts/chain-replay-scan.mjs` — would the numbered chain replay on a
 * BLANK database, in order? (Round 2 — the rebuildable chain, Sep 2026.)
 *
 * Read-only, no credentials. Two hazard classes:
 *  • REFERENCED BEFORE CREATED — a table the chain creates (often in the
 *    Sep 14 baselines 190–193, which recorded pre-chain tables verbatim) is
 *    named by an earlier file: ALTER / INSERT / POLICY / INDEX / REFERENCES.
 *    On prod that file ran against a table that already existed; on a blank
 *    database it errors and the replay stops there.
 *  • PLATFORM STATE — extensions, storage buckets, auth triggers, pg_cron
 *    jobs: things a fresh Supabase project has or lacks that no migration
 *    can assume. Listed so the rebuild preamble names them.
 *
 * `--json` for the raw result. Exit 0 always — this is a report, the
 * verification is running the file against a fresh project (staging).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ident, parseChain, splitStatements, stripComments, stripDollarBodies } from './schema-inventory-core.mjs';

const dir = 'database/migrations';
const files = readdirSync(dir).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort().map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
parseChain(files); // keeps the parser honest against every file (it throws on a shape it cannot read)

// The creator of every chain-owned table: the FIRST `create table` naming it.
const creator = new Map();
const cleanedOf = new Map();
for (const f of files) {
  const cleaned = stripDollarBodies(stripComments(f.sql));
  cleanedOf.set(f.name, cleaned);
  for (const st of splitStatements(cleaned)) {
    const s = st.replace(/\s+/g, ' ');
    const m = /^(?:do |begin |if .*? then )*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/i.exec(s);
    if (m) {
      const t = ident(m[1]);
      if (!creator.has(t)) creator.set(t, f.name);
    }
  }
}

// The first file that NAMES each table (as a whole identifier), before its creator.
const early = [];
for (const [table, created] of creator) {
  const re = new RegExp(`(?<![a-z0-9_."])(?:public\\.)?"?${table}"?(?![a-z0-9_"])`, 'i');
  for (const f of files) {
    if (f.name === created) break;
    if (re.test(cleanedOf.get(f.name))) {
      early.push({ table, created, firstNamed: f.name });
      break;
    }
  }
}
early.sort((a, b) => a.firstNamed.localeCompare(b.firstNamed) || a.table.localeCompare(b.table));

// Platform state the chain assumes.
const platform = { extensions: new Map(), storageBuckets: new Map(), authObjects: new Map(), cronJobs: new Map(), otherSchemas: new Map() };
const note = (map, key, file) => { if (!map.has(key)) map.set(key, file); };
for (const f of files) {
  const c = cleanedOf.get(f.name);
  for (const m of c.matchAll(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_-]+)"?/gi)) note(platform.extensions, m[1].toLowerCase(), f.name);
  for (const m of c.matchAll(/storage\.buckets[^;]*?\(\s*'([a-z0-9-]+)'/gi)) note(platform.storageBuckets, m[1], f.name);
  for (const m of c.matchAll(/\bon\s+auth\.([a-z_]+)/gi)) note(platform.authObjects, `auth.${m[1]}`, f.name);
  for (const m of c.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/gi)) note(platform.cronJobs, m[1], f.name);
  for (const m of c.matchAll(/\b(?:create|alter)\s+(?:table|function|policy|trigger|index)\s+(?:if\s+not\s+exists\s+)?(?:or\s+replace\s+)?(storage|auth|cron|net|vault|extensions|realtime)\./gi)) note(platform.otherSchemas, m[1], f.name);
}

const result = {
  files: files.length,
  tablesCreatedByChain: creator.size,
  referencedBeforeCreated: early,
  platform: Object.fromEntries(Object.entries(platform).map(([k, v]) => [k, [...v.entries()].map(([key, file]) => ({ [k === 'extensions' ? 'extension' : 'name']: key, firstFile: file }))])),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`chain-replay-scan: ${files.length} files; ${creator.size} tables created by the chain`);
  console.log(`\nREFERENCED BEFORE CREATED (${early.length}) — the replay would stop at the first-named file:`);
  for (const e of early) console.log(`  ${e.table.padEnd(34)} named in ${e.firstNamed}  created in ${e.created}`);
  for (const [k, v] of Object.entries(result.platform)) {
    console.log(`\n${k} (${v.length}):`);
    for (const row of v) console.log(`  ${Object.values(row)[0].padEnd(34)} ${row.firstFile}`);
  }
}
