import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { decideBuild, previewRequested, touchesApp } from '../../../scripts/vercel-ignore-build.mjs';

// The Ignored Build Step (cost program, Oct 29 2026): production builds only
// when the commit changes the app; previews only when asked. The month
// before: 93 of 361 production builds were docs/migration-only merges and
// 318 previews were built for nothing.

describe('vercel-ignore-build: production', () => {
  it('skips a docs-only merge (devlog, specs, README)', () => {
    const d = decideBuild({ env: 'production', changedFiles: ['docs/devlog.md', 'docs/specs/README.md', 'README.md'] });
    expect(d.build).toBe(false);
  });
  it('skips a migration-plus-docs merge (SQL is applied by hand, never built)', () => {
    const d = decideBuild({ env: 'production', changedFiles: ['database/migrations/292_x.sql', 'database/MIGRATIONS.md', 'docs/devlog.md'] });
    expect(d.build).toBe(false);
  });
  it('skips e2e, scripts and workflow-only changes', () => {
    expect(decideBuild({ env: 'production', changedFiles: ['e2e/pulse.spec.ts', 'scripts/merge-pr.sh', '.github/workflows/ci.yml'] }).build).toBe(false);
  });
  it('builds when any app file changes, even beside docs', () => {
    expect(decideBuild({ env: 'production', changedFiles: ['docs/devlog.md', 'src/app/(app)/feed/page.tsx'] }).build).toBe(true);
    expect(decideBuild({ env: 'production', changedFiles: ['package.json'] }).build).toBe(true);
    expect(decideBuild({ env: 'production', changedFiles: ['vercel.json'] }).build).toBe(true);
    expect(decideBuild({ env: 'production', changedFiles: ['next.config.ts'] }).build).toBe(true);
    expect(decideBuild({ env: 'production', changedFiles: ['public/sw.js'] }).build).toBe(true);
  });
  it('a markdown file inside src still counts as docs; a .mdx or .ts beside it does not', () => {
    expect(touchesApp(['src/app/api/CLAUDE.md'])).toBe(false);
    expect(touchesApp(['src/content/page.mdx'])).toBe(true);
  });
  it('builds when the diff is unavailable or empty (the safe default)', () => {
    expect(decideBuild({ env: 'production', changedFiles: null }).build).toBe(true);
    expect(decideBuild({ env: 'production', changedFiles: undefined }).build).toBe(true);
    expect(decideBuild({ env: 'production', changedFiles: [] }).build).toBe(true);
  });
  it('an unknown environment is treated as production', () => {
    expect(decideBuild({ env: 'development', changedFiles: ['docs/x.md'] }).build).toBe(false);
  });
});

describe('vercel-ignore-build: preview', () => {
  it('skips a preview nobody asked for, whatever the diff', () => {
    expect(decideBuild({ env: 'preview', ref: 'feat/x', message: 'feat: y', changedFiles: ['src/a.ts'] }).build).toBe(false);
  });
  it('builds on a preview/** branch', () => {
    expect(decideBuild({ env: 'preview', ref: 'preview/sw-iphone', message: 'x', changedFiles: null }).build).toBe(true);
  });
  it('builds when the commit message carries [preview] (any case)', () => {
    expect(previewRequested({ ref: 'fix/x', message: 'fix: y [preview]' })).toBe(true);
    expect(previewRequested({ ref: 'fix/x', message: '[Preview] try' })).toBe(true);
    expect(previewRequested({ ref: 'fix/x', message: 'preview the thing' })).toBe(false);
  });
});

describe('vercel-ignore-build: wiring', () => {
  it('vercel.json runs the script as the ignored build step', () => {
    const cfg = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    expect(cfg.ignoreCommand).toBe('node scripts/vercel-ignore-build.mjs');
  });
  it('merge-pr.sh classifies the merge commit before waiting on Vercel', () => {
    expect(fs.readFileSync('scripts/merge-pr.sh', 'utf8')).toMatch(/vercel-ignore-build\.mjs --classify/);
  });
});
