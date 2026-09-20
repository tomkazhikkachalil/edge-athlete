'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { placeMenu } from '@/lib/panel-placement';

/**
 * The house "…" menu (Support & Reporting, Spec 2 — lifted out of
 * PostOwnerMenu so posts, comments, profiles and threads share ONE menu
 * instead of four). The rows are data; the primitive owns the trigger, the
 * portal, the placement and the dismissal:
 *
 * Why a portal: the callers' roots are `rounded-lg overflow-hidden` (a card,
 * a modal) — an in-tree dropdown gets cut at the edge (the Aug 9 2026
 * clipping rule). So the panel renders on document.body, `position: fixed`,
 * placed by the pure `placeMenu` (below the trigger, right-aligned, flips
 * above only when the visible strip has no room), repositions on scroll /
 * resize / visualViewport moves and never closes on them (the #100 panel
 * rules), and dismisses on outside mousedown consulting BOTH the trigger
 * and the panel (portal lesson) plus Escape.
 *
 * Every row closes the menu FIRST, then acts — a confirm or a sheet must
 * not mount under a still-open panel. The trigger owns no layout: callers
 * pass `triggerClassName` (e.g. `sm:hidden`) — the shared-class trap.
 */
export interface ActionMenuItem {
  key: string;
  label: string;
  /** FontAwesome class, e.g. 'fa-flag'. */
  icon: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** e2e hook: data-menu-item={key} is always set; this adds a second attribute. */
  testId?: string;
}

interface Props {
  items: ActionMenuItem[];
  ariaLabel: string;
  triggerClassName?: string;
  /** The trigger's content; default the ellipsis. */
  trigger?: ReactNode;
  /** The trigger's e2e attribute name (rendered as data-<name>=""). */
  triggerTestAttr?: string;
}

const GAP_PX = 4;
const MARGIN_PX = 8;
const ROW = 'w-full text-left px-4 min-h-[44px] text-sm flex items-center gap-3 hover:bg-surface-muted transition-colors';

export default function ActionMenu({ items, ariaLabel, triggerClassName, trigger, triggerTestAttr }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dismissRefs = useMemo(() => [triggerRef, panelRef], []);
  const close = useCallback(() => setOpen(false), []);
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

  const triggerAttrs = triggerTestAttr ? { [`data-${triggerTestAttr}`]: '' } : {};

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${triggerClassName ?? ''} text-primary hover:text-brand-fg transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-surface-muted inline-flex items-center justify-center`}
        {...triggerAttrs}
      >
        {trigger ?? <i className="fas fa-ellipsis-h text-sm" aria-hidden="true"></i>}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={ariaLabel}
            style={{ position: 'fixed' }}
            className="z-[70] ea-dropdown-in min-w-[200px] bg-surface-raised rounded-lg shadow-[var(--ea-shadow-raised)] border border-border py-1"
            onClick={(e) => e.stopPropagation()}
          >
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={act(item.onSelect)}
                data-menu-item={item.key}
                className={`${ROW} ${item.tone === 'danger' ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40' : 'text-primary'} disabled:opacity-60`}
              >
                <i className={`fas ${item.icon} w-4 text-center text-xs`} aria-hidden="true"></i>
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
