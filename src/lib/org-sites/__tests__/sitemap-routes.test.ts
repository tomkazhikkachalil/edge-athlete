import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Every route folder named sitemap.xml declares force-dynamic IN ITS OWN
// FILE (Sep 27 2026, the leftovers prod probe). Next reads such a folder as
// a metadata route: without the flag, a sitemap under a dynamic segment is
// prerendered once for a placeholder slug (/-/sitemap.xml) with no dynamic
// route recorded, so on Vercel every real /{slug}/sitemap.xml fell through
// to [pageSlug] and answered 404 — for months, while `next start` (local
// e2e) resolved it fine. Segment config is read per file, so a twin that
// re-exports GET must carry the line too.

const APP = path.join(process.cwd(), 'src/app');

function sitemapRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === 'sitemap.xml') {
      const route = path.join(full, 'route.ts');
      if (fs.existsSync(route)) out.push(route);
    }
    sitemapRoutes(full, out);
  }
  return out;
}

describe('sitemap.xml route folders', () => {
  const routes = sitemapRoutes(APP);

  it('finds the per-site sitemap and its vanity twin', () => {
    const rel = routes.map(r => path.relative(APP, r));
    expect(rel).toContain(path.join('(public)', 'org', '[slug]', 'sitemap.xml', 'route.ts'));
    expect(rel).toContain(path.join('(public)', '[slug]', 'sitemap.xml', 'route.ts'));
  });

  it.each(routes.map(r => [path.relative(APP, r), r]))('%s declares force-dynamic', (_rel, file) => {
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^export const dynamic = 'force-dynamic';$/m);
  });
});
