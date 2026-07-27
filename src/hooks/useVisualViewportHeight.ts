'use client';

import { useEffect } from 'react';

/**
 * Mirrors visualViewport.height into a --vvh CSS var on <html>.
 *
 * iOS Safari does not shrink the layout viewport (or dvh units) when the
 * software keyboard opens — only window.visualViewport reflects the visible
 * area — so full-height pages sit partly under the keyboard. Consumers set
 * `height: var(--vvh, 100dvh)`; where visualViewport is unavailable the var
 * is never set and the dvh fallback applies.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--vvh');
    };
  }, []);
}
