import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Android's forced dark modes (Oct 15 2026): every browser reads a different
// signal for "this site themes itself", so the page sends all three. Without
// them Chrome's Auto Dark or Samsung Internet's dark mode repaints the LIGHT
// theme. See docs/specs/ui-conventions.md "Light and dark on every phone".

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const css = read('src/app/globals.css');

describe('source pins — the page tells every browser it themes itself', () => {
  it('the root schemes are `only` (Chrome Auto Dark opt-out)', () => {
    expect(css).toMatch(/:root,\s*\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*only light;/);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{\s*color-scheme:\s*only dark;/);
  });

  it('a real prefers-color-scheme rule exists (Samsung Internet) and nothing reads its variable', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{\s*--ea-os-scheme:\s*dark;/);
    expect(css).not.toMatch(/var\(--ea-os-scheme/);
  });

  it('both root layouts render <meta name="color-scheme" content="light dark">', () => {
    for (const f of ['src/app/(app)/layout.tsx', 'src/app/(public)/layout.tsx']) {
      expect(read(f), f).toMatch(/colorScheme:\s*'light dark'/);
    }
  });
});
