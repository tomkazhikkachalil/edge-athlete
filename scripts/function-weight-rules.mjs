// Function-weight rules (performance program, Nov 7 2026) — the analysis
// behind scripts/check-function-weight.mjs, split out so
// src/lib/__tests__/function-weight-rules.test.ts can pin it on fixtures.
//
// WHY THIS GATE EXISTS. A serverless function's cold start is dominated by
// what it has to download and unpack before the first line runs. On Nov 7
// 2026 the function that serves `/api/posts` (the feed) TRACED ~175 MB: the
// 45 MB ffmpeg binary (reached through a dynamic import of the media
// worker), ~28 MB of sharp/libvips (the org card renderer) and 95 MB of PNGs
// — 601 files, mostly the Sep 30 database snapshots' uploaded photos — pulled
// in because `readFile(join(dir, `${job.id}.png`))` is a path the tracer
// cannot resolve, so it includes every `*.png` in the project. Nothing
// measured it, so nothing noticed. With <10 users every request in the
// minutes after a deploy is a cold start, and a feed open fans out a dozen
// calls at once — "the app is slow after I ship an update".
//
// The rule: every route's traced bytes stay under the budget, except the
// routes that legitimately carry a binary (the media worker: ffmpeg; the org
// card renderers: sharp). A PR that raises the budget says why in its body
// and the devlog, like the lint cap.

/** 25 MB — a comfortable ceiling for a Next route that carries no binary;
 *  the median route traced 4.5 MB on Nov 7 2026. */
export const DEFAULT_FUNCTION_BUDGET_BYTES = 25 * 1024 * 1024;

/** Routes allowed above the budget, and why. Keyed by route id (see routeIdFromNftPath). */
export const EXEMPT_ROUTES = Object.freeze({
  'api/cron/media-jobs': 'the media worker: ffmpeg-static is traced here on purpose (next.config outputFileTracingIncludes)',
  'api/admin/media-jobs': 'the media worker, run by hand: the same binary',
  '(public)/org/[slug]/card.png': 'the org card renderer: sharp + libvips',
  '(public)/[slug]/card.png': 'the vanity twin of the org card renderer',
});

/**
 * `.next/server/app/(app)/feed/page.js.nft.json` → `(app)/feed`;
 * `.next/server/app/api/posts/route.js.nft.json` → `api/posts`. Null for a
 * trace that is not a route's.
 */
export function routeIdFromNftPath(nftPath) {
  const m = /\.next\/server\/app\/(.+?)\/(page|route)\.js\.nft\.json$/.exec(nftPath.replace(/\\/g, '/'));
  return m ? m[1] : null;
}

/**
 * Which bucket a traced file lands in: the npm package (`@scope/name` or
 * `name`, the FIRST node_modules segment), `server/chunks` for Next's own
 * compiled output, or `project` for anything else in the repo (the bucket
 * the snapshots' PNGs filled).
 */
export function attributeTracedFile(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p);
  if (m) return m[1];
  if (/\/\.next\/server\/chunks\//.test(p) || /^\.next\/server\/chunks\//.test(p)) return 'server/chunks';
  return 'project';
}

/** Per-route summary: total bytes, file count, and the heaviest buckets. */
export function summarizeRoute(files, topN = 6) {
  const byBucket = new Map();
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    const k = attributeTracedFile(f.path);
    byBucket.set(k, (byBucket.get(k) ?? 0) + f.bytes);
  }
  const buckets = [...byBucket.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, topN);
  return { total, files: files.length, buckets };
}

/**
 * The verdict: every route over the budget that is not exempt is a failure;
 * an exempt route is reported, never failed. Rows: `{ route, total }`.
 */
export function judgeRoutes(rows, budget = DEFAULT_FUNCTION_BUDGET_BYTES, exempt = EXEMPT_ROUTES) {
  const failures = [];
  const exempted = [];
  for (const row of rows) {
    if (row.total <= budget) continue;
    if (row.route in exempt) exempted.push(row);
    else failures.push(row);
  }
  return { failures, exempted };
}

export const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + ' MB';

/** The human report: the N heaviest routes with their buckets. */
export function formatReport(rows, { topN = 10, budget = DEFAULT_FUNCTION_BUDGET_BYTES } = {}) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const lines = [];
  lines.push(`function weight: ${rows.length} routes, budget ${mb(budget)} per route (exempt: ${Object.keys(EXEMPT_ROUTES).length})`);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].total : 0;
  lines.push(`  median ${mb(median)} · heaviest ${sorted.length ? mb(sorted[0].total) : '—'}`);
  for (const r of sorted.slice(0, topN)) {
    const flag = r.total > budget ? (r.route in EXEMPT_ROUTES ? ' (exempt)' : ' OVER') : '';
    lines.push(`  ${mb(r.total).padStart(9)}  ${r.route}${flag}`);
    if (r.buckets) {
      lines.push('             ' + r.buckets.map((b) => `${b.name} ${mb(b.bytes)}`).join(' · '));
    }
  }
  return lines.join('\n');
}
