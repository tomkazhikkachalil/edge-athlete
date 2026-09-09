import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_TYPEFACES } from '../validate';
import { HEADING_FONTS, TYPEFACE_LABEL, allFontFaceCss, effectiveSpec, fontFaceCss, fontHref, headingFont, themeAttrs } from '../theme';

// Site Builder phase 7: the template's decisions become tokens with the
// template as fallback; heading faces are self-hosted OFL files a site
// loads only when it picks one; one helper dresses every themed root.
describe('effectiveSpec — tokens over the template', () => {
  it('falls back to the template on every axis when no token is set', () => {
    expect(effectiveSpec({ template_id: 'bold', theme_token_set: {} })).toMatchObject({ id: 'bold', header: 'band', hero: 'bleed', density: 'compact', teams: 'tiles', sections: 'grid' });
    expect(effectiveSpec({ template_id: 'classic', theme_token_set: null })).toMatchObject({ id: 'classic', header: 'bar', hero: 'card', density: 'comfortable', teams: 'chips' });
  });
  it('a token overrides its axis only; sections stay the template’s (the layout owns them)', () => {
    const spec = effectiveSpec({ template_id: 'classic', theme_token_set: { header: 'band', density: 'compact' } });
    expect(spec).toMatchObject({ id: 'classic', header: 'band', hero: 'card', density: 'compact', teams: 'chips', sections: 'stack' });
    expect(effectiveSpec({ template_id: 'bold', theme_token_set: { header: 'nope', hero: 'card' } })).toMatchObject({ header: 'band', hero: 'card' });
  });
});

describe('heading faces', () => {
  it('every face maps to a file that exists under public/fonts, with our own family name', () => {
    for (const [key, f] of Object.entries(HEADING_FONTS)) {
      expect(existsSync(join(process.cwd(), 'public', 'fonts', f.file)), `${key}: ${f.file}`).toBe(true);
      expect(f.family.startsWith('EA '), key).toBe(true);
      expect(THEME_TYPEFACES).toContain(key);
    }
    // Every typeface token has a label; the two stacks have no file.
    for (const t of THEME_TYPEFACES) expect(TYPEFACE_LABEL[t]).toBeTruthy();
    expect(headingFont('sans')).toBeNull();
    expect(headingFont('serif')).toBeNull();
    expect(Object.keys(HEADING_FONTS).sort()).toEqual(THEME_TYPEFACES.filter(t => t !== 'sans' && t !== 'serif').sort());
  });
  it('fontFaceCss / fontHref: one face → its @font-face and file; the stacks → nothing', () => {
    expect(fontFaceCss('oswald')).toBe("@font-face{font-family:'EA Oswald';src:url('/fonts/oswald-600.woff2') format('woff2');font-weight:600;font-style:normal;font-display:swap}");
    expect(fontHref('oswald')).toBe('/fonts/oswald-600.woff2');
    expect(fontFaceCss('sans')).toBeNull();
    expect(fontHref('serif')).toBeNull();
    const all = allFontFaceCss();
    for (const f of Object.values(HEADING_FONTS)) expect(all).toContain(f.file);
  });
});

describe('themeAttrs — what a themed root wears', () => {
  it('a default-themed site sets no style (the stylesheet’s violet stays) and the plain attributes', () => {
    expect(themeAttrs({ template_id: 'classic', theme_token_set: {} })).toEqual({ 'data-typeface': 'sans', 'data-surface': 'plain', 'data-template': 'classic' });
  });
  it('an accent sets both vars; a heading face sets the property + the attribute; junk is dropped', () => {
    const a = themeAttrs({ template_id: 'bold', theme_token_set: { accent: '#0B3D91', typeface: 'lora', surface: 'tinted' } });
    expect(a.style).toEqual({ '--org-accent': '#0b3d91', '--org-accent-strong': '#09347b', '--org-heading-font': "'EA Lora', Georgia, 'Times New Roman', serif" });
    expect(a['data-typeface']).toBe('lora');
    expect(a['data-surface']).toBe('tinted');
    expect(a['data-template']).toBe('bold');
    expect(a['data-heading-font']).toBe('');
    const junk = themeAttrs({ template_id: 'x', theme_token_set: { accent: 'url(javascript:1)', typeface: 'comic' } });
    expect(junk.style).toBeUndefined();
    expect(junk['data-heading-font']).toBeUndefined();
    expect(junk['data-template']).toBe('classic');
  });
});
