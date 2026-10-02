import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

// The speed round (Oct 2026) took two big libraries off every page: the
// emoji picker (~300 KB — a VALUE import of its `Theme` enum) and zod
// (~290 KB — the jitless config, then a category list that lived beside the
// event validator). This walks the STATIC import graph of the app's shell and
// the feed — what every signed-in phone downloads first — and fails if either
// comes back. `import type` and dynamic `import()` are free and allowed.

const ROOT = process.cwd();
const ENTRIES = ['src/app/(app)/layout.tsx', 'src/app/(app)/feed/page.tsx'];
const FORBIDDEN = ['zod', 'emoji-picker-react', 'mediabunny', 'leaflet', 'react-grid-layout'];

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function walk(): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  const parent = new Map<string, string | null>();
  const queue = ENTRIES.map(e => path.join(ROOT, e));
  for (const e of queue) parent.set(e, null);
  const staticImport = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;
  while (queue.length > 0) {
    const file = queue.shift()!;
    const src = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = staticImport.exec(src))) {
      const spec = m[1];
      const pkg = FORBIDDEN.find(f => spec === f || spec.startsWith(`${f}/`));
      if (pkg) {
        const chain: string[] = [path.relative(ROOT, file)];
        let p = parent.get(file) ?? null;
        while (p) {
          chain.push(path.relative(ROOT, p));
          p = parent.get(p) ?? null;
        }
        hits.set(`${pkg} ← ${chain.join(' ← ')}`, chain);
      }
      const next = resolve(spec, file);
      if (next && !parent.has(next)) {
        parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return hits;
}

describe('the first download stays light', () => {
  it('the app shell and the feed import no heavy library statically', () => {
    expect([...walk().keys()]).toEqual([]);
  });
});
