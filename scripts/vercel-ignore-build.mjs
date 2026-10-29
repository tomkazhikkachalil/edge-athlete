#!/usr/bin/env node
// ── Vercel's Ignored Build Step (cost program, Oct 29 2026) ────────────────
// `vercel.json` → `"ignoreCommand": "node scripts/vercel-ignore-build.mjs"`.
// Vercel runs this before every build; exit 0 = skip the build (the
// deployment is CANCELED, production keeps serving the previous one),
// exit 1 = build. Two rules, both about building only when it changes
// what a user gets:
//
//   production  skip when the commit touches nothing the app is built from
//               (docs/, e2e/, scripts/, .github/, database/, *.md). In the
//               30 days before this landed, 93 of 361 production builds
//               were such merges — devlog entries, migrations applied by
//               hand, specs. The diff is against the previously DEPLOYED
//               sha when Vercel's shallow clone has it, else HEAD^ (a merge
//               commit's first parent = the previous main); a diff that
//               cannot be computed builds (the safe default).
//   preview     build only when asked: a `preview/**` branch or `[preview]`
//               in the commit message. 318 previews were built the month
//               before for nothing — CI builds its own copy on the GitHub
//               runner and the phone walks use production.
//
// `decideBuild` is the pure rule (zero imports), pinned by
// src/lib/__tests__/vercel-ignore-build.test.ts. `--classify` reads a file
// list on stdin and prints `build` / `skip` — merge-pr.sh uses it to know
// whether to wait for a production deployment at all.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Paths the app is NOT built from. A commit touching only these skips. */
export const NON_APP_PATHS = [/^docs\//, /^e2e\//, /^scripts\//, /^\.github\//, /^database\//, /\.md$/];

/** The preview opt-in: the branch or the commit message asks for one. */
export function previewRequested({ ref = '', message = '' }) {
  return /^preview\//.test(ref) || /\[preview\]/i.test(message);
}

/** Does this file list change what the app is built from? */
export function touchesApp(changedFiles) {
  return changedFiles.some(f => !NON_APP_PATHS.some(rx => rx.test(f)));
}

/**
 * The decision. `changedFiles` is null when the diff could not be computed
 * (shallow clone, first deployment) — then production builds.
 * Returns { build, reason }.
 */
export function decideBuild({ env, ref = '', message = '', changedFiles }) {
  if (env === 'preview') {
    return previewRequested({ ref, message })
      ? { build: true, reason: 'preview requested (preview/** branch or [preview] in the message)' }
      : { build: false, reason: 'preview not requested — previews are opt-in' };
  }
  if (!Array.isArray(changedFiles)) return { build: true, reason: 'diff unavailable — building to be safe' };
  if (changedFiles.length === 0) return { build: true, reason: 'empty diff — building to be safe' };
  return touchesApp(changedFiles)
    ? { build: true, reason: 'the commit changes the app' }
    : { build: false, reason: `only non-app paths changed (${changedFiles.length} files)` };
}

function gitDiffNames(from, to = 'HEAD') {
  try {
    const out = execFileSync('git', ['diff', '--name-only', from, to], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** Production's diff: the deployed sha when the clone has it, else HEAD^. */
export function changedFilesForBuild(previousSha) {
  const fromDeployed = previousSha ? gitDiffNames(previousSha) : null;
  if (fromDeployed) return fromDeployed;
  return gitDiffNames('HEAD^');
}

function main() {
  if (process.argv.includes('--classify')) {
    const files = (process.env.FILES ?? '').split('\n').map(s => s.trim()).filter(Boolean);
    process.stdout.write(touchesApp(files) ? 'build\n' : 'skip\n');
    return;
  }
  const env = process.env.VERCEL_ENV ?? 'production';
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? '';
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '';
  const changedFiles = env === 'preview' ? null : changedFilesForBuild(process.env.VERCEL_GIT_PREVIOUS_SHA);
  const { build, reason } = decideBuild({ env, ref, message, changedFiles });
  console.log(`[ignore-build] ${env} · ${ref || '(no ref)'} · ${build ? 'BUILD' : 'SKIP'} — ${reason}`);
  process.exit(build ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
