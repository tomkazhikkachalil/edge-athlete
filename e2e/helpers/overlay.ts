import { expect, type Page } from '@playwright/test';

/**
 * Is a suggestion list actually USABLE — on top, and not clipped away?
 *
 * This exists because of a bug that shipped in August 2026. The ⌘K search
 * results were absolutely positioned inside a 46px `overflow-y-auto` wrapper,
 * so they rendered entirely below it: clipped, with the modal backdrop
 * painting where they should have been. Invisible and unclickable.
 *
 * The probe that was supposed to catch it asserted `[role="option"]` element
 * COUNT — and passed 30/30. A clipped element still has a non-zero box and
 * Playwright's `isVisible()` still returns true for it. **Counting is not
 * seeing.** These are the two assertions that would have caught it:
 *
 *   1. the first row's centre hit-tests to a node inside the list, and
 *   2. the list's box lies inside its nearest scrollable ancestor's box.
 *
 * The repo already uses `document.elementFromPoint` as its "is this really
 * clickable" idiom (see globals.css:441 and EditProfileTabs.tsx:1066); this
 * just makes it reusable.
 */

export interface SuggestionsCheck {
  /** CSS selector for the list container. */
  listSelector: string;
  /** CSS selector for a row, resolved WITHIN the list. */
  rowSelector: string;
  /** Human name used in assertion messages. */
  label: string;
}

export interface SuggestionsMeasurement {
  found: boolean;
  rows: number;
  /** The first row's centre hit-tests to something inside the list. */
  onTop: boolean;
  /** What `elementFromPoint` actually returned, for the failure message. */
  hitWas: string | null;
  /** The list's box lies inside its nearest scrollable ancestor. */
  unclipped: boolean;
  listBox: [number, number];
  clipperBox: [number, number] | null;
  clipperClass: string | null;
}

/**
 * CSS selectors, deliberately — not roles. Only the header search exposes
 * `role="listbox"`/`role="option"`; the calendar guest picker and the
 * equipment brand/model panels are plain `div`s of `<button>`s. A role-based
 * locator would match nothing there and pass vacuously, which is the very
 * failure mode this helper exists to prevent.
 */
export async function measureSuggestions(
  page: Page,
  { listSelector, rowSelector }: Omit<SuggestionsCheck, 'label'>
): Promise<SuggestionsMeasurement> {
  return page.evaluate(
    ({ listSelector, rowSelector }) => {
      const empty = {
        found: false, rows: 0, onTop: false, hitWas: null,
        unclipped: false, listBox: [0, 0] as [number, number],
        clipperBox: null, clipperClass: null,
      };
      const list = document.querySelector(listSelector);
      if (!list) return empty;
      const rows = list.querySelectorAll(rowSelector);
      const row = rows[0];
      if (!row) return { ...empty, found: true };

      const rr = row.getBoundingClientRect();
      // Near the row's top rather than dead centre: a tall row whose bottom is
      // clipped would still hit-test cleanly at its middle.
      const hit = document.elementFromPoint(
        rr.left + rr.width / 2,
        rr.top + Math.min(rr.height / 2, 12)
      );

      const lr = list.getBoundingClientRect();
      let node = list.parentElement;
      let clipper: Element | null = null;
      while (node) {
        const s = getComputedStyle(node);
        if (/auto|scroll|hidden/.test(s.overflowY) || /auto|scroll|hidden/.test(s.overflowX)) {
          clipper = node;
          break;
        }
        node = node.parentElement;
      }
      const cr = clipper ? clipper.getBoundingClientRect() : null;

      return {
        found: true,
        rows: rows.length,
        onTop: !!hit && list.contains(hit),
        hitWas: hit ? `${hit.tagName}.${String(hit.className).slice(0, 60)}` : null,
        // 1px tolerance for sub-pixel layout.
        unclipped: cr ? lr.top >= cr.top - 1 && lr.bottom <= cr.bottom + 1 : true,
        listBox: [Math.round(lr.top), Math.round(lr.bottom)] as [number, number],
        clipperBox: cr ? ([Math.round(cr.top), Math.round(cr.bottom)] as [number, number]) : null,
        clipperClass: clipper ? String(clipper.className).slice(0, 60) : null,
      };
    },
    { listSelector, rowSelector }
  );
}

/**
 * Assert a suggestion list is present, on top, and not clipped away.
 *
 * Polls rather than measuring one frame: several of these lists nudge
 * themselves into view with a smooth `scrollIntoView`, so the first painted
 * frame is legitimately mid-animation. Polling tolerates that without
 * weakening anything — a list that is genuinely clipped never settles and
 * still fails on timeout.
 */
export async function assertSuggestionsUsable(
  page: Page,
  check: SuggestionsCheck,
  timeoutMs = 4_000
): Promise<SuggestionsMeasurement> {
  let m = await measureSuggestions(page, check);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && m.found && m.rows > 0 && (!m.onTop || !m.unclipped)) {
    await page.waitForTimeout(150);
    m = await measureSuggestions(page, check);
  }

  expect(m.found, `${check.label}: no suggestion list matched ${check.listSelector}`).toBe(true);
  expect(m.rows, `${check.label}: list rendered but has no rows`).toBeGreaterThan(0);

  expect(
    m.onTop,
    `${check.label}: the first suggestion is NOT the topmost element at its own ` +
      `centre — elementFromPoint returned ${m.hitWas}. Something is painting over it.`
  ).toBe(true);

  expect(
    m.unclipped,
    `${check.label}: the list is CLIPPED by an ancestor with overflow. ` +
      `list ${JSON.stringify(m.listBox)} vs clipper ${JSON.stringify(m.clipperBox)} ` +
      `(${m.clipperClass}). Rows outside that box are invisible and unclickable.`
  ).toBe(true);

  return m;
}
