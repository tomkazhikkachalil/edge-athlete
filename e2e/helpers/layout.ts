import type { Page } from '@playwright/test';

/**
 * Layout measurements for specs (fix round part 5, Oct 2 2026). Rendered
 * geometry, not class names: a spacing bug is a parent that does not space
 * its children, which no class on the children themselves shows.
 */

export interface FilterBarGaps {
  /** px between the controls row's bottom edge and the status strip's top. */
  controlsToStatus: number;
  /** px between the status strip's bottom edge and the next visible block
   *  after the bar (the grid, an empty state, a spinner); null when the bar
   *  is the last thing in its container. */
  statusToNext: number | null;
  /** What that next block is, for the failure message. */
  next: string | null;
}

/**
 * The shared FilterBar (src/components/filters/FilterBar.tsx) inside `scope`:
 * how far apart its two rows are, and how far the block under it sits.
 */
export async function filterBarGaps(page: Page, scope: string): Promise<FilterBarGaps | null> {
  return page.evaluate(scopeSel => {
    const root = document.querySelector(scopeSel);
    const bar = root?.querySelector('[data-filter-bar]');
    const controls = bar?.querySelector('[data-filter-controls]');
    const status = bar?.querySelector('[data-filter-status]');
    if (!bar || !controls || !status) return null;
    const round = (n: number) => Math.round(n * 10) / 10;
    const s = status.getBoundingClientRect();
    let next = bar.nextElementSibling;
    while (next) {
      const r = next.getBoundingClientRect();
      const cs = getComputedStyle(next);
      if (r.height > 1 && cs.display !== 'none' && cs.position !== 'fixed' && cs.position !== 'absolute') break;
      next = next.nextElementSibling;
    }
    return {
      controlsToStatus: round(s.top - controls.getBoundingClientRect().bottom),
      statusToNext: next ? round(next.getBoundingClientRect().top - s.bottom) : null,
      next: next ? next.tagName.toLowerCase() + '.' + (typeof next.className === 'string' ? next.className.split(/\s+/).slice(0, 4).join('.') : '') : null,
    };
  }, scope);
}

/** No sideways scroll: the document is not wider than the viewport. */
export async function fitsViewportWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
