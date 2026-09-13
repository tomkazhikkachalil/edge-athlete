'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GridLayout, useContainerWidth, type EventCallback, type Layout as RglLayout } from 'react-grid-layout';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { effectiveSpec, fontFaceCss, themeAttrs } from '@/lib/org-sites/theme';
import { parseThemeTokens } from '@/lib/org-sites/validate';
import { GRID, type SiteLayout } from '@/lib/site-builder/layout';
import { commitGesture, toRglItems, type MeasuredRows } from '@/lib/site-builder/canvas-rgl';
import { fitOf, rowsForContent, type FitHeight } from '@/lib/site-builder/fit';
import HeroSection from '@/app/(public)/org/[slug]/_components/HeroSection';
import WidgetBody, { widgetTitle } from '@/app/(public)/org/[slug]/_components/WidgetBody';
import { effectiveAudience } from '@/lib/site-builder/audience';
import { sampleInstance } from '@/lib/site-builder/sample';
import SampleFrame from './SampleFrame';
import './grid.css';

/**
 * The canvas — Site Builder P3-B (Sep 9 2026): the REAL page with the
 * club's REAL data on react-grid-layout. Every tile is a WidgetFrame around
 * the same props-only component the public home renders (HeroSection /
 * WidgetBody), so what a manager drags is what visitors see. The body's
 * CONTENT is inert (`.sb-measure` — pointer-events none) so the tile is
 * the drag target and a link never navigates the editor away.
 *
 * One breakpoint on purpose: the doc derives mobile from desktop reading
 * order, so the editor never asks anyone to lay out a second width. Sizes
 * come from the catalog's constraints (min/max W/H — the grid refuses what
 * would look bad). Commits happen on drag/resize STOP: one gesture, one
 * undo step.
 *
 * Program 3, H2 — sections auto-size: ONE ResizeObserver measures every
 * tile's content (`.sb-measure`, a content-sized block whose height depends
 * on the width only — what breaks the feedback loop) and the grid shows an
 * auto tile at `displayH` (its content, never below its stored `h`); a
 * FIXED tile keeps `h` and scrolls inside. Measurements FREEZE during a
 * gesture (react-grid-layout re-syncs its `layout` prop mid-resize) and
 * flush after the commit. The measured height is never persisted:
 * `commitGesture` copies x / y / w back and only a gesture that changed
 * the height touches the stored `h` (the fit rule — below the content →
 * fixed, with the Undo toast). One honest divergence, recorded here: CSS
 * grid row tracks are global across columns, so on the public page a tall
 * widget pushes a neighbour in ANOTHER column lower than the canvas does;
 * the public page always pushes at least as much — nothing overlaps.
 */
export interface CanvasProps {
  site: PublicSite;
  layout: SiteLayout;
  data: SiteHomeData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** H2: `flipped` names a fit change the gesture caused ('fixed' = the
   *  manager dragged the tile below its content; 'auto' = back up to it). */
  onCommit: (next: SiteLayout, flipped?: FitHeight | null) => void;
  /** P3-D: remove a tile (the hero is never removable). */
  onRemove: (id: string) => void;
  /** Program 3 S2: the instances rendering SAMPLE content (the editor's
   *  "Show sample data" mode) and the bag they render over. `site` is the
   *  sample view's clone when any content widget is sampled. The layout,
   *  the drag/resize commits and every callback keep the REAL instances —
   *  the sample never leaves the render. */
  sampled: ReadonlySet<string>;
  sampleData: SiteHomeData;
}

/** The chrome a tile adds around its content: the frame header, the body's
 *  padding (p-3 = 12px × 2) and the two borders. Read from the DOM once per
 *  observation so a theme's header height is honoured. */
function chromePx(frame: HTMLElement): number {
  const header = frame.querySelector<HTMLElement>('.sb-frame-controls');
  return (header?.offsetHeight ?? 0) + 24 + 2;
}

