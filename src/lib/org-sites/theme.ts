import { readableOn } from './accent-contrast';
import type { CSSProperties } from 'react';
import { parseThemeTokens, resolveAccentPair, type ThemeTypeface } from './validate';
import { templateSpec, type TemplateSpec } from './templates';

/**
 * The resolved design of a site — Site Builder phase 7 (Sep 9 2026).
 *
 * Templates survive as SEED + fallback: a template id still decides the
 * header shape, the hero shape, the density and the teams variant — until
 * the theme tokens say otherwise (`tokens.header ?? spec.header`, no DDL).
 * `effectiveSpec` is the one place that merge happens; every renderer that
 * used to call `templateSpec(site.template_id)` calls this instead, so the
 * public shell, the public grid, the editor canvas and the picker agree.
 *
 * Heading faces: a curated set of self-hosted OFL woff2 files (latin
 * subsets, 12–24 KB each, under /public/fonts) — loaded ONLY by a site that
 * picks one (`fontFaceCss` + a preload link the shell emits), never by
 * next/font (which would preload every face on every page). Family names
 * are ours ('EA Oswald' …) so the CSS can never be confused with a device
 * font of the same name. 'sans' and 'serif' stay CSS stacks: zero payload.
 *
 * `themeAttrs` is what a themed root wears: the accent custom properties
 * (only when the site sets an accent — a default-themed site keeps the
 * violet defaults from the stylesheet), the heading-font property, and the
 * data attributes the stylesheet keys off. Every value comes from the
 * re-validated token set or a closed map — never from raw jsonb.
 */

export interface ThemeSource {
  template_id: string;
  theme_token_set: unknown;
}

/** The template's render decisions with the theme tokens laid over them. */
export function effectiveSpec(site: ThemeSource): TemplateSpec {
  const spec = templateSpec(site.template_id);
  const t = parseThemeTokens(site.theme_token_set);
  return {
    ...spec,
    header: t.header ?? spec.header,
    hero: t.hero ?? spec.hero,
    density: t.density ?? spec.density,
    teams: t.teams ?? spec.teams,
  };
}

export type HeadingFontKey = Exclude<ThemeTypeface, 'sans' | 'serif'>;

export interface HeadingFont {
  /** The name a manager picks by. */
  label: string;
  blurb: string;
  /** Our own family name (never a device font's). */
  family: string;
  /** Under /public/fonts. */
  file: string;
  weight: number;
  fallback: string;
}

export const HEADING_FONTS: Readonly<Record<HeadingFontKey, HeadingFont>> = {
  oswald: { label: 'Sporty', blurb: 'Tall, condensed capitals — scoreboard energy.', family: 'EA Oswald', file: 'oswald-600.woff2', weight: 600, fallback: "'Arial Narrow', Impact, sans-serif" },
  lora: { label: 'Editorial', blurb: 'A warm, readable serif for a club with a story.', family: 'EA Lora', file: 'lora-700.woff2', weight: 700, fallback: "Georgia, 'Times New Roman', serif" },
  playfair: { label: 'Classic', blurb: 'High-contrast serif — the country-club letterhead.', family: 'EA Playfair', file: 'playfair-700.woff2', weight: 700, fallback: "Georgia, 'Times New Roman', serif" },
  nunito: { label: 'Friendly', blurb: 'Rounded and open — junior programs, community leagues.', family: 'EA Nunito', file: 'nunito-800.woff2', weight: 800, fallback: 'ui-rounded, system-ui, sans-serif' },
  space: { label: 'Modern', blurb: 'Geometric and a little technical.', family: 'EA Space Grotesk', file: 'space-grotesk-700.woff2', weight: 700, fallback: 'system-ui, sans-serif' },
};

export const TYPEFACE_LABEL: Readonly<Record<ThemeTypeface, string>> = {
  sans: 'Clean',
  serif: 'Serif',
  oswald: HEADING_FONTS.oswald.label,
  lora: HEADING_FONTS.lora.label,
  playfair: HEADING_FONTS.playfair.label,
  nunito: HEADING_FONTS.nunito.label,
  space: HEADING_FONTS.space.label,
};

export function headingFont(typeface: ThemeTypeface): HeadingFont | null {
  return typeface === 'sans' || typeface === 'serif' ? null : HEADING_FONTS[typeface];
}

/** The @font-face for one heading face (null for the CSS stacks). */
export function fontFaceCss(typeface: ThemeTypeface): string | null {
  const f = headingFont(typeface);
  if (!f) return null;
  return `@font-face{font-family:'${f.family}';src:url('/fonts/${f.file}') format('woff2');font-weight:${f.weight};font-style:normal;font-display:swap}`;
}

/** The file to preload for one heading face (null for the CSS stacks). */
export function fontHref(typeface: ThemeTypeface): string | null {
  const f = headingFont(typeface);
  return f ? `/fonts/${f.file}` : null;
}

/** Every heading face at once — the editor's theme panel shows each name
 *  in its own face; the public site never loads this. */
export function allFontFaceCss(): string {
  return (Object.keys(HEADING_FONTS) as HeadingFontKey[])
    .map(k => fontFaceCss(k))
    .join('');
}

export interface ThemeAttrs {
  style?: CSSProperties;
  'data-typeface': ThemeTypeface;
  'data-surface': string;
  'data-template': string;
  'data-heading-font'?: '';
}

/** What a themed root wears (the public shell, the editor canvas). */
export function themeAttrs(site: ThemeSource): ThemeAttrs {
  const tokens = parseThemeTokens(site.theme_token_set);
  const { accent, strong } = resolveAccentPair(tokens);
  const font = headingFont(tokens.typeface);
  const style: Record<string, string> = {};
  if (tokens.accent || tokens.accentStrong) {
    style['--org-accent'] = accent;
    style['--org-accent-strong'] = strong;
    // B2: link TEXT on the white page — the luminance clamp guarantees 3:1
    // for white on the accent (the hero), not 4.5:1 for the accent on white.
    // `.org-scope` points --brand-fg at this; the fills keep the accent.
    style['--org-accent-fg'] = readableOn(strong, '#ffffff') ?? strong;
  }
  if (font) style['--org-heading-font'] = `'${font.family}', ${font.fallback}`;
  return {
    ...(Object.keys(style).length > 0 ? { style: style as CSSProperties } : {}),
    'data-typeface': tokens.typeface,
    'data-surface': tokens.surface,
    'data-template': templateSpec(site.template_id).id,
    ...(font ? { 'data-heading-font': '' as const } : {}),
  };
}
