'use client';

import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteLayout } from '@/lib/site-builder/layout';
import { effectiveAudience } from '@/lib/site-builder/audience';
import { canMove, moveInstance, readingOrder, resizeToPreset } from '@/lib/site-builder/sections';
import { widgetTitle } from '@/app/(public)/org/[slug]/_components/WidgetBody';
import SizeControl from './SizeControl';
import { fitOf, withFit } from '@/lib/site-builder/fit';

// ── The Sections list — the phone editor (Sep 11 2026) ───────────────────
// Below `lg` the canvas has no room, but a manager on a phone still needs to
// arrange the page: this list is the SAME draft in reading order (the order
// the phone renders), with a named size and Move up / Move down per section.
// Every edit goes through `onCommit` — one undo step, autosaved by useDraft
// exactly like a drag. Remove goes through the editor's removal (the undo
// toast). The list never adds a section (Add section is the picker). Edit
// opens the section's properties as a bottom sheet (program 2, A1) — titles,
// words, photos and audience on a phone.

interface Props {
  site: PublicSite;
  layout: SiteLayout;
  onCommit: (next: SiteLayout) => void;
  onRemove: (id: string) => void;
  /** Open the section's properties (a sheet below lg). */
  onSelect: (id: string) => void;
  /** Program 3 S2: the rows rendering sample content (a "Sample" chip). */
  sampled?: ReadonlySet<string>;
}

const ICON = 'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function SectionsList({ site, layout, onCommit, onRemove, onSelect, sampled }: Props) {
  const rows = readingOrder(layout);
  return (
    <ol className="space-y-2" aria-label="Sections in page order" data-sb-sections="">
      {rows.map(w => {
        const title = w.key === 'hero' ? 'Hero' : widgetTitle(site, w);
        const audience = effectiveAudience(site, w);
        const isHero = w.key === 'hero';
        return (
          <li key={w.id} className="rounded-lg border border-border bg-surface p-3" data-sb-section={w.id} data-sb-section-key={w.key}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-primary">{title}</p>
                {sampled?.has(w.id) && (
                  <span className="mt-0.5 mr-1 inline-block rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800" data-sb-sample-chip="">Sample</span>
                )}
                {audience !== 'public' && (
                  <span className="mt-0.5 inline-block rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">Members only</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => onSelect(w.id)} className={ICON} aria-label={`Edit ${title}`} data-sb-edit="">
                  <i className="fas fa-pen" aria-hidden="true"></i>
                </button>
                {!isHero && (
                  <>
                  <button type="button" onClick={() => onCommit(moveInstance(layout, w.id, 'up'))} disabled={!canMove(layout, w.id, 'up')} className={ICON} aria-label={`Move ${title} up`} data-sb-move="up">
                    <i className="fas fa-arrow-up" aria-hidden="true"></i>
                  </button>
                  <button type="button" onClick={() => onCommit(moveInstance(layout, w.id, 'down'))} disabled={!canMove(layout, w.id, 'down')} className={ICON} aria-label={`Move ${title} down`} data-sb-move="down">
                    <i className="fas fa-arrow-down" aria-hidden="true"></i>
                  </button>
                  <button type="button" onClick={() => onRemove(w.id)} className={ICON} aria-label={`Remove ${title}`}>
                    <i className="fas fa-times" aria-hidden="true"></i>
                  </button>
                  </>
                )}
              </div>
            </div>
            {!isHero && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SizeControl widget={w} title={title} onResize={p => onCommit(resizeToPreset(layout, w.id, p))} />
                {/* Program 3, H2: the height rule — fits its content, or fixed (scrolls inside). */}
                <select
                  aria-label={`Height of ${title}`}
                  value={fitOf(w)}
                  onChange={e => onCommit({ ...layout, widgets: layout.widgets.map(x => (x.id === w.id ? withFit(x, e.target.value === 'fixed' ? 'fixed' : 'auto') : x)) })}
                  className="min-h-[36px] rounded-md border border-border-strong bg-surface px-2 text-xs text-secondary"
                  data-sb-height=""
                >
                  <option value="auto">Fits the content</option>
                  <option value="fixed">Fixed — scrolls inside</option>
                </select>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
