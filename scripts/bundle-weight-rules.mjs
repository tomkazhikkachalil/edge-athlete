// Bundle-weight rules (performance program, Nov 7 2026) — the analysis
// behind scripts/check-bundle-weight.mjs, split out so
// src/lib/__tests__/bundle-weight-rules.test.ts can pin it on fixtures.
//
// WHY. Every byte of client JavaScript is downloaded, parsed and executed on
// the phone — on a mid-range Android the CPU cost is 3–5× the desktop's —
// and after every deploy the chunks whose hashes changed are downloaded
// again. On Nov 7 2026 the code shared by EVERY page was ~190 KB gzipped and
// `/feed` ~450 KB gzipped (the athlete page ~630 KB), and nothing in the gate
// would have noticed the next 50 KB. Budgets are gzipped bytes (what crosses the wire); they start
// where the app is today and RATCHET DOWN as the diet lands — a PR that
// raises one says why in its body and the devlog. The ratchet so far: root
// 200 → 150 KB (the browser Sentry SDK off the page load, Phase 3b: 185 →
// 132 KB measured), route 640 → 600 KB (the athlete page 627 → 575). The
// icons round (Nov 8) tried the glyph PATHS as JavaScript first — +40 KB gz
// on every route — and settled on one cached SVG sprite with path-less
// modules: +8–11 KB gz per route for the symbol ids and boxes, the webfont
// stylesheet (23 KB gz on EVERY page) and its three font files (259 KB) gone.

/** The chunks every page loads (build-manifest.json rootMainFiles), gzipped. */
export const ROOT_GZIP_BUDGET_BYTES = 150 * 1024;
/** Any one route's first-paint client chunks (root included), gzipped. */
export const ROUTE_GZIP_BUDGET_BYTES = 600 * 1024;

/** `.next/server/app/(app)/feed/page_client-reference-manifest.js` → `(app)/feed`. */
export function routeIdFromReferenceManifestPath(p) {
  const m = /\.next\/server\/app\/(.+?)\/page_client-reference-manifest\.js$/.exec(p.replace(/\\/g, '/'));
  return m ? m[1] : null;
}

/**
 * The JSON inside a client-reference manifest file
 * (`globalThis.__RSC_MANIFEST["/x/page"] = {…};`). Null when the file is not
 * that shape.
 */
export function parseReferenceManifest(source) {
  const i = source.indexOf('= {');
  if (i === -1) return null;
  let text = source.slice(i + 2).trim();
  if (text.endsWith(';')) text = text.slice(0, -1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The client chunks a route loads on first paint: the `entryJSFiles` of its
 * own tree — every layout, template, loading and page entry of the manifest
 * (the error, not-found and global-error entries load only when they render;
 * a `dynamic()` chunk is not an entry at all). Returned as
 * `static/chunks/<name>.js` paths, deduped.
 */
export function entryChunksOf(manifest) {
  const out = new Set();
  for (const [entry, chunks] of Object.entries(manifest?.entryJSFiles ?? {})) {
    if (!/\/(layout|template|loading|page)$/.test(entry)) continue;
    for (const c of chunks ?? []) {
      const m = /static\/chunks\/[^"']+\.js$/.exec(c);
      if (m) out.add(m[0]);
    }
  }
  return [...out];
}

/** The verdict over `{ rootGz, routes: [{ route, gz }] }`. */
export function judgeBundle(measure, { root = ROOT_GZIP_BUDGET_BYTES, route = ROUTE_GZIP_BUDGET_BYTES } = {}) {
  const failures = [];
  if (measure.rootGz > root) failures.push({ what: 'root', gz: measure.rootGz, budget: root });
  for (const r of measure.routes) {
    if (r.gz > route) failures.push({ what: r.route, gz: r.gz, budget: route });
  }
  return failures;
}

export const kb = (bytes) => (bytes / 1024).toFixed(0) + ' KB';

export function formatBundleReport(measure, { topRoutes = 10, topChunks = 10 } = {}) {
  const lines = [];
  lines.push(`bundle weight: root ${kb(measure.rootGz)} gz (${measure.rootFiles} files, budget ${kb(ROOT_GZIP_BUDGET_BYTES)}); ${measure.routes.length} routes, budget ${kb(ROUTE_GZIP_BUDGET_BYTES)} gz each`);
  const routes = [...measure.routes].sort((a, b) => b.gz - a.gz).slice(0, topRoutes);
  lines.push('  heaviest routes (first-paint chunks, root included):');
  for (const r of routes) lines.push(`  ${kb(r.gz).padStart(8)} gz  ${String(r.files).padStart(3)} files  ${r.route}`);
  const chunks = [...measure.chunks].sort((a, b) => b.gz - a.gz).slice(0, topChunks);
  lines.push('  largest chunks (any route, lazy included):');
  for (const c of chunks) lines.push(`  ${kb(c.gz).padStart(8)} gz  ${kb(c.raw).padStart(8)} raw  ${c.path}${c.root ? '  (root)' : ''}`);
  if (measure.css?.length) lines.push('  css: ' + measure.css.map((c) => `${c.path.split('/').pop()} ${kb(c.gz)} gz`).join(' · '));
  return lines.join('\n');
}
