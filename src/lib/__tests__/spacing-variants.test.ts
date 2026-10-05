import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// The spacing rhythm classes (`gap-micro`, `px-base`, `mb-section` …) are
// PLAIN CSS in globals.css, not Tailwind utilities, so Tailwind v4 never
// generates a responsive variant of them: `sm:gap-base` is silently dead.
// That is how the post action row lost its gap from `sm` up (Oct 4 2026 —
// the like count sat flush on the comment icon). A responsive gap uses the
// Tailwind scale (`sm:gap-6`) or an arbitrary value (`sm:gap-[var(--space-base)]`).

const VARIANT_RE = /\b(?:sm|md|lg|xl|2xl|hover|focus|dark):(?:gap|p[xytblr]?|m[xytblr]?)-(?:micro|base|section)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?|css|mdx?)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('spacing rhythm classes carry no responsive variants', () => {
  it('no sm:/md:/lg: variant of gap-/p-/m- micro|base|section anywhere under src/', () => {
    const root = path.join(__dirname, '..', '..');
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (VARIANT_RE.test(line)) offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, 'dead responsive variants of plain spacing classes').toEqual([]);
  });
});
