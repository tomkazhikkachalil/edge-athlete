// ── Where ffmpeg is (video posters PR 7, Oct 13 2026) ───────────────────────
// `ffmpeg-static` ships a platform binary at install time; on Vercel it is
// traced into the two routes that import this module (next.config.ts
// `outputFileTracingIncludes`) and `serverExternalPackages` keeps it out of
// the bundler. A deploy whose binary lost its exec bit is copied to /tmp and
// chmod'ed once per instance. `FFMPEG_PATH` overrides everything (a local
// Homebrew ffmpeg, a test).

import { accessSync, chmodSync, constants, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let resolved: string | null = null;

export function resolveFfmpeg(): string {
  if (resolved) return resolved;
  const override = process.env.FFMPEG_PATH;
  if (override && existsSync(override)) return (resolved = override);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS package whose default export is the path; `import` would bundle the binary's module graph
  const fromPackage = require('ffmpeg-static') as string | null;
  if (!fromPackage || !existsSync(fromPackage)) throw new Error('ffmpeg binary not found (ffmpeg-static)');
  try {
    accessSync(fromPackage, constants.X_OK);
    return (resolved = fromPackage);
  } catch {
    const copy = join(tmpdir(), 'ea-ffmpeg');
    if (!existsSync(copy)) copyFileSync(fromPackage, copy);
    chmodSync(copy, 0o755);
    return (resolved = copy);
  }
}
