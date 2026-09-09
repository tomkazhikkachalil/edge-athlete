'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { placeMenu } from '@/lib/panel-placement';

/**
 * The org page's staff actions behind ONE "Manage" control (Site Builder
 * P1-A, Sep 9 2026). The hero used to spread Edit / Share join link /
 * Public site → / Manage → / Staff & hierarchy → across a pill row and a
 * link row; the doc's rule is that owner and manager controls live behind a
 * single entry point on the page an athlete sees — the row of doors belongs
 * in the console.
 *
 * From `sm` up this is the popover; below `sm` OrgHero opens the bubble
 * language's own sheet (LargerWindow) with the same rows, so the accessible
 * names are identical either way and e2e scopes to whichever is open.
 *
 * Why a portal: the hero root is `overflow-hidden` (the band + logo tile
 * overlap), so an in-tree dropdown is clipped at the card's edge — the
 * PostOwnerMenu idiom: render on document.body, `position: fixed`, placed
 * by the pure `placeMenu` (below the trigger, right-aligned, flips above
 * only when the visible strip has no room), repositioned on scroll /
 * resize / visualViewport moves by straight style writes (no state, nothing
 * for set-state-in-effect), dismissed on outside mousedown consulting BOTH
 * refs plus Escape (the topmost-layer rule lives in the hook).
 *
 * Rows are plain buttons and links — no `role="menu"` (the AppHeader
 * account-dropdown precedent: half-implemented arrow-key semantics are
 * worse than none, and `getByRole('button' | 'link')` then works the same
 * inside the popover and inside the sheet). Every row closes FIRST, then
 * acts, so a modal it opens never mounts under a still-open panel.
 */
export type ManageItem =
  | { key: string; kind: 'button'; label: ReactNode; onClick: () => void }
  | { key: string; kind: 'link'; label: ReactNode; href: string };

interface Props {
  items: ManageItem[];
  /** The trigger's classes — the hero passes its pill recipe. */
  triggerClassName: string;
}

const GAP_PX = 4;
const MARGIN_PX = 8;
const ROW =
  'w-full text-left px-4 min-h-[44px] text-sm flex items-center text-primary hover:bg-surface-muted transition-colors';

export default function OrgManageMenu({ items, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // A stable array: the dismiss hook keys its effect on it.
  const dismissRefs = useMemo(() => [triggerRef, panelRef], []);
  const close = useCallback(() => {
    // Focus returns to the trigger when it was inside the menu (Escape, a
    // row) — an outside press moves focus to whatever was pressed anyway.
    const active = document.activeElement;
    const inside =
      !!active &&
      ((panelRef.current?.contains(active) ?? false) || active === triggerRef.current);
    setOpen(false);
    if (inside) triggerRef.current?.focus();
  }, []);
  usePopoverDismiss(dismissRefs, open, close);

  const reposition = () => {
    const anchor = triggerRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const vv = window.visualViewport;
    const placed = placeMenu({
      anchorTop: r.top,
      anchorBottom: r.bottom,
      anchorRight: r.right,
      panelW: panel.getBoundingClientRect().width,
      panelH: panel.getBoundingClientRect().height,
      gap: GAP_PX,
      viewportTop: vv?.offsetTop ?? 0,
      viewportHeight: vv?.height ?? window.innerHeight,
      viewportWidth: window.innerWidth,
      margin: MARGIN_PX,
    });
    panel.style.left = `${placed.left}px`;
    panel.style.top = `${placed.top}px`;
    panel.style.bottom = 'auto';
  };

  useLayoutEffect(() => {
    if (open) reposition();
  });

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };
    const vv = window.visualViewport;
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    vv?.addEventListener('scroll', onMove);
    vv?.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      vv?.removeEventListener('scroll', onMove);
      vv?.removeEventListener('resize', onMove);
    };
  }, [open]);

  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        className={triggerClassName}
        data-org-manage-trigger=""
      >
        Manage
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="group"
            aria-label="Manage"
            style={{ position: 'fixed' }}
            className="z-[70] ea-dropdown-in min-w-[220px] bg-surface-raised rounded-lg shadow-[var(--ea-shadow-raised)] border border-border py-1"
            onClick={e => e.stopPropagation()}
            data-org-manage-menu=""
          >
            {items.map(item =>
              item.kind === 'button' ? (
                <button key={item.key} type="button" onClick={act(item.onClick)} className={ROW}>
                  {item.label}
                </button>
              ) : (
                <Link key={item.key} href={item.href} onClick={close} className={ROW}>
                  {item.label}
                </Link>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}
