import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Sports-team website program, P0-2 (Sep 27 2026): the content columns of
// `org_sites` are the PUBLISHED PROJECTION of the site draft (CLAUDE.md
// convention 12) — publish mirrors them, so anything else writing them is
// wiped by the next publish. Announce did exactly that with the notice band
// (hero_config). This sweep pins the modules allowed to write the row; a new
// writer fails here until it is reviewed against the draft → publish rule.

const ALLOWED = new Set([
  'src/lib/org-sites/revisions-server.ts', // publish / restore / discard — the projection writer
  'src/lib/org-sites/server.ts', // create, live/offline, slug (not draft content)
  'src/lib/org-sites/logo-server.ts', // logo_path stays live by design
  'src/lib/org-sites/domain-server.ts', // custom domain lifecycle
  'src/lib/orgs/pending-org.ts', // provisioning a pending org's site
  'src/lib/authority/recovery-server.ts', // the support team's hold / restore
]);

const WRITE_RE = /from\(\s*['"]org_sites['"]\s*\)\s*\.(update|insert|upsert|delete)\s*\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('org_sites row writers', () => {
  const root = process.cwd();
  const writers = sourceFiles(join(root, 'src'))
    .filter(f => WRITE_RE.test(readFileSync(f, 'utf8')))
    .map(f => relative(root, f));

  it('only the allowlisted modules write org_sites', () => {
    const stray = writers.filter(f => !ALLOWED.has(f));
    expect(stray, `these write org_sites outside the allowlist: ${stray.join(', ')}`).toEqual([]);
  });

  it('announce never writes the site row (the band is derived at render)', () => {
    expect(writers).not.toContain('src/lib/orgs/announce-server.ts');
  });

  it('the allowlist has no stale entries', () => {
    const stale = [...ALLOWED].filter(f => !writers.includes(f));
    expect(stale, `no longer write org_sites — drop from the allowlist: ${stale.join(', ')}`).toEqual([]);
  });
});
