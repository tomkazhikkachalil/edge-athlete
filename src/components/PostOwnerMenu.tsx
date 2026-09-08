'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { placeMenu } from '@/lib/panel-placement';

/**
 * The post card's owner actions (pin / edit / delete) as ONE "…" button
 * below `sm`. From `sm` up PostCard renders the three 44px buttons and this
 * component's trigger is `sm:hidden`.
 *
 * Why a portal: PostCard's root is `rounded-lg overflow-hidden`, and the
 * post-detail modal stacks two more clippers on the same path — an in-tree
 * dropdown under the header gets cut at the card's edge (the Aug 9 2026
 * clipping rule). So the panel renders on document.body, `position:
 * fixed`, placed by the pure `placeMenu` (below the trigger, right-aligned,
 * flips above only when the visible strip has no room), repositions on
 * scroll / resize / visualViewport moves and never closes on them (the
 * #100 panel rules), and dismisses on outside mousedown consulting BOTH
 * the trigger and the panel (portal lesson) plus Escape.
 *
 * Every row closes the menu FIRST, then acts — the delete confirm and the
 * edit modal must not mount under a still-open panel.
 */
interface Props {
  isPinned: boolean;
  pinBusy: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  /** Absent when the mount did not wire onDelete — no dead Delete row. */
  onDelete?: () => void;
}

const GAP_PX = 4;
const MARGIN_PX = 8;
const ROW =
  'w-full text-left px-4 min-h-[44px] text-sm flex items-center gap-3 hover:bg-surface-muted transition-colors';

export default function PostOwnerMenu({ isPinned, pinBusy, onTogglePin, onEdit, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // A stable array: the dismiss hook keys its effect on it (ref objects
  // themselves are stable; only the array identity needs pinning).
  const dismissRefs = useMemo(() => [triggerRef, panelRef], []);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(dismissRefs, open, close);

  // Straight style writes before paint (no state, nothing for
  // set-state-in-effect to object to) — the MentionSuggestions idiom.
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
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        aria-label="Post options"
        title="Post options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="sm:hidden text-primary hover:text-brand-fg transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-surface-muted inline-flex items-center justify-center"
      >
        <i className="fas fa-ellipsis-h text-sm" aria-hidden="true"></i>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Post options"
            style={{ position: 'fixed' }}
            className="z-[70] ea-dropdown-in min-w-[200px] bg-surface-raised rounded-lg shadow-[var(--ea-shadow-raised)] border border-border py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              disabled={pinBusy}
              onClick={act(onTogglePin)}
              className={`${ROW} text-primary disabled:opacity-60`}
            >
              <i className={`fas fa-thumbtack w-4 text-center text-xs ${isPinned ? 'text-amber-500' : ''}`} aria-hidden="true"></i>
              {isPinned ? 'Unpin from profile' : 'Pin to profile'}
            </button>
            <button type="button" role="menuitem" onClick={act(onEdit)} className={`${ROW} text-primary`}>
              <i className="fas fa-edit w-4 text-center text-xs" aria-hidden="true"></i>
              Edit post
            </button>
            {onDelete && (
              <button
                type="button"
                role="menuitem"
                onClick={act(onDelete)}
                className={`${ROW} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}
              >
                <i className="fas fa-trash w-4 text-center text-xs" aria-hidden="true"></i>
                Delete post
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
