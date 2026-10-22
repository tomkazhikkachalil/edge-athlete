import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { contrastRatio, relativeLuminance } from '../org-sites/accent-contrast';

// The text tiers are READABLE in both themes (Oct 22 2026, Tom: fix both
// themes, split out a decorative token). Every tier that carries text —
// faint and muted included — clears WCAG AA (4.5:1) on EVERY surface of its
// theme; the non-text grey (dividers, borders, decorative icons) is --decor,
// the old faint value. The Oct 10 audit had faint at 2.53:1 light / 3.59:1
// dark and muted-on-sunken at 4.39:1 light; this pins the fix.

const CSS = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
const SRC = join(__dirname, '..', '..');

function block(theme: 'light' | 'dark'): string {
  const start = theme === 'light' ? CSS.indexOf(':root,') : CSS.indexOf('[data-theme="dark"] {');
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('\n}', start));
}
function token(css: string, name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1].toLowerCase();
}
const SURFACES = ['background', 'surface', 'surface-muted', 'surface-sunken', 'surface-raised'] as const;
const AA = 4.5;

describe.each(['light', 'dark'] as const)('%s theme text tiers', theme => {
  const css = block(theme);
  const surfaces = SURFACES.map(s => [s, token(css, s)] as const);
  it.each(['text-faint', 'text-muted', 'text-tertiary', 'text-secondary', 'text-primary'])('%s is AA on every surface', tier => {
    const fg = token(css, tier);
    for (const [name, bg] of surfaces) {
      expect(contrastRatio(fg, bg), `${tier} ${fg} on ${name} ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });
  it('keeps the tiers in order (faint is the lightest readable grey, primary the strongest)', () => {
    const lum = (t: string) => relativeLuminance(token(css, t));
    const order = ['text-faint', 'text-muted', 'text-tertiary', 'text-secondary', 'text-primary'].map(lum);
    for (let i = 1; i < order.length; i++) {
      // light: each tier darker than the last; dark: each tier lighter.
      if (theme === 'light') expect(order[i]).toBeLessThan(order[i - 1]);
      else expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });
  it('carries the decorative grey as --decor, the old faint value', () => {
    expect(token(css, 'decor')).toBe(theme === 'light' ? '#9ca3af' : '#78716c');
  });
});

describe('the decor utilities', () => {
  it('are mapped for Tailwind and the old faint borders and dots moved onto them', () => {
    expect(CSS).toContain('--color-decor: var(--decor);');
    expect(CSS).toContain('--color-faint: var(--text-faint);');
    const leaflet = CSS.slice(CSS.indexOf('.leaflet-bar a.leaflet-disabled'));
    expect(leaflet.slice(0, 120)).toContain('var(--decor)');
    for (const [file, cls] of [
      ['components/golf/GolfRoundCard.tsx', 'border-decor'],
      ['components/messages/QuotedReply.tsx', 'border-decor'],
      ['components/messages/TypingIndicator.tsx', 'bg-decor'],
      ['components/AppHeader.tsx', 'dark:text-decor'],
    ] as const) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).toContain(cls);
    }
  });
  it('the error page paints the same faint hexes by hand', () => {
    const page = readFileSync(join(SRC, 'app', 'global-error.tsx'), 'utf8');
    expect(page).toContain(`faint: '${token(block('light'), 'text-faint')}'`);
    expect(page).toContain(`faint: '${token(block('dark'), 'text-faint')}'`);
  });
  it('readable text kept the faint token (a set label, a null score)', () => {
    expect(readFileSync(join(SRC, 'components/workouts/WorkoutDetailItems.tsx'), 'utf8')).toContain('<span className="text-faint">Set {set.setNumber}</span>');
    expect(readFileSync(join(SRC, 'lib/golf/scoring.ts'), 'utf8')).toContain("return 'text-faint'");
    // The calendar's out-of-month day numbers were text-gray-300 in light (1.47:1, the axe run's only hit).
    const cal = readFileSync(join(SRC, 'components/calendar/FeedCalendarWidget.tsx'), 'utf8');
    expect(cal).not.toContain('text-gray-300 dark:text-faint');
  });
});
