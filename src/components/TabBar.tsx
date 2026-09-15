'use client';

import { useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLiveNow } from '@/hooks/useLiveNow';
import { useAuth } from '@/lib/auth';
import { activeNavPath } from '@/lib/nav-active';
import { showsTabBar, TAB_BAR_LINKS } from '@/lib/tab-bar';

/**
 * The phone tab bar (Events program, phase 2b, B4): five places, fixed to
 * the bottom below `lg` — the first app-wide chrome (every page mounts
 * its own AppHeader; this mounts ONCE from the root layout, so it never
 * remounts on navigation). The header's three-branch discipline: nothing
 * while auth boots, nothing signed out, nothing on a screen that owns its
 * bottom edge (`showsTabBar`). Real 56px targets, no `after:` extenders.
 *
 * `--ea-tabbar-h` on <html> is the bar's MEASURED height (a ResizeObserver,
 * the StickyBanner recipe): 0 at `lg:` and when hidden, so `body`'s
 * bottom padding and the `--vvh` shells subtract an honest number at every
 * width. z-30: under the header (40) and the drawer backdrop (40);
 * LargerWindow (50) and modals (60) cover it; toasts anchor at the top.
 */
export default function TabBar() {
  const { user, initialAuthCheckComplete } = useAuth();
  const pathname = usePathname();
  const liveCount = useLiveNow(!!user);
  const ref = useRef<HTMLElement | null>(null);
  const visible = initialAuthCheckComplete && !!user && showsTabBar(pathname);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.removeProperty('--ea-tabbar-h');
      return;
    }
    const update = () => root.style.setProperty('--ea-tabbar-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--ea-tabbar-h');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <nav ref={ref} aria-label="Primary" data-tab-bar="" className="fixed inset-x-0 bottom-0 z-30 lg:hidden bg-surface/95 backdrop-blur-md border-t border-border-subtle safe-bottom safe-x">
      <ul className="flex">
        {TAB_BAR_LINKS.map(link => {
          const active = activeNavPath(pathname, link.path);
          return (
            <li key={link.key} className="flex-1 min-w-0">
              <Link
                href={link.path}
                aria-current={active ? 'page' : undefined}
                data-tab={link.key}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold transition-colors ${active ? 'text-brand-fg-strong' : 'text-secondary'}`}
              >
                <span className="relative inline-flex">
                  <i className={`fas ${link.icon} text-lg leading-none`} aria-hidden="true"></i>
                  {link.key === 'live' && liveCount > 0 && (
                    <span className="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-red-600 ea-live-dot" aria-hidden="true" data-tab-live-dot="" />
                  )}
                </span>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
