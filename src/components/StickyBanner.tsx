'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Shared shell for the two root-layout banners (ActingAsBanner,
 * TransferBanner — mutually exclusive audiences, so at most one mounts).
 *
 * Both the banner and AppHeader are `sticky`. When both pinned at top:0 the
 * banner's higher z-index buried the header once the page scrolled — logo,
 * search, bells and hamburger all disappeared behind the strip. The banner
 * therefore publishes its measured height as `--ea-banner-h` on <html>, and
 * the header's `top` reads that variable so it docks *below* the banner.
 *
 * Measured (ResizeObserver), not hard-coded: the row wraps on narrow screens
 * with long athlete names, so its height is not a constant. The variable is
 * removed on unmount, returning the header to top:0.
 */
export default function StickyBanner({ className = '', children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--ea-banner-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--ea-banner-h');
    };
  }, []);

  return (
    <div ref={ref} className={`sticky top-0 z-[60] w-full safe-x ${className}`}>
      {children}
    </div>
  );
}
