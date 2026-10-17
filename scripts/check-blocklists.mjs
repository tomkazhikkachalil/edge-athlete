#!/usr/bin/env node
// ── Would Brave Shields block us? (every-browser round, Oct 16 2026) ────────
// `npm run check:blocklists`. Every first-party URL the app requests, and
// every class, id and data attribute its UI renders, run through Brave's
// default lists (scripts/brave-lists.mjs) with the same engine the
// `brave-android` Playwright project uses. A match is a feature Brave users
// silently lose — a request that never leaves the phone, a card that never
// shows — so it fails here, by name, with the rule that matched.
//
// URLs come from two places: every route folder under src/app/api (a
// `[param]` becomes a sample id) and every '/api/…' or '/o/…' literal in
// src/ (template `${…}` parts become a sample value), which keeps the query
// strings a rule like `/stats?` keys on. Needs the network once a week (the
// list cache); a maintenance check, not CI.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FiltersEngine, Request } from '@ghostery/adblocker';
import { braveListsText } from './brave-lists.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://edgeathlete.ca';
const SAMPLE = 'a1b2c3d4';

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      await walk(p, out);
    } else out.push(p);
  }
  return out;
}

const sample = s => s.replace(/\$\{[^}]*\}/g, SAMPLE).replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, SAMPLE);

