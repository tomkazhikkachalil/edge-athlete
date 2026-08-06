'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AdvancedSearchBar from '@/components/AdvancedSearchBar';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { isTypingTarget, matchesSearchShortcut } from '@/lib/keyboard';

/**
 * Search, collapsed into the header.
 *
 * It used to be a full-width band below the nav — ~71px of chrome on every one
 * of the five routes that opted in, and absent from the other eighteen. This is
 * a compact trigger that opens a panel, so search costs no vertical space and
 * is reachable from EVERY page rather than five.
 *
 * The panel reuses `AdvancedSearchBar` wholesale rather than reimplementing
 * search: same query, same filters, same results. Only the container changed.
 */
export default function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useBodyScrollLock(open);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus where it came from, or the shortcut strands keyboard users.
    triggerRef.current?.focus();
  }, []);

  // ⌘K / Ctrl+K, and "/" as the second-nature alternative.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesSearchShortcut(e)) return;
      // Never steal a keystroke someone is typing into a field, and never fire
      // while a modal owns the screen — MediaLightbox and PostDetailModal both
      // listen on `window` for Escape and arrows and neither stops propagation.
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;

      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Escape closes. Scoped to the panel's lifetime so it cannot interfere with
  // anything else's Escape handling.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // Autofocus the real input inside AdvancedSearchBar once the panel paints.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      panelRef.current?.querySelector('input')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-haspopup="dialog"
        className="ea-interactive inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[color:var(--ea-hairline)] bg-surface/60 py-2 pl-3 pr-2 text-sm text-muted lg:w-64 xl:w-80"
      >
        <i className="fas fa-search text-xs" aria-hidden="true"></i>
        {/* Label and hint now appear at `lg`, which only became affordable
            when Messages and Connections left the nav for the icon cluster.
            Re-measured at exactly 1024px: that width overflowed the row by 89px
            the last time it was widened, so it is checked, not assumed. */}
        <span className="hidden flex-1 text-left lg:inline">Search</span>
        {/* The hint chip. Hidden below lg because there is no keyboard there
            and advertising a shortcut nobody can press is noise. */}
        <kbd className="ml-auto hidden rounded border border-[color:var(--ea-hairline)] bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted lg:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/30"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="fixed inset-x-0 top-0 z-[61] mx-auto mt-4 flex max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] flex-col rounded-xl bg-surface-raised p-4 shadow-[var(--ea-shadow-raised)] sm:mt-[10vh] sm:max-h-[80dvh]"
          >
            {/* The filters panel AdvancedSearchBar opens is ~500px tall — on a
                phone with the keyboard up that ran straight off the bottom of
                the screen with nothing to scroll. Bounding the panel and
                scrolling this wrapper keeps every field reachable. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AdvancedSearchBar />
            </div>
            <p className="mt-3 shrink-0 text-center text-xs text-faint">
              Press <span className="font-semibold">Esc</span> to close
            </p>
          </div>
        </>
      )}
    </>
  );
}
