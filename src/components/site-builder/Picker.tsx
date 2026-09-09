'use client';

import { useEffect, useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { templateSpec } from '@/lib/org-sites/templates';
import { WEB_WIDGET_KEYS, WIDGETS, type WebWidgetKey } from '@/lib/site-builder/catalog';
import { newInstanceFor, type SiteLayout } from '@/lib/site-builder/layout';
import WidgetBody from '@/app/(public)/org/[slug]/_components/WidgetBody';

/**
 * The add-widget picker — Site Builder P3-D (Sep 9 2026). Every option
 * previews with the club's OWN data ("they see their actual standings in
 * the tile, not a generic thumbnail"): one call to `…/site/widget-data?keys=`
 * for the widgets not yet on the layout, the same props-only WidgetBody the
 * canvas and the public page render. An empty widget says what fills it
 * (the catalog's staff line) and can still be added — the public page hides
 * it until it has content. One instance per key for now (the hero is not
 * offered: the site's identity, never removed, never doubled).
 */
export interface PickerProps {
  site: PublicSite;
  layout: SiteLayout;
  plural: string;
  orgId: string;
  onAdd: (key: WebWidgetKey, data: SiteHomeData) => void;
  onClose: () => void;
}

export default function Picker({ site, layout, plural, orgId, onAdd, onClose }: PickerProps) {
  const present = new Set(layout.widgets.map(w => w.key));
  const missing = WEB_WIDGET_KEYS.filter(k => k !== 'hero' && !present.has(k));
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data: SiteHomeData | null; empty: Record<string, boolean> }>({
    status: 'loading',
    data: null,
    empty: {},
  });
  const keysParam = missing.join(',');

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
  const spec = templateSpec(site.template_id);

  return (
    <LargerWindow title="Add a section" windowKey="sb-picker" onClose={onClose}>
      {missing.length === 0 ? (
        <p className="text-sm text-tertiary">Every section is already on the page.</p>
      ) : state.status === 'error' ? (
        <p className="text-sm text-red-600">Could not load the previews. Close and try again.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Sections you can add" data-sb-picker="">
          {missing.map(key => {
            const title = moduleLabel(key, nav, site.side, site.sportKey);
            const empty = state.empty[key] === true;
            const staff = WIDGETS[key].emptyState?.staff;
            const preview = state.data ? newInstanceFor(site, key, `probe:${key}`) : null;
            return (
              <li key={key} className="flex flex-col rounded-lg border border-border bg-surface overflow-hidden" data-sb-picker-tile={key}>
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-sm font-medium text-primary">{title}</span>
                  <button
                    type="button"
                    onClick={() => state.data && onAdd(key, state.data)}
                    disabled={state.status !== 'ready'}
                    className="min-h-[36px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <div className="sb-widget-body max-h-48 overflow-hidden p-3 text-sm" aria-hidden="true">
                  {state.status === 'loading' || !preview || !state.data ? (
                    <div className="h-16 animate-pulse rounded bg-surface-sunken" />
                  ) : (
                    <WidgetBody site={site} w={preview} data={state.data} spec={spec} />
                  )}
                </div>
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
    </LargerWindow>
  );
}
