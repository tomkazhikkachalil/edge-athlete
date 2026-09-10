'use client';

import { useEffect, useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { effectiveSpec } from '@/lib/org-sites/theme';
import { CONTENT_WIDGET_KEYS, WEB_WIDGET_KEYS, WIDGETS, type ContentWidgetKey, type SiteWidgetKey } from '@/lib/site-builder/catalog';
import { newInstanceFor, type SiteLayout } from '@/lib/site-builder/layout';
import WidgetBody from '@/app/(public)/org/[slug]/_components/WidgetBody';
import { effectiveAudience } from '@/lib/site-builder/audience';

/**
 * The add-widget picker — Site Builder P3-D (Sep 9 2026). Every option
 * previews with the club's OWN data ("they see their actual standings in
 * the tile, not a generic thumbnail"): one call to `…/site/widget-data?keys=`
 * for the widgets not yet on the layout, the same props-only WidgetBody the
 * canvas and the public page render. An empty widget says what fills it
 * (the catalog's staff line) and can still be added — the public page hides
 * it until it has content. One instance per module key — except the QUERY
 * widgets (phase 9: standings, schedule, leaders), offered again as "Add
 * another" so a second table can show a different competition — and the
 * hero is not offered: the site's identity, never removed, never doubled.
 *
 * Phase 6 (P6-B): a second list, "Your own content" — Text, Image, Embed —
 * always offered, any number of times; adding one opens its panel, because
 * a content tile is empty until the manager writes it.
 */
export interface PickerProps {
  site: PublicSite;
  layout: SiteLayout;
  plural: string;
  orgId: string;
  /** Phase 9: the canvas's data — previews for keys already on the page. */
  data: SiteHomeData | null;
  onAdd: (key: SiteWidgetKey, data: SiteHomeData | null) => void;
  onClose: () => void;
}

const CONTENT_BLURB: Record<ContentWidgetKey, string> = {
  text: 'Your own words — paragraphs, headings, a list of links.',
  image: 'One photo from your site’s assets, with a caption and a link.',
  embed: 'A YouTube or Vimeo video, or an OpenStreetMap map.',
};

const ADD = 'min-h-[36px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50';

export default function Picker({ site, layout, plural, orgId, data: canvasData, onAdd, onClose }: PickerProps) {
  const present = new Set(layout.widgets.map(w => w.key));
  // Fetch previews for the ABSENT keys only; a repeatable key already on the
  // page (phase 9: standings, schedule, leaders) previews from the canvas's
  // data and is listed with "Add another".
  const missing = WEB_WIDGET_KEYS.filter(k => k !== 'hero' && !present.has(k));
  const listed = WEB_WIDGET_KEYS.filter(k => k !== 'hero' && (!present.has(k) || WIDGETS[k].multiple));
  const keysParam = missing.join(',');
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data: SiteHomeData | null; empty: Record<string, boolean> }>({
    status: keysParam ? 'loading' : 'ready',
    data: null,
    empty: {},
  });

  useEffect(() => {
    if (!keysParam) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/widget-data?keys=${encodeURIComponent(keysParam)}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: SiteHomeData; empty: Record<string, boolean> };
        if (!cancelled) setState({ status: 'ready', data: body.data, empty: body.empty });
      } catch {
        if (!cancelled) setState({ status: 'error', data: null, empty: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plural, orgId, keysParam]);

  const nav = parseNavConfig(site.nav_config);
  const spec = effectiveSpec(site);

  return (
    <LargerWindow title="Add a section" windowKey="sb-picker" onClose={onClose}>
      <section aria-labelledby="sb-picker-content-heading" className="mb-5">
        <h3 id="sb-picker-content-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
          Your own content
        </h3>
        <ul className="grid gap-3 sm:grid-cols-3" data-sb-picker-content="">
          {CONTENT_WIDGET_KEYS.map(key => (
            <li key={key} className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-surface p-3" data-sb-picker-tile={key}>
              <div>
                <p className="text-sm font-medium text-primary">{WIDGETS[key].defaultTitle}</p>
                <p className="mt-1 text-xs text-tertiary">{CONTENT_BLURB[key]}</p>
              </div>
              <button type="button" onClick={() => onAdd(key, null)} className={ADD}>
                Add
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sb-picker-data-heading">
        <h3 id="sb-picker-data-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
          From your {site.side === 'club' ? 'club' : 'league'}’s data
        </h3>
        {listed.length === 0 ? (
          <p className="text-sm text-tertiary">Every data section is already on the page.</p>
        ) : state.status === 'error' ? (
          <p className="text-sm text-red-600">Could not load the previews. Close and try again.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Sections you can add" data-sb-picker="">
            {listed.map(key => {
              const title = moduleLabel(key, nav, site.side, site.sportKey);
              const again = present.has(key);
              // A present key previews from the canvas's own data; an absent one from the fetch.
              const previewData = again ? (canvasData ?? state.data) : (state.data ? { ...(canvasData ?? {}), ...state.data } as SiteHomeData : null);
              const empty = !again && state.empty[key] === true;
              const staff = WIDGETS[key].emptyState?.staff;
              const preview = previewData ? newInstanceFor(site, key, `probe:${key}`) : null;
              const ready = again ? !!previewData : state.status === 'ready';
              return (
                <li key={key} className="flex flex-col rounded-lg border border-border bg-surface overflow-hidden" data-sb-picker-tile={key}>
                  <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <span className="text-sm font-medium text-primary">{title}</span>
                    <button type="button" onClick={() => onAdd(key, previewData)} disabled={!ready} className={ADD}>
                      {again ? 'Add another' : 'Add'}
                    </button>
                  </div>
                  <div className="sb-widget-body max-h-48 overflow-hidden p-3 text-sm" aria-hidden="true">
                    {!preview || !previewData ? (
                      <div className="h-16 animate-pulse rounded bg-surface-sunken" />
                    ) : (
                      <WidgetBody site={site} w={preview} data={previewData} spec={spec} membersOnly={effectiveAudience(site, preview) === 'members'} />
                    )}
                  </div>
                  {again && (
                    <p className="border-t border-border px-3 py-2 text-xs text-tertiary">
                      Already on the page — a second one can show a different competition or venue.
                    </p>
                  )}
                  {empty && (
                    <p className="border-t border-border px-3 py-2 text-xs text-tertiary">
                      Empty for now — {staff?.label ?? 'it fills itself as the season goes'}. Visitors won’t see it until it has content.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </LargerWindow>
  );
}
