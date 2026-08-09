'use client';

import { useEffect } from 'react';

/**
 * Mirrors visualViewport.height into a --vvh CSS var on <html>, and keeps
 * the document pan clamped to 0 while mounted.
 *
 * iOS Safari does not shrink the layout viewport (or dvh units) when the
 * software keyboard opens — only window.visualViewport reflects the visible
 * area — so full-height pages sit partly under the keyboard. Consumers set
 * `height: var(--vvh, 100dvh)`; where visualViewport is unavailable the var
 * is never set and the dvh fallback applies.
 *
 * The clamp is the other half of the keyboard fix: on focus, iOS pans the
 * DOCUMENT to "bring the input into view" BEFORE the resize event fires —
 * against the still-full-height shell that's a ~400px+ scroll. Then the
 * shell shrinks to keyboard height and the pan is never undone, leaving the
 * composer parked at the top of the screen (Aug 9 report; the user's
 * workaround was dragging the page back down). Pages using this hook are
 * exactly viewport-height, so ANY document offset is that artifact — reset
 * it. Android is unaffected (interactiveWidget: 'resizes-content' resizes
 * the layout viewport; scrollY stays 0, the clamp no-ops).
 *
 * Height updates run on `resize` only: rewriting --vvh from the `scroll`
 * event re-lays-out the shell mid-pan-gesture and fights the very scroll
 * we're correcting. Do NOT add scrollIntoView to the composer — it would
 * race iOS's own focus scroll and re-introduce the jump.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const setHeight = () => root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    const clampPan = () => {
      if (window.scrollY > 0 || vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    const onResize = () => {
      setHeight();
      clampPan();
    };
    setHeight();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', clampPan);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', clampPan);
      root.style.removeProperty('--vvh');
    };
  }, []);
}
