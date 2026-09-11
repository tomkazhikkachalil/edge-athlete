'use client';

import { useState, type CSSProperties } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import type { PublicSite } from '@/lib/org-sites/server';
import { moduleLabel, parseNavConfig, parseThemeTokens, resolveAccentPair } from '@/lib/org-sites/validate';
import { templateSpec } from '@/lib/org-sites/templates';
import { WIDGETS, isContentWidgetKey } from '@/lib/site-builder/catalog';
import { GALLERY_MODES, type GalleryMode } from '@/lib/site-builder/gallery-ids';
import { MAP_ID, WELCOME_ID, galleryEntriesFor, galleryMap, gallerySeed, type GalleryEntry, type GalleryOrg } from '@/lib/site-builder/gallery';
import { GRID, type SiteLayout } from '@/lib/site-builder/layout';

/**
 * The template gallery — Site Builder P11-B (Sep 9 2026). "Start from a
 * design": the six entries for this org's side × sport, each drawn as a
 * block diagram of the SEED IT WOULD APPLY — computed here from the same
 * `gallerySeed` the server runs, over the org facts the canvas GET carries
 * (`gallery`), so the picture never lies: the welcome tile shows the real
 * generated heading, the map names the real venue, a module the org has
 * not enabled is simply not there. No iframes, no data fetches.
 *
 * "Keep my sections" (default) lays the plan over what the manager has;
 * "Start clean" clears their content tiles and repeats first. "Use this"
 * → `PATCH apply_gallery` → the editor RELOADS from the server (a fresh
 * rev, no undo entry — the console's Discard draft is the escape hatch).
 * Auto-opened on the first visit to a never-arranged, never-published site;
 * "Skip" keeps the starting layout.
 */
