import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Explanatory text behind an (i) (Oct 28 2026). Tom: a paragraph that only
// says what a section is for is clutter; it sits behind an info button
// beside the heading and expands inline below it — a second tap, a tap
// anywhere else, or Escape collapses it; always collapsed on load, nothing
// remembered. ONE component (SectionInfo), ONE dismiss hook
// (usePopoverDismiss), a REAL 44 px target (never the after: extender, which
// is clipped under the Settings shell's overflow-hidden). Read from the
// source, the input-zoom-guard pattern: the rules hold or the gate is red.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const FILE = 'src/components/SectionInfo.tsx';

describe('explanatory text behind an (i): SectionInfo', () => {
  const src = code(FILE);

  it('is a client component built on THE house dismiss hook, with no listener of its own', () => {
    expect(read(FILE).startsWith("'use client';")).toBe(true);
    expect(src).toMatch(/import \{ usePopoverDismiss \} from '@\/hooks\/usePopoverDismiss'/);
    expect(src).toMatch(/usePopoverDismiss\(wrapRef, open, close\)/);
    expect(src).not.toMatch(/addEventListener/);
  });

  it('is collapsed on load and remembers nothing', () => {
    const states = src.match(/useState\(/g) ?? [];
    expect(states).toHaveLength(1);
    expect(src).toMatch(/useState\(false\)/);
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('is a disclosure: aria-expanded, aria-controls, the hidden panel, the one label', () => {
    expect(src).toMatch(/'aria-expanded': open/);
    expect(src).toMatch(/'aria-controls': panelId/);
    expect(src).toMatch(/hidden: !open/);
    expect(src).toMatch(/`More information about \$\{label\}`/);
    expect(src).toMatch(/type: 'button' as const/);
  });

  it('is a real 44 px target in the house glyph and classes — never an extender, never a focus: style', () => {
    expect(src).toMatch(/fa-circle-info/);
    expect(src).toMatch(/h-11 w-11/);
    expect(src).toMatch(/ea-interactive/);
    expect(src).toMatch(/ea-dropdown-in/);
    expect(src).toMatch(/text-sm text-tertiary/);
    expect(src).not.toMatch(/after:/);
    expect(src).not.toMatch(/focus:/);
  });

  it('the "Note" info boxes are gone from Settings — their copy lives behind the section\'s (i)', () => {
    for (const f of walk(path.join(ROOT, 'src/components/settings'))) {
      expect(code(path.relative(ROOT, f)), f).not.toMatch(/<h4[^>]*>(?:Privacy )?Note<\/h4>/);
    }
  });

  it('never enters the server-only trees: the public site and the shared ContestPage', () => {
    const offenders = [...walk(path.join(ROOT, 'src/app/(public)')), path.join(ROOT, 'src/components/contests/ContestPage.tsx')]
      .filter(f => /SectionInfo/.test(read(path.relative(ROOT, f))));
    expect(offenders).toEqual([]);
  });
});
