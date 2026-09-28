import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Sports-team website program, N1 (Sep 27 2026): a news post can be
// scheduled — `published_at` in the future. Every reader of PUBLISHED news
// (a chain on org_site_news naming `.not('published_at', 'is', null)`) must
// also fence `.lte('published_at', …)`, or a scheduled post leaks early.
// The twin of the soft-delete sweep in authority-log.test.ts.

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('scheduled news never reads as published', () => {
  it('every published-news chain on org_site_news fences published_at <= now', () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, 'src'))) {
      const src = readFileSync(file, 'utf8');
      const parts = src.split(/\.from\(\s*['"]org_site_news['"]\s*\)/);
      for (let i = 1; i < parts.length; i++) {
        const end = parts[i].indexOf(';');
        const chain = end === -1 ? parts[i] : parts[i].slice(0, end);
        if (/\.not\(\s*['"]published_at['"]\s*,\s*['"]is['"]\s*,\s*null\s*\)/.test(chain) && !/\.lte\(\s*['"]published_at['"]/.test(chain)) {
          offenders.push(relative(root, file));
        }
      }
    }
    expect(offenders, `published-news reads without the schedule fence: ${offenders.join(', ')}`).toEqual([]);
  });
});
