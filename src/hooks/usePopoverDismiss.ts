'use client';

import { useEffect, type RefObject } from 'react';

/**
 * THE house dismissal pattern for lightweight popovers (account menu,
 * notification panel, …): close on any outside press and on Escape.
 *
 * Deliberately a document `mousedown` listener with a ref-contains test,
 * NOT an invisible `fixed inset-0` backdrop div, for two reasons learned
 * the hard way (Aug 9 2026):
 *
 *  1. The header has `backdrop-blur`, and `backdrop-filter` makes an
 *     element the CONTAINING BLOCK for `position: fixed` descendants —
 *     a backdrop rendered inside it covers the 64px header strip, not the
 *     viewport, so clicks on the page body never dismissed anything.
 *     (Same family as the Tailwind-v4 `transform` stacking trap.)
 *  2. A backdrop EATS the first click: tapping a sibling control closed
 *     the popover but the tap never reached the control. `mousedown`
 *     fires before the click completes, so with this pattern the popover
 *     closes AND the sibling still receives its click — cross-dismissal
 *     in one gesture.
 *
 * Modal surfaces with a DIMMED backdrop (search dialog, real modals) are
 * different: there, swallowing the outside click is correct dialog
 * semantics — but the overlay must be PORTALED to document.body so the
 * backdrop actually spans the viewport.
 *
 * `refs` may be one ref or several: a PORTALED panel is no longer a DOM
 * descendant of its trigger, so "inside" must consult both — otherwise the
 * mousedown on the trigger closes the popover and the trigger's click
 * reopens it (the Aug 9 2026 portal lesson).
 */
export function usePopoverDismiss(
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  open: boolean,
  onClose: () => void
): void {
  useEffect(() => {
    if (!open) return;

    const list = Array.isArray(refs) ? refs : [refs];
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside = list.some(r => r.current && r.current.contains(target));
      if (!inside) onClose();
    };
    // Escape closes the TOPMOST layer only: capture phase + stopPropagation,
    // so a popover open inside a modal (the post card's owner menu in the
    // post-detail modal, Sep 8 2026) does not take the modal down with it —
    // the modal's own bubble-phase window listener never sees the key.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };

    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [refs, open, onClose]);
}