export default function Canvas({ site, layout, data, selectedId, onSelect, onCommit, onRemove, sampled, sampleData }: CanvasProps) {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1024 });
  // Phase 7: the canvas wears the site's theme (accent, surface, heading
  // face) exactly as the public shell does — before this it showed the
  // violet defaults for every site.
  const spec = effectiveSpec(site);
  const attrs = themeAttrs(site);
  const fontCss = fontFaceCss(parseThemeTokens(site.theme_token_set).typeface);
  const sampleCtx = { orgName: site.orgName, sportKey: site.sportKey };

  // ── H2: measurement ──────────────────────────────────────────────────────
  const [measured, setMeasured] = useState<MeasuredRows>({});
  const measuredRef = useRef<MeasuredRows>({});
  const gestureRef = useRef<{ id: string; oldH: number } | null>(null);
  const pendingRef = useRef<Record<string, number>>({});
  const observerRef = useRef<ResizeObserver | null>(null);
  const applyRows = useCallback((rows: Record<string, number>) => {
    let changed = false;
    const next: Record<string, number> = { ...measuredRef.current };
    for (const [id, r] of Object.entries(rows)) {
      if (next[id] !== r) {
        next[id] = r;
        changed = true;
      }
    }
    if (!changed) return;
    measuredRef.current = next;
    setMeasured(next);
  }, []);
  // The observer is created LAZILY by the first tile's ref callback: ref
  // callbacks run before effects on mount, so an observer made in an effect
  // would miss every tile of the first render (the e2e found exactly that).
  const observer = useCallback((): ResizeObserver | null => {
    if (observerRef.current) return observerRef.current;
    if (typeof ResizeObserver === 'undefined') return null;
    observerRef.current = new ResizeObserver(entries => {
      const rows: Record<string, number> = {};
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset.sbMeasure;
        const frame = el.closest<HTMLElement>('.sb-frame');
        if (!id || !frame) continue;
        // The content's own height (ceil-to-row absorbs sub-row jitter such
        // as a page scrollbar toggling).
        rows[id] = rowsForContent(el.offsetHeight, chromePx(frame));
      }
      if (gestureRef.current) Object.assign(pendingRef.current, rows);
      else applyRows(rows);
    });
    return observerRef.current;
  }, [applyRows]);
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    []
  );
  const observe = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) observer()?.observe(el);
    },
    [observer]
  );
  const endGesture = () => {
    gestureRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(pending).length > 0) applyRows(pending);
  };

  const rgl = useMemo(() => toRglItems(layout, measured), [layout, measured]);
  const displayed = useMemo(() => new Map(rgl.map(i => [i.i, i.h])), [rgl]);

  const commit: EventCallback = (next: RglLayout, oldItem, newItem) => {
    const gesture = gestureRef.current && newItem ? { id: gestureRef.current.id, oldH: gestureRef.current.oldH, newH: newItem.h } : null;
    const result = commitGesture(layout, next, gesture, measuredRef.current);
    endGesture();
    if (result) onCommit(result.layout, result.flipped);
  };
  const begin = (id: string | undefined) => {
    if (!id) return;
    gestureRef.current = { id, oldH: displayed.get(id) ?? 0 };
    onSelect(id);
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
        onDragStart={(_layout, item) => begin(item?.i)}
        onDragStop={commit}
        onResizeStart={(_layout, item) => begin(item?.i)}
        onResizeStop={commit}
      >
        {layout.widgets.map(w => {
          const selected = selectedId === w.id;
          const title = w.key === 'hero' ? 'Hero' : widgetTitle(site, w);
          const membersOnly = effectiveAudience(site, w) === 'members';
          const isSample = sampled.has(w.id);
          const fit = fitOf(w);
          const shownH = displayed.get(w.id) ?? w.h;
          return (
            <div
              key={w.id}
              className={`sb-frame flex flex-col rounded-lg border bg-surface shadow-sm overflow-hidden ${
                selected ? 'border-brand ring-2 ring-brand/40' : 'border-border'
              }`}
              data-sb-widget={w.key}
              data-sb-instance={w.id}
              data-sb-fit={fit}
              onClick={() => onSelect(w.id)}
            >
              {/* B4: the frame header is the keyboard target too — Enter/Space selects (the body below is inert). */}
              <div
                className="sb-frame-controls flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-secondary cursor-grab"
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`Select ${title}`}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(w.id);
                  }
                }}
              >
                <span className="truncate font-medium text-primary">{title}</span>
                <span className="flex items-center gap-2">
                  {isSample && (
                    <span className="rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800" data-sb-sample-chip="" title="Sample content — shown here only, never on your site">
                      Sample
                    </span>
                  )}
                  {membersOnly && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" data-sb-members-only="">
                      Members only on your site
                    </span>
                  )}
                  {fit === 'fixed' && (
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-tertiary" data-sb-fixed-chip="" title="Fixed height — visitors scroll inside this section">
                      Fixed
                    </span>
                  )}
                  <span className="tabular-nums text-muted" title={fit === 'auto' && shownH !== w.h ? `Fits its content (${shownH} rows); at least ${w.h}` : undefined}>
                    {w.w}×{shownH}
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
              {/* B4 / H2: the CONTENT is inert (`.sb-measure` — the body's links were
                  tab-reachable and navigated the editor away); the body itself
                  scrolls when the tile is fixed (grid.css). The manager sees the
                  REAL widget (a private club's members-only module carries the
                  badge above, not the panel). */}
              <div className="sb-widget-body min-h-0 flex-1 overflow-hidden p-3" data-sb-fit={fit}>
                <div ref={observe} className="sb-measure" data-sb-measure={w.id} inert>
                  {w.key === 'hero' ? (
                    <HeroSection site={site} w={w} spec={spec} compact />
                  ) : isSample && w.key === 'embed' ? (
                    <SampleFrame kind="video" />
                  ) : (
                    // S2: a sampled tile renders the WHOLE sample bag through a
                    // query-stripped clone; every other tile the real one.
                    <WidgetBody site={site} w={sampleInstance(w, sampled, sampleCtx)} data={isSample ? sampleData : data} spec={spec} membersOnly={false} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}
