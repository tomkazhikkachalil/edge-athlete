'use client';

import { useState } from 'react';
import type { PublicSite } from '@/lib/org-sites/server';
import { contrastRatio } from '@/lib/org-sites/accent-contrast';
import { TEMPLATE_IDS, templateSpec, type TemplateId } from '@/lib/org-sites/templates';
import { HEADING_FONTS, TYPEFACE_LABEL, allFontFaceCss, headingFont } from '@/lib/org-sites/theme';
import {
  ACCENT_MAX_LUMINANCE,
  HEX_COLOR_RE,
  THEME_DENSITIES,
  THEME_HEADERS,
  THEME_HEROES,
  THEME_SURFACES,
  THEME_TEAMS,
  THEME_TYPEFACES,
  WORDMARK_MAX,
  hexLuminance,
  parseThemeTokens,
} from '@/lib/org-sites/validate';

/**
 * The theme panel — Site Builder P7-B (Sep 9 2026). The brand in one pane:
 * start from a template, the accent (with a live contrast readout against
 * the white text the hero and band carry), its strong companion, the
 * surface tint, the heading face — each name shown IN its face — the four
 * design decisions the template used to own (header, hero, density, teams;
 * "Template default" keeps the seed's), and the wordmark.
 *
 * Every change previews LIVE on the canvas (the editor lays the draft
 * tokens over the site it hands the canvas); nothing is written until
 * Save, which goes through the console's own actions — `set_template`
 * (when the seed changed) then `set_theme` with the whole token set — so
 * the Website section and the editor can never disagree. Saved to the
 * DRAFT: nothing goes live until Publish.
 */
export interface ThemeDraft {
  templateId: TemplateId;
  tokens: Record<string, unknown>;
}

