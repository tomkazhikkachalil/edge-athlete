import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toneTextVar, toneVar } from '@/lib/golf/score-card';

// Ink (Tom, Nov 27 2026): every line in the app is one ink — near-black in
// light, black in dark — and a card sits on a HARD edge instead of a soft
// shadow. Light mode's signal colours are bright; small text takes a darker
// twin. The public organisation sites keep the look Ink replaced.

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('src/app/globals.css');

/** The body of the first rule that starts with `head`. */
function block(head: string, from = 0): string {
  const start = css.indexOf(head, from);
  expect(start, head).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}
const LIGHT = block(':root,\n[data-theme="light"] {');
const DARK = block('[data-theme="dark"] {');
const MECH_LIGHT = block('.ea-mech {');
const MECH_DARK = block('[data-theme="dark"] .ea-mech {');

function token(body: string, name: string): string {
  const m = body.match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(m, name).not.toBeNull();
  return m![1].trim();
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('Ink: one line colour, a hard edge (both themes)', () => {
  it('the ink is near-black in light and black in dark', () => {
    expect(token(LIGHT, '--ink')).toBe('#1f1b2a');
    expect(token(DARK, '--ink')).toBe('#000000');
  });
  it('every line is the ink: the three border tokens and the hairline, in both themes', () => {
    for (const body of [LIGHT, DARK]) {
      expect(token(body, '--border-default')).toBe('var(--ink)');
      expect(token(body, '--border-strong')).toBe('var(--ink)');
      expect(token(body, '--border-subtle')).toBe('var(--ink-soft)');
    }
    expect(css.match(/--ea-hairline: var\(--ink\);/g)).toHaveLength(2);
  });
  it('exactly two elevation levels, both hard: 3 px at rest, 5 px raised', () => {
    expect(token(LIGHT, '--ink-edge')).toBe('0 3px 0 var(--ink)');
    expect(token(LIGHT, '--ink-edge-raised')).toBe('0 5px 0 var(--ink)');
    expect(css.match(/--ea-shadow-rest: var\(--ink-edge\);/g)).toHaveLength(2);
    expect(css.match(/--ea-shadow-raised: var\(--ink-edge-raised\);/g)).toHaveLength(2);
    // No scope re-points them to a soft shadow any more.
    expect(block('.tr-scope {')).not.toContain('--ea-shadow');
    expect(block('.org-app-scope {')).not.toContain('--ea-shadow');
  });
  it('a card is thickened by an inset line, never a wider border (no layout moves)', () => {
    expect(token(LIGHT, '--ink-line')).toBe('inset 0 0 0 1px var(--ink)');
    expect(block('.ea-surface {')).toContain('box-shadow: var(--ink-line), var(--ea-shadow-rest);');
    expect(block('.tr-card,\n.ea-bubble {')).toContain('box-shadow: var(--ink-line), var(--ea-shadow-rest);');
    expect(css).not.toMatch(/\.ea-(surface|bubble|mech-panel)[^{]*\{[^}]*border-width: 2px/);
  });
  it("Tailwind's shadows are re-pointed through --tw-shadow; a bare `shadow` (a knob) is not", () => {
    expect(css).toContain(':where([class~="shadow-sm"], [class~="shadow-md"]):not(:where([data-plain] *, .org-scope, .org-scope *)) {\n  --tw-shadow: var(--ink-line), var(--ink-edge);');
    expect(css).toContain(':where([class~="shadow-lg"], [class~="shadow-xl"], [class~="shadow-2xl"]):not(:where([data-plain] *, .org-scope, .org-scope *)) {\n  --tw-shadow: var(--ink-line), var(--ink-edge-raised);');
    expect(css).not.toContain('[class~="shadow"]');
  });
  it('dark: a control keeps a line that can be seen (3:1 on the surface)', () => {
    expect(css).toContain('[data-theme="dark"] :where(input, select, textarea, button, a)[class~="border-border-strong"]');
    expect(contrast(token(DARK, '--control-line'), token(DARK, '--surface'))).toBeGreaterThanOrEqual(1.7);
  });
});

describe('Ink: the public organisation sites opt out', () => {
  it('the public root layout is marked plain', () => {
    expect(read('src/app/(public)/layout.tsx')).toContain('data-plain=""');
    // The app's own root layout is not.
    expect(read('src/app/(app)/layout.tsx')).not.toContain('data-plain');
  });
  it('plain keeps the values Ink replaced, in both themes', () => {
    const plain = block('html[data-plain],\n.org-scope {');
    expect(token(plain, '--border-default')).toBe('#e5e7eb');
    expect(token(plain, '--border-strong')).toBe('#d1d5db');
    expect(token(plain, '--ink-line')).toBe('0 0 #0000');
    expect(token(plain, '--ea-shadow-rest')).toBe('0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.03)');
    const plainDark = block('html[data-plain][data-theme="dark"],');
    expect(token(plainDark, '--border-default')).toBe('#332d27');
    expect(token(plainDark, '--border-strong')).toBe('#4a423b');
  });
});

describe('Ink in the mechanical dialect', () => {
  it('panels, slots and keys are outlined in the ink, in both themes', () => {
    for (const body of [MECH_LIGHT, MECH_DARK]) {
      expect(token(body, '--mech-hairline')).toMatch(/^var\(--ink\)/);
      expect(token(body, '--mech-panel-depth')).toContain('var(--ink-line)');
      expect(token(body, '--mech-panel-depth')).toContain('var(--ink-edge)');
      expect(token(body, '--mech-recess-depth')).toBe('inset 0 0 0 1.5px var(--ink)');
      expect(token(body, '--mech-key-depth')).toContain('inset 0 0 0 1.5px var(--ink)');
    }
    // Dark: the panel is a step lighter than the surface, so black shows.
    expect(luminance(token(MECH_DARK, '--mech-panel').slice(0, 7))).toBeGreaterThan(luminance(token(MECH_DARK, '--mech-surface')));
  });

  const TWINS = ['good', 'great', 'warn', 'danger', 'bad', 'media'] as const;
  it('light: every signal colour has a darker text twin that reads at 4.5:1 on a panel, the surface and a slot', () => {
    for (const name of TWINS) {
      const twin = token(MECH_LIGHT, `--mech-${name}-text`);
      for (const ground of ['--mech-panel', '--mech-recess', '--mech-surface']) {
        expect(contrast(twin, token(MECH_LIGHT, ground)), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The labels and soft text read on a slot as well.
    for (const name of ['--mech-label', '--mech-text-soft', '--mech-accent-light']) {
      expect(contrast(token(MECH_LIGHT, name), token(MECH_LIGHT, '--mech-recess')), name).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('light: the bright colours are fills and large glyphs — 3:1 on a panel', () => {
    for (const name of ['good', 'danger', 'bad', 'media'] as const) {
      expect(contrast(token(MECH_LIGHT, `--mech-${name}`), token(MECH_LIGHT, '--mech-panel')), name).toBeGreaterThanOrEqual(3);
    }
    // Gold is too light to be an icon on white: the icon twin is used.
    expect(contrast(token(MECH_LIGHT, '--mech-gold-icon'), token(MECH_LIGHT, '--mech-panel'))).toBeGreaterThanOrEqual(3);
  });
  it('a label on a bright fill is dark, and reads at 4.5:1 (both themes); white on the accent too', () => {
    for (const body of [MECH_LIGHT, MECH_DARK]) {
      expect(contrast(token(body, '--mech-on-good'), token(body, '--mech-good'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(body, '--mech-on-danger'), token(body, '--mech-danger'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#ffffff', token(body, '--mech-accent'))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('dark: the twins are the bright colours themselves', () => {
    for (const name of TWINS) expect(token(MECH_DARK, `--mech-${name}-text`)).toBe(token(MECH_DARK, `--mech-${name}`));
  });
  it('small coloured text takes the twin at its call sites', () => {
    expect(toneVar('good')).toBe('var(--mech-good)');
    expect(toneTextVar('good')).toBe('var(--mech-good-text)');
    expect(toneTextVar('text')).toBe('var(--mech-text)');
    expect(read('src/components/golf/scoring/StrokesDial.tsx')).toContain('fill: toneTextVar(tone)');
    expect(read('src/components/golf/round-steps/PuttingRule.tsx')).not.toContain('!text-[color:var(--mech-good)]');
    expect(read('src/components/composer/CaptionPanel.tsx')).toContain("ok: 'var(--mech-good-text)'");
    expect(read('src/components/posts/StatPlate.tsx')).toContain('style={{ color: plateTextColour(plate) }}');
    expect(read('src/components/golf/scoring/PenaltyParts.tsx')).toContain("color: 'var(--mech-danger-text)'");
  });
});
