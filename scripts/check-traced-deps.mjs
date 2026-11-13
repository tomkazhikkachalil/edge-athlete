#!/usr/bin/env node
// Traced-dependency gate (Nov 12 2026) — runs after `next build` inside
// `npm run check:weight` (so inside `npm run verify`).
//
// WHY: the function diet (Nov 7) excludes `sharp` from every function and
// puts it back into the few routes that use it with
// `outputFileTracingIncludes` — a FILE GLOB. A glob brings the package's own
// files, not the packages it depends on. sharp imports `detect-libc` at
// load, which nothing else traced, so on Vercel every one of those routes
// died at import ("Cannot find package 'detect-libc'") — the org share
// cards answered 500 and the media worker could not load — while the build,
// the unit tests and every local run stayed green (locally node_modules is
// whole). Found by the Nov 12 maintenance probe on production.
//
// THE RULE: a route whose trace carries a force-included package must also
// carry every package in that package's `dependencies` (nested copy or
// hoisted). Exit 1 names the route and the missing package.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Packages put into functions by a glob in next.config.ts → outputFileTracingIncludes. */
export const FORCE_INCLUDED = ['sharp'];

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

/** The hard dependencies a package declares (optional ones are platform binaries — the include glob names those itself). */
export function hardDeps(pkgName, rootDir = root) {
  try {
    return Object.keys(JSON.parse(readFileSync(join(rootDir, 'node_modules', pkgName, 'package.json'), 'utf8')).dependencies ?? {});
  } catch {
    return [];
  }
}

/** Which of `deps` a trace (repo-relative paths) is missing for `pkg`: neither nested under the package nor hoisted. */
export function missingDeps(files, pkg, deps) {
  if (!files.some((f) => f.includes(`node_modules/${pkg}/`))) return [];
  return deps.filter((d) => !files.some((f) => f.includes(`node_modules/${pkg}/node_modules/${d}/`) || f.startsWith(`node_modules/${d}/`)));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const nfts = walk(appDir);
  if (nfts.length === 0) {
    console.error(`check-traced-deps: no traces under ${relative(root, appDir)} — run \`next build\` first`);
    process.exit(2);
  }
  const problems = [];
  let carriers = 0;
  for (const nft of nfts) {
    let trace;
    try {
      const raw = readFileSync(nft, 'utf8');
      // Hundreds of routes, thousands of files each: only a trace that names a force-included package is worth resolving.
      if (!FORCE_INCLUDED.some((pkg) => raw.includes(`node_modules/${pkg}/`))) continue;
      trace = JSON.parse(raw);
    } catch {
      continue;
    }
    const base = dirname(nft);
    const files = (trace.files ?? []).map((f) => relative(root, resolve(base, f)));
    for (const pkg of FORCE_INCLUDED) {
      if (!files.some((f) => f.includes(`node_modules/${pkg}/`))) continue;
      carriers += 1;
      for (const dep of missingDeps(files, pkg, hardDeps(pkg))) problems.push(`${relative(appDir, nft).replace(/\.nft\.json$/, '')}: carries ${pkg} without its dependency ${dep}`);
    }
  }
  if (problems.length > 0) {
    console.error(`check-traced-deps: ${problems.length} function(s) would fail at import on Vercel —`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('  Add the missing package to the route\'s outputFileTracingIncludes in next.config.ts.');
    process.exit(1);
  }
  console.log(`check-traced-deps: ${carriers} function(s) carry a force-included package, each with every dependency it declares`);
}