async function collectUrls() {
  const urls = new Map(); // url → where it came from
  const apiDir = path.join(ROOT, 'src', 'app', 'api');
  for (const f of await walk(apiDir)) {
    if (!/\/route\.ts$/.test(f)) continue;
    const rel = path.relative(path.join(ROOT, 'src', 'app'), path.dirname(f));
    urls.set('/' + sample(rel.split(path.sep).join('/')), path.relative(ROOT, f));
  }
  const files = (await walk(path.join(ROOT, 'src'))).filter(f => /\.(ts|tsx)$/.test(f));
  const lit = /['"`](\/(?:api|o)\/[^'"`\s]*)['"`]/g;
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const m of text.matchAll(lit)) {
      const u = sample(m[1]);
      if (!urls.has(u)) urls.set(u, path.relative(ROOT, f));
    }
  }
  for (const u of ['/sw.js', '/offline.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon.ico', '/_next/static/immutable/chunks/app-a1b2c3.js', '/_next/image?url=%2Flogo-mark.png&w=96&q=75', '/api/relay?o=4511793217863680&p=4511793223106560'])
    urls.set(u, 'public / build');
  return urls;
}

const typeOf = u =>
  /^\/(o|api\/media)\//.test(u) || /\.(png|ico)$/.test(u) || u.startsWith('/_next/image') ? 'image'
  : u.endsWith('.js') ? 'script'
  : u.endsWith('.webmanifest') ? 'manifest'
  : 'xhr';

async function collectHooks() {
  const classes = new Set();
  const ids = new Set();
  const attrs = new Set();
  const attrValues = new Map();
  const files = (await walk(path.join(ROOT, 'src'))).filter(f => /\.tsx$/.test(f));
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const m of text.matchAll(/className=\{?[`'"]([^`'"]+)[`'"]/g)) for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z_-][\w-]*$/.test(c)) classes.add(c);
    for (const m of text.matchAll(/\bid=["']([\w-]+)["']/g)) ids.add(m[1]);
    for (const m of text.matchAll(/\b(data-[a-z0-9-]+)=(?:["']([^"']*)["'])?/g)) {
      attrs.add(m[1]);
      if (m[2] !== undefined) attrValues.set(m[1], (attrValues.get(m[1]) ?? new Set()).add(m[2]));
    }
    for (const m of text.matchAll(/\btestId=["']([^"']+)["']/g)) attrValues.set('data-testid', (attrValues.get('data-testid') ?? new Set()).add(m[1]));
  }
  return { classes: [...classes], ids: [...ids], attrs, attrValues };
}

const engine = FiltersEngine.parse(await braveListsText(), { loadCosmeticFilters: true, loadNetworkFilters: true });
// Controls: the engine must catch what Brave catches, or a green run means nothing.
const controlBlocked = engine.match(Request.fromRawDetails({ url: ORIGIN + '/analytics/pageview', sourceUrl: ORIGIN + '/feed', type: 'xhr' })).match
  && engine.match(Request.fromRawDetails({ url: 'https://o1.ingest.sentry.io/api/1/envelope/', sourceUrl: ORIGIN + '/feed', type: 'xhr' })).match;
const controlHidden = /ad-sponsors/.test(engine.getCosmeticsFilters({ url: ORIGIN + '/feed', hostname: 'edgeathlete.ca', domain: 'edgeathlete.ca', ids: ['ad-sponsors'], getBaseRules: false, getRulesFromHostname: false, getRulesFromDOM: true }).styles || '');
if (!controlBlocked || !controlHidden) {
  console.error(`check-blocklists: the engine failed its controls (blocked=${!!controlBlocked}, hidden=${controlHidden}) — the lists did not load`);
  process.exit(2);
}
const problems = [];

const urls = await collectUrls();
for (const [u, from] of urls) {
  const req = Request.fromRawDetails({ url: ORIGIN + u, sourceUrl: ORIGIN + '/feed', type: typeOf(u) });
  const { match, filter } = engine.match(req);
  if (match) problems.push(`BLOCKED  ${u}  ← rule "${filter?.toString()}"  (${from})`);
}

const { classes, ids, attrs, attrValues } = await collectHooks();
const hidden = engine.getCosmeticsFilters({ url: ORIGIN + '/feed', hostname: 'edgeathlete.ca', domain: 'edgeathlete.ca', classes, ids, getBaseRules: false, getRulesFromHostname: true, getRulesFromDOM: true });
// A rule hides us only if EVERY class and id it names is one we render
// (`.grid > .container > #aside-promotion` needs all three).
const classSet = new Set(classes);
const idSet = new Set(ids);
const selectors = css => css.replace(/\{[^}]*\}/g, ',').split(',').map(s => s.trim()).filter(Boolean);
for (const sel of selectors(hidden.styles || '')) {
  const toks = [...sel.matchAll(/([.#])([\w-]+)/g)];
  if (toks.length && toks.every(([, k, n]) => (k === '.' ? classSet : idSet).has(n))) problems.push(`HIDDEN   ${sel}`);
}
// Generic attribute rules ([data-ad], [data-ad-slot^=…], [data-testid="ad"]) live in
// the base stylesheet: a bare or prefix rule on one of our names, or a value we use.
const base = engine.getCosmeticsFilters({ url: ORIGIN + '/feed', hostname: 'edgeathlete.ca', domain: 'edgeathlete.ca', getBaseRules: true, getRulesFromHostname: false, getRulesFromDOM: false }).styles || '';
for (const m of base.matchAll(/\[(data-[a-z0-9-]+)(?:([\^*$]?=)["']?([^"'\]]*)["']?)?\]/g)) {
  const [, name, op, value] = m;
  if (!op) { if (attrs.has(name)) problems.push(`HIDDEN   [${name}]  ← generic rule [${name}]`); continue; }
  if (op === '^=' && name.startsWith('data-') && value === '') continue;
  for (const v of attrValues.get(name) ?? []) {
    const hit = op === '=' ? v === value : op === '^=' ? v.startsWith(value) : op === '$=' ? v.endsWith(value) : v.includes(value);
    if (hit) problems.push(`HIDDEN   [${name}="${v}"]  ← generic rule ${m[0]}`);
  }
}

const unique = [...new Set(problems)];
console.log(`check-blocklists: ${urls.size} URLs, ${classes.length} classes, ${ids.length} ids, ${attrs.size} data attributes against Brave's default lists`);
if (unique.length) {
  console.log(unique.join('\n'));
  console.log(`\n✗ ${unique.length} would be blocked or hidden by Brave Shields`);
  process.exit(1);
}
console.log('✓ nothing the app requests or renders is on Brave\'s default lists');
