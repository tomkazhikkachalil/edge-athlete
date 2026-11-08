#!/usr/bin/env node
// Bundle-weight gate (performance program, Nov 7 2026) — runs after
// `next build` inside `npm run verify` (`npm run check:weight`). Gzips every
// client chunk once, reports the code every page loads (build-manifest
// rootMainFiles), each route's synchronous chunks (the entry chunks of its own
// layout → page tree, from its client-reference manifest) and the largest chunks, and FAILS when the root or a route is
// over its gzipped budget. Rules in scripts/bundle-weight-rules.mjs (pinned
// by src/lib/__tests__/bundle-weight-rules.test.ts).
//
//   node scripts/check-bundle-weight.mjs [--json] [--report <file.md>]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  formatBundleReport,
  judgeBundle,
  kb,
  parseReferenceManifest,
  routeIdFromReferenceManifestPath,
  entryChunksOf,
} from './bundle-weight-rules.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const reportFile = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;

const root = process.cwd();
const next = join(root, '.next');
let buildManifest;
try {
  buildManifest = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8'));
} catch {
  console.error('check-bundle-weight: .next/build-manifest.json not found — run `next build` first');
  process.exit(2);
}

const gzCache = new Map();
const measureChunk = (relPath) => {
  if (gzCache.has(relPath)) return gzCache.get(relPath);
  let raw = 0;
  let gz = 0;
  try {
    const buf = readFileSync(join(next, relPath));
    raw = buf.length;
    gz = gzipSync(buf, { level: 6 }).length;
  } catch {
    /* a chunk named but absent counts as 0 */
  }
  const m = { path: relPath, raw, gz };
  gzCache.set(relPath, m);
  return m;
};

const rootFiles = (buildManifest.rootMainFiles ?? []).filter((f) => f.endsWith('.js'));
const rootSet = new Set(rootFiles);
const rootGz = rootFiles.reduce((s, f) => s + measureChunk(f).gz, 0);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'page_client-reference-manifest.js') out.push(p);
  }
  return out;
}

const routes = [];
for (const file of walk(join(next, 'server', 'app'))) {
  const route = routeIdFromReferenceManifestPath(relative(root, file));
  if (!route) continue;
  const manifest = parseReferenceManifest(readFileSync(file, 'utf8'));
  if (!manifest) continue;
  const chunks = new Set([...rootFiles, ...entryChunksOf(manifest)]);
  const gz = [...chunks].reduce((s, c) => s + measureChunk(c).gz, 0);
  routes.push({ route, gz, files: chunks.size });
}

// Every chunk on disk, for the "largest" list (lazy ones included).
const chunkDir = join(next, 'static', 'chunks');
const allChunks = readdirSync(chunkDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ ...measureChunk(`static/chunks/${f}`), root: rootSet.has(`static/chunks/${f}`) }));
const css = readdirSync(chunkDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => measureChunk(`static/chunks/${f}`));

const measure = { rootGz, rootFiles: rootFiles.length, routes, chunks: allChunks, css };
const failures = judgeBundle(measure);

if (asJson) {
  console.log(JSON.stringify({ rootGz, routes: routes.sort((a, b) => b.gz - a.gz), chunks: allChunks.sort((a, b) => b.gz - a.gz).slice(0, 20), css, failures }, null, 2));
} else {
  console.log(formatBundleReport(measure));
}
if (reportFile) {
  const md = [
    `# Bundle weight — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Root (every page): **${kb(rootGz)} gz** over ${rootFiles.length} files.`,
    '',
    '| route | sync gz | files |',
    '| --- | ---: | ---: |',
    ...[...routes].sort((a, b) => b.gz - a.gz).slice(0, 30).map((r) => `| \`${r.route}\` | ${kb(r.gz)} | ${r.files} |`),
    '',
    '| chunk | gz | raw |',
    '| --- | ---: | ---: |',
    ...[...allChunks].sort((a, b) => b.gz - a.gz).slice(0, 15).map((c) => `| \`${c.path.split('/').pop()}\`${c.root ? ' (root)' : ''} | ${kb(c.gz)} | ${kb(c.raw)} |`),
    '',
  ].join('\n');
  writeFileSync(reportFile, md);
  console.log(`check-bundle-weight: wrote ${reportFile}`);
}
if (failures.length > 0) {
  console.error(`check-bundle-weight: ${failures.length} budget(s) exceeded:`);
  for (const f of failures) console.error(`  · ${f.what}: ${kb(f.gz)} gz > ${kb(f.budget)}`);
  process.exit(1);
}
console.log('check-bundle-weight: root and every route within their gzipped budgets');
