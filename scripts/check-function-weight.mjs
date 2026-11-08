#!/usr/bin/env node
// Function-weight gate (performance program, Nov 7 2026) — runs after
// `next build` inside `npm run verify` (`npm run check:weight`). Reads every
// route's trace (`.next/server/app/**/{page,route}.js.nft.json`), sums the
// bytes a cold function has to unpack, attributes them to packages, prints
// the heaviest routes, and FAILS when a non-exempt route is over the budget.
// The rules and the exemptions live in scripts/function-weight-rules.mjs
// (pinned by src/lib/__tests__/function-weight-rules.test.ts).
//
//   node scripts/check-function-weight.mjs [--budget <MB>] [--top <n>] [--json] [--report <file.md>]
//
// A number here is the LOCAL trace (this machine's sharp binaries, not
// linux's); compare runs on the same machine. The shape — which packages a
// route drags in — is identical on Vercel.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  DEFAULT_FUNCTION_BUDGET_BYTES,
  formatReport,
  judgeRoutes,
  mb,
  routeIdFromNftPath,
  summarizeRoute,
} from './function-weight-rules.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const budget = args.includes('--budget') ? Number(flag('--budget')) * 1024 * 1024 : DEFAULT_FUNCTION_BUDGET_BYTES;
const topN = Number(flag('--top', 10));
const asJson = args.includes('--json');
const reportFile = flag('--report', null);

const root = process.cwd();
const appDir = join(root, '.next', 'server', 'app');

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
    else if (e.name.endsWith('.nft.json')) out.push(p);
  }
  return out;
}

const nfts = walk(appDir);
if (nfts.length === 0) {
  console.error(`check-function-weight: no traces under ${relative(root, appDir)} — run \`next build\` first`);
  process.exit(2);
}

const sizeCache = new Map();
const sizeOf = (p) => {
  if (sizeCache.has(p)) return sizeCache.get(p);
  let s = 0;
  try {
    s = statSync(p).size;
  } catch {
    s = 0;
  }
  sizeCache.set(p, s);
  return s;
};

const rows = [];
for (const nft of nfts) {
  const route = routeIdFromNftPath(relative(root, nft));
  if (!route) continue;
  let trace;
  try {
    trace = JSON.parse(readFileSync(nft, 'utf8'));
  } catch {
    continue;
  }
  const base = dirname(nft);
  const files = (trace.files ?? []).map((f) => {
    const abs = resolve(base, f);
    return { path: relative(root, abs), bytes: sizeOf(abs) };
  });
  const summary = summarizeRoute(files);
  rows.push({ route, total: summary.total, files: summary.files, buckets: summary.buckets });
}

const verdict = judgeRoutes(rows, budget);
const report = formatReport(rows, { topN, budget });

if (asJson) {
  console.log(JSON.stringify({ budget, rows: rows.sort((a, b) => b.total - a.total), failures: verdict.failures.map((r) => r.route) }, null, 2));
} else {
  console.log(report);
}
if (reportFile) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const md = [
    `# Function weight — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Budget ${mb(budget)} per route; ${rows.length} routes; ${verdict.failures.length} over, ${verdict.exempted.length} exempt over.`,
    '',
    '| route | traced | heaviest buckets |',
    '| --- | ---: | --- |',
    ...sorted.slice(0, 40).map((r) => `| \`${r.route}\` | ${mb(r.total)} | ${r.buckets.map((b) => `${b.name} ${mb(b.bytes)}`).join(', ')} |`),
    '',
  ].join('\n');
  writeFileSync(reportFile, md);
  console.log(`check-function-weight: wrote ${reportFile}`);
}

if (verdict.failures.length > 0) {
  console.error(`check-function-weight: ${verdict.failures.length} route(s) over ${mb(budget)} and not exempt:`);
  for (const r of verdict.failures.sort((a, b) => b.total - a.total)) console.error(`  · ${mb(r.total)}  ${r.route}`);
  console.error('  Fix the import that drags the bytes in (see the buckets above) or exempt the route in scripts/function-weight-rules.mjs with a reason.');
  process.exit(1);
}
console.log(`check-function-weight: every non-exempt route traces within ${mb(budget)}`);
