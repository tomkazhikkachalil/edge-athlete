import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Profile quick fixes (Oct 14 2026): "View all rounds", "Trends", the Get
// Started actions and the sport pages' links are plain secondary buttons
// (globals.css .ea-btn-secondary) — never a label with an arrow glyph. This
// holds the sites where the arrows lived, so one cannot creep back.
const ROOT = join(__dirname, '..', '..', '..');
const FILES = [
  'src/components/GetStartedCard.tsx',
  'src/components/SportQuickLinks.tsx',
  'src/components/stats/GolfBreakdown.tsx',
  'src/lib/sports/first-activity-copy.ts',
  'src/app/(app)/app/sport/golf/rounds/page.tsx',
  'src/app/(app)/app/sport/golf/trends/page.tsx',
  'src/app/(app)/app/sport/[sport_key]/log/page.tsx',
  'src/app/(app)/app/sport/[sport_key]/trends/page.tsx',
];
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no arrow glyphs on the profile and sport-page links', () => {
  it('the named sites carry no → or ←', () => {
    for (const f of FILES) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      expect(text, f).not.toMatch(/[→←]/);
    }
  });
  it('no sport adapter declares an arrowed nav link', () => {
    for (const f of walk(join(ROOT, 'src/lib/sports/adapters'))) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/label:[^\n]*[→←]/);
    }
  });
});
