import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The media worker's boundary (performance program, Nov 7 2026).
 *
 * `src/lib/media/process-server.ts` is the worker: it reaches the ffmpeg
 * binary and sharp through dynamic imports and reads posters from a temp
 * directory. The file tracer follows all of that into every function that
 * imports the module — on Nov 7 the feed's `/api/posts` traced ~170 MB and
 * cold-started in 1.5–1.8 s because it only wanted to ENQUEUE a job. The
 * enqueue side now lives in `enqueue-server.ts`, and exactly two routes may
 * import the worker. A new importer fails here before it fails on the phone.
 */

const ROOT = process.cwd();
const WORKER = 'src/lib/media/process-server.ts';
const ALLOWED_WORKER_IMPORTERS = new Set([
  'src/app/api/cron/media-jobs/route.ts',
  'src/app/api/admin/media-jobs/route.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('media worker boundary', () => {
  const files = walk(join(ROOT, 'src'));

  it('only the two worker routes import process-server', () => {
    const importers = files
      .filter((f) => !f.endsWith(WORKER))
      .filter((f) => /from ['"]@\/lib\/media\/process-server['"]|from ['"]\.\/process-server['"]|from ['"]\.\.\/process-server['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1))
      .sort();
    expect(importers).toEqual([...ALLOWED_WORKER_IMPORTERS].sort());
  });

  it('the enqueue side touches no disk, no binary and no image library', () => {
    const src = readFileSync(join(ROOT, 'src/lib/media/enqueue-server.ts'), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*(import|export) .*from |import\(/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).not.toMatch(/node:fs|from 'fs'|ffmpeg|sharp|child_process|process-server|video-probe/);
  });

  it('the writers enqueue through enqueue-server', () => {
    for (const f of ['src/app/api/posts/route.ts', 'src/lib/activities/media-server.ts', 'src/lib/sport-events/media-server.ts', 'src/lib/golf/round-mirror.ts', 'src/app/api/cron/daily/route.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toMatch(/@\/lib\/media\/enqueue-server/);
    }
  });

  it('the tracer is told what a function never reads (next.config.ts)', () => {
    const cfg = readFileSync(join(ROOT, 'next.config.ts'), 'utf8');
    expect(cfg).toMatch(/outputFileTracingExcludes/);
    for (const p of ['./database/**', './node_modules/ffmpeg-static/**', './node_modules/sharp/**', './node_modules/@img/**', './public/**']) {
      expect(cfg, p).toContain(`'${p}'`);
    }
    // The two worker routes still get the binary by name.
    expect(cfg).toMatch(/'\/api\/cron\/media-jobs': \['\.\/node_modules\/ffmpeg-static\/ffmpeg'/);
    // …and the org card renderers get sharp by name, nothing else does.
    //   (Nov 12 2026: through SHARP_FILES — sharp's files AND the dependency it imports at load; see traced-deps.test.ts.)
    expect(cfg).toContain("'/org/\\\\[slug\\\\]/card.png': [...SHARP_FILES],");
    expect(cfg).toContain("'./node_modules/detect-libc/**'");
  });

  it('the snapshots are not tracked and Vercel never uploads them', () => {
    const ignore = readFileSync(join(ROOT, '.vercelignore'), 'utf8');
    expect(ignore).toMatch(/^database\/ops\/snapshots$/m);
  });
});