export interface GalleryProps {
  site: PublicSite;
  org: GalleryOrg;
  plural: string;
  orgId: string;
  /** Opened by the editor itself on a fresh site (shows Skip). */
  auto: boolean;
  /** H7: the layout the manager sees is not yet the draft's. */
  dirty: boolean;
  /** Save the pending edit now; resolves to whether the draft is clean. */
  onFlush: () => Promise<boolean>;
  onApplied: () => void;
  onClose: () => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

const MODE_COPY: Record<GalleryMode, { label: string; hint: string }> = {
  keep: { label: 'Keep my sections', hint: 'Your sections and words stay; the design re-arranges them and adds what it brings.' },
  clean: { label: 'Start clean', hint: 'Your own text, photos and repeated sections go; the design starts over.' },
};

const USE = 'min-h-[36px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const PILL = 'min-h-[36px] rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-sunken transition-colors';

export default function Gallery({ site, org, plural, orgId, auto, dirty, onFlush, onApplied, onClose, showError, showSuccess }: GalleryProps) {
  const [mode, setMode] = useState<GalleryMode>('keep');
  const [busyId, setBusyId] = useState<string | null>(null);
  const entries = galleryEntriesFor(site.side, site.sportKey);
  const shape = { hero_config: site.hero_config, contact_config: site.contact_config, visibility: site.visibility, modules: site.modules };
  const nav = parseNavConfig(site.nav_config);
  const tokens = parseThemeTokens(site.theme_token_set);
  const { accent, strong } = resolveAccentPair(tokens);
  const wordmark = tokens.wordmark?.trim() || site.orgName;
  const label = (key: string) => (isContentWidgetKey(key) ? WIDGETS[key as 'text'].defaultTitle ?? key : moduleLabel(key, nav, site.side, site.sportKey));

  const use = async (entry: GalleryEntry) => {
    setBusyId(entry.id);
    try {
      // H7: the server re-lays ITS copy of the draft — a drag still inside the
      // autosave debounce would be lost. Save it first; refuse when it cannot be.
      if (dirty && !(await onFlush())) {
        showError('Website', 'Your last change hasn’t saved yet — try again in a moment.');
        return;
      }
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_gallery', entryId: entry.id, mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Website', body.error || 'Could not apply the design');
        return;
      }
      showSuccess('Website', `${entry.name} applied to your draft — publish when you’re ready`);
      onApplied();
    } catch {
      showError('Website', 'Could not apply the design');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <LargerWindow title="Start from a design" subtitle={auto ? 'A good page in minutes — pick one, then make it yours. Nothing goes live until you publish.' : 'Each design re-arranges your page; your words and colours stay yours.'} onClose={onClose} windowKey="sb-gallery">
      <div className="space-y-4" data-sb-gallery="">
        <fieldset className="flex flex-wrap gap-2" aria-label="How to apply">
          {GALLERY_MODES.map(m => (
            <label key={m} className={`flex min-w-[220px] flex-1 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${mode === m ? 'border-brand bg-brand-soft' : 'border-border-strong'}`}>
              <input type="radio" name="sb-gallery-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" data-sb-gallery-mode={m} />
              <span>
                <span className="block font-medium text-primary">{MODE_COPY[m].label}</span>
                <span className="block text-xs text-tertiary">{MODE_COPY[m].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <ul className="grid gap-4 sm:grid-cols-2">
          {entries.map(entry => {
            const seed = gallerySeed(entry, { ...shape, template_id: entry.family }, org, site.side, site.sportKey);
            const family = templateSpec(entry.family);
            return (
              <li key={entry.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3" data-sb-gallery-card={entry.id}>
                <GalleryThumb seed={seed} entry={entry} accent={accent} strong={strong} wordmark={wordmark} label={label} venueName={galleryMap(org)?.venueName ?? null} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">
                      {entry.name} <span className="ml-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">{family.name}</span>
                    </p>
                    <p className="text-xs text-tertiary">{entry.blurb}</p>
                  </div>
                  <button type="button" onClick={() => void use(entry)} disabled={busyId !== null} className={USE} data-sb-gallery-use="" title={dirty ? 'Your pending change is saved first' : undefined}>
                    {busyId === entry.id ? 'Applying…' : 'Use this'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
          <p className="text-xs text-tertiary">A design is a start — every section still moves, resizes and can be removed afterwards.</p>
          <button type="button" onClick={onClose} className={PILL} data-sb-gallery-skip="">
            {auto ? 'Skip — keep the starting layout' : 'Close'}
          </button>
        </div>
      </div>
    </LargerWindow>
  );
}

/** A 12-column block diagram of the seed: the hero as the accent gradient
 *  with the wordmark, the header strip shaped by the entry's tokens, each
 *  block titled — the welcome by its REAL generated heading, the map by the
 *  venue. Heights are row-proportional; nothing renders live data. */
export function GalleryThumb({
  seed,
  entry,
  accent,
  strong,
  wordmark,
  label,
  venueName,
}: {
  seed: SiteLayout;
  entry: GalleryEntry;
  accent: string;
  strong: string;
  wordmark: string;
  label: (key: string) => string;
  venueName: string | null;
}) {
  const family = templateSpec(entry.family);
  const header = entry.tokens.header ?? family.header;
  const heroStyle = entry.tokens.hero ?? family.hero;
  const compact = (entry.tokens.density ?? family.density) === 'compact';
  const rowPx = compact ? 7 : 9;
  const gap = 3;
  const font = entry.tokens.typeface === 'playfair' || entry.tokens.typeface === 'lora' ? 'Georgia, serif' : entry.tokens.typeface === 'oswald' ? "Impact, 'Arial Narrow', sans-serif" : undefined;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-white" style={{ aspectRatio: '280 / 170' }} aria-hidden="true">
      <div className={`flex items-center px-2 ${header === 'band' ? 'h-5 text-white' : 'h-4 border-b border-gray-200 text-gray-800'}`} style={header === 'band' ? { background: strong } : undefined}>
        <span className="truncate text-[8px] font-semibold" style={{ fontFamily: font }}>
          {wordmark}
        </span>
        <span className="ml-auto flex gap-1">
          <span className="h-1 w-3 rounded bg-current opacity-60" />
          <span className="h-1 w-3 rounded bg-current opacity-60" />
          <span className="h-1 w-3 rounded bg-current opacity-60" />
        </span>
      </div>
      <div className={heroStyle === 'bleed' ? '' : 'p-1.5'}>
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${GRID.cols}, minmax(0, 1fr))`, gridAutoRows: `${rowPx}px`, gap: `${gap}px`, padding: heroStyle === 'bleed' ? '0 6px 6px' : undefined }}
        >
          {seed.widgets.map(w => {
            const isHero = w.key === 'hero';
            const isWelcome = w.id === WELCOME_ID;
            const isMap = w.id === MAP_ID;
            const heading = isWelcome ? readHeading(w.config) : null;
            const text = isHero ? wordmark : isMap ? `Map · ${venueName ?? 'venue'}` : heading ?? label(w.key);
            const style: CSSProperties = {
              gridColumn: `${w.x + 1} / span ${w.w}`,
              gridRow: `${w.y + 1} / span ${w.h}`,
              ...(isHero ? { background: `linear-gradient(135deg, ${accent}, ${strong})`, color: '#fff', borderRadius: heroStyle === 'bleed' ? '0 0 6px 6px' : '4px', marginLeft: heroStyle === 'bleed' ? -6 : 0, marginRight: heroStyle === 'bleed' ? -6 : 0 } : {}),
            };
            return (
              <div
                key={w.id}
                style={style}
                className={`flex min-w-0 items-start overflow-hidden rounded px-1 py-0.5 text-[7px] leading-tight ${isHero ? 'font-bold' : isWelcome || isMap ? 'border border-dashed border-gray-300 bg-gray-50 text-gray-700' : 'border border-gray-200 bg-gray-50 text-gray-600'}`}
                data-sb-thumb={w.key}
              >
                <span className="truncate" style={isHero ? { fontFamily: font } : undefined}>
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function readHeading(config: unknown): string | null {
  const blocks = config && typeof config === 'object' ? (config as { blocks?: unknown }).blocks : null;
  if (!Array.isArray(blocks)) return null;
  const h = blocks.find(b => b && typeof b === 'object' && (b as { type?: string }).type === 'heading') as { text?: string } | undefined;
  return typeof h?.text === 'string' ? h.text : null;
}
