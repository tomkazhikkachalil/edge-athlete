'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { nextBaselineHeight, threadViewportGeometry } from '@/components/messages/thread-viewport';

/**
 * The phone thread shell FOLLOWS the visual viewport (Tom's fix 6, Oct 14
 * 2026; the rules in thread-viewport.ts). Writes the geometry straight onto
 * the shell element as CSS variables (`--ea-thread-top`, `--ea-thread-h`)
 * and `data-keyboard-open` — every frame of the keyboard animation, so not
 * React state; only `keyboardOpen` is (it changes a handful of times). The
 * body is scroll-locked meanwhile so nothing but the list can pan. Reads
 * `--ea-banner-h` / `--ea-tabbar-h` from the root; their writers stay single.
 *
 * `enabled` must be true only while the shell element IS rendered: the
 * effect re-runs on `enabled`, not on the ref — a caller that enables it
 * before its loading branch has given way to the shell gets nothing.
 *
 * Feature-detected: without visualViewport (nothing we ship to) the shell is
 * simply full height. Skips while pinch-zoomed (the scale guard of
 * useVisualViewportHeight — relaying out mid-pinch broke the page once).
 */
function cssPx(name: string): number {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) ? n : 0;
}

export function useThreadViewport(shellRef: RefObject<HTMLElement | null>, enabled: boolean): { keyboardOpen: boolean } {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useBodyScrollLock(enabled);

  useEffect(() => {
    if (!enabled) return;
    const el = shellRef.current;
    if (!el) return;
    const vv = window.visualViewport ?? null;
    let baseline = { baseline: vv?.height ?? window.innerHeight, width: window.innerWidth };
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (vv && (vv.scale ?? 1) > 1.001) return;
      const vvHeight = vv?.height ?? window.innerHeight;
      const vvOffsetTop = vv?.offsetTop ?? 0;
      baseline = { baseline: nextBaselineHeight(baseline, vvHeight, window.innerWidth), width: window.innerWidth };
      const g = threadViewportGeometry({
        vvHeight,
        vvOffsetTop,
        layoutHeight: window.innerHeight,
        baselineHeight: baseline.baseline,
        bannerH: cssPx('--ea-banner-h'),
        tabBarH: cssPx('--ea-tabbar-h'),
      });
      el.style.setProperty('--ea-thread-top', `${Math.round(g.top)}px`);
      el.style.setProperty('--ea-thread-h', `${Math.round(g.height)}px`);
      if (g.keyboardOpen) el.setAttribute('data-keyboard-open', '');
      else el.removeAttribute('data-keyboard-open');
      setKeyboardOpen(g.keyboardOpen);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      el.style.removeProperty('--ea-thread-top');
      el.style.removeProperty('--ea-thread-h');
      el.removeAttribute('data-keyboard-open');
      setKeyboardOpen(false);
    };
  }, [enabled, shellRef]);

  return { keyboardOpen };
}

/**
 * The raw half of the same idea for a `position: fixed` sheet that must sit
 * inside the visible strip (the GIF picker, whose own search box raises the
 * keyboard): writes `--ea-vv-top` / `--ea-vv-h` onto the element. Offsets are
 * 0 and the height the full viewport where nothing pans (desktop, the dock).
 */
export function useFollowVisualViewport(ref: RefObject<HTMLElement | null>, enabled: boolean = true): void {
  const write = useCallback((el: HTMLElement) => {
    const vv = window.visualViewport ?? null;
    if (vv && (vv.scale ?? 1) > 1.001) return;
    el.style.setProperty('--ea-vv-top', `${Math.round(Math.max(0, vv?.offsetTop ?? 0))}px`);
    el.style.setProperty('--ea-vv-h', `${Math.round(vv?.height ?? window.innerHeight)}px`);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport ?? null;
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; write(el); });
    };
    write(el);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, ref, write]);
}
