'use client';

import { useMemo } from 'react';
import { GridLayout, useContainerWidth, type EventCallback, type Layout as RglLayout, type LayoutItem as RglItem } from 'react-grid-layout';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { effectiveSpec, fontFaceCss, themeAttrs } from '@/lib/org-sites/theme';
import { parseThemeTokens } from '@/lib/org-sites/validate';
import { WIDGETS } from '@/lib/site-builder/catalog';
import { GRID, compactLayout, type SiteLayout, type WidgetInstance } from '@/lib/site-builder/layout';
import HeroSection from '@/app/(public)/org/[slug]/_components/HeroSection';
import WidgetBody, { widgetTitle } from '@/app/(public)/org/[slug]/_components/WidgetBody';
import { effectiveAudience } from '@/lib/site-builder/audience';
import './grid.css';

/**
 * The canvas — Site Builder P3-B (Sep 9 2026): the REAL page with the
 * club's REAL data on react-grid-layout. Every tile is a WidgetFrame around
 * the same props-only component the public home renders (HeroSection /
 * WidgetBody), so what a manager drags is what visitors see. The body is
 * inert (`.sb-widget-body` — pointer-events none) so the tile is the drag
 * target and a link never navigates the editor away.
 *
 * One breakpoint on purpose: the doc derives mobile from desktop reading
 * order, so the editor never asks anyone to lay out a second width. Sizes
 * come from the catalog's constraints (min/max W/H — the grid refuses what
 * would look bad); `h` is a MINIMUM height, so a tall body may overflow its
 * tile here until the manager gives it room — the public renderer grows.
 * Commits happen on drag/resize STOP: one gesture, one undo step.
 */
export interface CanvasProps {
  site: PublicSite;
  layout: SiteLayout;
  data: SiteHomeData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (next: SiteLayout) => void;
  /** P3-D: remove a tile (the hero is never removable). */
  onRemove: (id: string) => void;
}

function toRgl(layout: SiteLayout): RglLayout {
  return layout.widgets.map<RglItem>(w => {
    const c = WIDGETS[w.key].constraints;
    return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: c.minW, maxW: c.maxW, minH: c.minH, maxH: c.maxH };
  });
}

function fromRgl(layout: SiteLayout, items: RglLayout): SiteLayout {
  const byId = new Map(items.map(i => [i.i, i]));
  const widgets: WidgetInstance[] = layout.widgets.map(w => {
    const i = byId.get(w.id);
    return i ? { ...w, x: i.x, y: i.y, w: i.w, h: i.h } : w;
  });
  return { ...layout, widgets: compactLayout(widgets) };
}

export default function Canvas({ site, layout, data, selectedId, onSelect, onCommit, onRemove }: CanvasProps) {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1024 });
  // Phase 7: the canvas wears the site's theme (accent, surface, heading
  // face) exactly as the public shell does — before this it showed the
  // violet defaults for every site.
  const spec = effectiveSpec(site);
  const attrs = themeAttrs(site);
  const fontCss = fontFaceCss(parseThemeTokens(site.theme_token_set).typeface);
  const rgl = useMemo(() => toRgl(layout), [layout]);

  const commit: EventCallback = next => {
    const changed = fromRgl(layout, next);
    if (JSON.stringify(changed.widgets) !== JSON.stringify(layout.widgets)) onCommit(changed);
  };

  return (
    <div ref={containerRef} className="sb-canvas org-scope rounded-xl border border-border bg-canvas p-4" data-sb-canvas="" {...attrs}>
      {fontCss && <style dangerouslySetInnerHTML={{ __html: fontCss }} />}
      <GridLayout
        width={width}
        layout={rgl}
        gridConfig={{ cols: GRID.cols, rowHeight: GRID.rowPx, margin: [GRID.gapPx, GRID.gapPx], containerPadding: [0, 0] }}
        // Drag by the tile's title bar (its grab cursor says so); anything
        // marked .sb-no-drag inside a tile (future frame buttons) never starts one.
        dragConfig={{ enabled: true, bounded: true, handle: '.sb-frame-controls', cancel: '.sb-no-drag' }}
        resizeConfig={{ enabled: true, handles: ['se'] }}
        // Selection rides the grid's own drag-start (the drag library owns
        // mousedown on the handle) and a plain click anywhere on the tile.
        onDragStart={(_layout, item) => onSelect(item?.i ?? null)}
        onDragStop={commit}
        onResizeStart={(_layout, item) => onSelect(item?.i ?? null)}
        onResizeStop={commit}
      >
        {layout.widgets.map(w => {
          const selected = selectedId === w.id;
          const title = w.key === 'hero' ? 'Hero' : widgetTitle(site, w);
          return (
            <div
              key={w.id}
              className={`sb-frame flex flex-col rounded-lg border bg-surface shadow-sm overflow-hidden ${
                selected ? 'border-brand ring-2 ring-brand/40' : 'border-border'
              }`}
              data-sb-widget={w.key}
              data-sb-instance={w.id}
              onClick={() => onSelect(w.id)}
            >
              <div className="sb-frame-controls flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-secondary cursor-grab">
                <span className="truncate font-medium text-primary">{title}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-muted">
                    {w.w}×{w.h}
                  </span>
                  {w.key !== 'hero' && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onRemove(w.id);
                      }}
                      onMouseDown={e => e.stopPropagation()}
                      aria-label={`Remove ${title}`}
                      title="Remove (Undo from the toast)"
                      className="sb-no-drag ea-icon-btn inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-primary hover:bg-surface-sunken"
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
              <div className="sb-widget-body min-h-0 flex-1 overflow-hidden p-3">
                {w.key === 'hero' ? (
                  <HeroSection site={site} w={w} spec={spec} />
                ) : (
                  <WidgetBody site={site} w={w} data={data} spec={spec} membersOnly={effectiveAudience(site, w) === 'members'} />
                )}
              </div>
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}
