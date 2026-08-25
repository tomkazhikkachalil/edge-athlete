'use client';

import { useEffect, useState } from 'react';

/**
 * JS viewport gate for components that render DIFFERENT trees per width
 * (chat-dock precedent). Prefer CSS `lg:` classes when only styling
 * changes — this hook is for avoiding duplicate DOM (double-firing focus,
 * duplicate sliders) when the same controls move between layouts.
 *
 * SSR-safe: starts false, resolves in the first effect — callers must
 * tolerate one mobile-first render.
 */
export function useIsDesktop(query = '(min-width: 1024px)'): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [query]);

  return isDesktop;
}