export interface ThemePanelProps {
  site: PublicSite;
  draft: ThemeDraft;
  onChange: (next: ThemeDraft) => void;
  onSaved: () => Promise<void>;
  onClose: () => void;
  plural: string;
  orgId: string;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const LABEL = 'block text-xs font-medium text-secondary mb-1';
const PILL = 'min-h-[36px] rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const CTA = 'min-h-[36px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** The draft the panel opens with — the site's current template + tokens. */
export function themeDraftFrom(site: { template_id: string; theme_token_set: unknown }): ThemeDraft {
  const t = parseThemeTokens(site.theme_token_set);
  const tokens: Record<string, unknown> = {};
  if (t.accent) tokens.accent = t.accent;
  if (t.accentStrong) tokens.accentStrong = t.accentStrong;
  if (t.surface !== 'plain') tokens.surface = t.surface;
  if (t.typeface !== 'sans') tokens.typeface = t.typeface;
  if (t.wordmark) tokens.wordmark = t.wordmark;
  for (const k of ['header', 'hero', 'density', 'teams'] as const) if (t[k]) tokens[k] = t[k];
  return { templateId: templateSpec(site.template_id).id, tokens };
}

/** The accent's standing against the white text it will carry. */
export function accentVerdict(hex: string): { ok: boolean; ratio: number | null; message: string } {
  if (!hex) return { ok: true, ratio: null, message: 'Default violet.' };
  if (!HEX_COLOR_RE.test(hex)) return { ok: false, ratio: null, message: 'Use a #rrggbb colour.' };
  const ratio = contrastRatio(hex, '#ffffff');
  if (hexLuminance(hex) > ACCENT_MAX_LUMINANCE) return { ok: false, ratio, message: `${ratio.toFixed(1)}:1 with white text — too light. Pick a darker colour.` };
  return { ok: true, ratio, message: `${ratio.toFixed(1)}:1 with white text — readable.` };
}

type DesignKey = 'header' | 'hero' | 'density' | 'teams';
const DESIGN: { key: DesignKey; label: string; options: readonly string[]; names: Record<string, string> }[] = [
  { key: 'header', label: 'Header', options: THEME_HEADERS, names: { bar: 'White bar', band: 'Colour band' } },
  { key: 'hero', label: 'Welcome', options: THEME_HEROES, names: { card: 'Card', bleed: 'Full width' } },
  { key: 'density', label: 'Spacing', options: THEME_DENSITIES, names: { comfortable: 'Comfortable', compact: 'Compact' } },
  { key: 'teams', label: 'Teams', options: THEME_TEAMS, names: { chips: 'Name chips', tiles: 'Tiles' } },
];

export default function ThemePanel({ site, draft, onChange, onSaved, onClose, plural, orgId, showError, showSuccess }: ThemePanelProps) {
  const [saving, setSaving] = useState(false);
  const tokens = parseThemeTokens(draft.tokens);
  const seed = templateSpec(draft.templateId);
  const accentHex = typeof draft.tokens.accent === 'string' ? draft.tokens.accent : '';
  const strongHex = typeof draft.tokens.accentStrong === 'string' ? draft.tokens.accentStrong : '';
  const accent = accentVerdict(accentHex);
  const strong = accentVerdict(strongHex);
  const valid = accent.ok && strong.ok;
  const changed = JSON.stringify(themeDraftFrom(site)) !== JSON.stringify(draft);

  const set = (patch: Record<string, unknown>) => {
    const next = { ...draft.tokens };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') delete next[k];
      else next[k] = v;
    }
    onChange({ ...draft, tokens: next });
  };
  const chooseTemplate = (templateId: TemplateId) => {
    // "Apply the seed": the template's decisions show through (its design
    // overrides go; colours, face and wordmark stay) — the server does the same.
    const next = { ...draft.tokens };
    for (const k of ['header', 'hero', 'density', 'teams']) delete next[k];
    onChange({ templateId, tokens: next });
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const patch = async (body: Record<string, unknown>) => {
        const res = await fetch(`/api/${plural}/${orgId}/site`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error || 'Could not save the theme');
      };
      if (draft.templateId !== templateSpec(site.template_id).id) await patch({ action: 'set_template', templateId: draft.templateId });
      await patch({
        action: 'set_theme',
        accent: accentHex || null,
        accentStrong: strongHex || null,
        surface: tokens.surface,
        typeface: tokens.typeface,
        ...(tokens.wordmark ? { wordmark: tokens.wordmark } : {}),
        // Every design key named: a value sets, null clears (back to the seed).
        header: tokens.header,
        hero: tokens.hero,
        density: tokens.density,
        teams: tokens.teams,
      });
      await onSaved();
      showSuccess('Website', 'Theme saved to your draft');
    } catch (e) {
      showError('Website', e instanceof Error ? e.message : 'Could not save the theme');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="w-80 shrink-0 rounded-xl border border-border bg-surface p-4 space-y-4" aria-label="Theme" data-sb-theme-panel="">
      {/* Every heading face, so each name can show in its own face — the
          editor only; the public site loads one face at most. */}
      <style dangerouslySetInnerHTML={{ __html: allFontFaceCss() }} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Brand</p>
          <h2 className="text-base font-semibold text-primary">Theme</h2>
        </div>
        <button type="button" onClick={onClose} className="ea-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:text-primary hover:bg-surface-sunken" aria-label="Close theme panel">
          ×
        </button>
      </div>

      <fieldset className="space-y-2">
        <legend className={LABEL}>Start from</legend>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATE_IDS.map(id => {
            const t = templateSpec(id);
            const current = draft.templateId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => chooseTemplate(id)}
                aria-pressed={current}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${current ? 'border-brand bg-brand-soft text-primary' : 'border-border-strong text-secondary hover:bg-surface-sunken'}`}
              >
                <span className="block font-medium">{t.name}</span>
                <span className="block text-xs text-tertiary">{t.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label className={LABEL} htmlFor="sb-theme-accent">
          Accent colour
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick an accent colour"
            value={HEX_COLOR_RE.test(accentHex) ? accentHex : '#8b5cf6'}
            onChange={e => set({ accent: e.target.value.toLowerCase() })}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-0.5"
          />
          <input id="sb-theme-accent" type="text" value={accentHex} placeholder="#8b5cf6" maxLength={7} onChange={e => set({ accent: e.target.value.trim().toLowerCase() })} className={INPUT} />
          {accentHex && (
            <button type="button" onClick={() => set({ accent: null, accentStrong: null })} className={PILL}>
              Reset
            </button>
          )}
        </div>
        <p className={`mt-1 text-xs ${accent.ok ? 'text-tertiary' : 'text-red-600'}`} data-sb-accent-ok={accent.ok ? '1' : '0'}>
          {accent.message}
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor="sb-theme-strong">
          Strong accent <span className="font-normal text-tertiary">(gradient end, links)</span>
        </label>
        <div className="flex items-center gap-2">
          <input id="sb-theme-strong" type="text" value={strongHex} placeholder="Auto from the accent" maxLength={7} onChange={e => set({ accentStrong: e.target.value.trim().toLowerCase() })} className={INPUT} />
          {strongHex && (
            <button type="button" onClick={() => set({ accentStrong: null })} className={PILL}>
              Auto
            </button>
          )}
        </div>
        {strongHex && <p className={`mt-1 text-xs ${strong.ok ? 'text-tertiary' : 'text-red-600'}`}>{strong.message}</p>}
      </div>

      <div>
        <label className={LABEL} htmlFor="sb-theme-surface">
          Background
        </label>
        <select id="sb-theme-surface" value={tokens.surface} onChange={e => set({ surface: e.target.value === 'plain' ? null : e.target.value })} className={INPUT}>
          {THEME_SURFACES.map(s => (
            <option key={s} value={s}>
              {s === 'plain' ? 'Plain white' : 'Tinted with the accent'}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className={LABEL}>Headings</legend>
        <ul className="grid grid-cols-2 gap-2" aria-label="Heading typeface">
          {THEME_TYPEFACES.map(t => {
            const f = headingFont(t);
            const current = tokens.typeface === t;
            return (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => set({ typeface: t === 'sans' ? null : t })}
                  aria-pressed={current}
                  data-sb-typeface={t}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${current ? 'border-brand bg-brand-soft' : 'border-border-strong hover:bg-surface-sunken'}`}
                  style={f ? { fontFamily: `'${f.family}', ${f.fallback}` } : t === 'serif' ? { fontFamily: "Georgia, 'Times New Roman', serif" } : undefined}
                >
                  <span className="block text-base font-bold text-primary">{TYPEFACE_LABEL[t]}</span>
                  <span className="block text-xs text-tertiary" style={{ fontFamily: 'inherit' }}>
                    {f ? HEADING_FONTS[t as keyof typeof HEADING_FONTS].blurb : t === 'serif' ? 'A classic serif stack.' : 'The default sans.'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {DESIGN.map(d => (
        <div key={d.key}>
          <label className={LABEL} htmlFor={`sb-theme-${d.key}`}>
            {d.label}
          </label>
          <select id={`sb-theme-${d.key}`} value={tokens[d.key] ?? ''} onChange={e => set({ [d.key]: e.target.value || null })} className={INPUT}>
            <option value="">{`Template default (${d.names[seed[d.key]]})`}</option>
            {d.options.map(o => (
              <option key={o} value={o}>
                {d.names[o]}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div>
        <label className={LABEL} htmlFor="sb-theme-wordmark">
          Wordmark <span className="font-normal text-tertiary">(replaces the name in the header)</span>
        </label>
        <input id="sb-theme-wordmark" type="text" maxLength={WORDMARK_MAX} value={tokens.wordmark ?? ''} placeholder={site.orgName} onChange={e => set({ wordmark: e.target.value })} className={INPUT} />
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <button type="button" onClick={() => void save()} disabled={!valid || !changed || saving} className={CTA}>
          {saving ? 'Saving…' : 'Save theme'}
        </button>
        <button type="button" onClick={onClose} className={PILL}>
          {changed ? 'Discard' : 'Close'}
        </button>
      </div>
      <p className="text-xs text-tertiary">The canvas previews every change. Saves to your draft — nothing goes live until you publish.</p>
    </aside>
  );
}

