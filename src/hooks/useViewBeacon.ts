'use client';

import { useEffect, type RefObject } from 'react';
import { recordView } from '@/lib/views/client';

// A card half on screen for one second is a view (252). Feature-detected for
// the iOS 15 floor (IntersectionObserver is Safari 12.1+). `enabled` is false
// for the author's own card and while acting as a guardian.
export const VIEW_VISIBLE_RATIO = 0.5;
export const VIEW_DWELL_MS = 1000;

export function useViewBeacon(ref: RefObject<HTMLElement | null>, opts: { postId: string; enabled: boolean }): void {
  const { postId, enabled } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= VIEW_VISIBLE_RATIO) {
          if (timer === null && !done) {
            timer = setTimeout(() => {
              timer = null;
              done = true;
              recordView(postId, 'view');
              observer.disconnect();
            }, VIEW_DWELL_MS);
          }
        } else if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [VIEW_VISIBLE_RATIO] }
    );
    observer.observe(el);
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref, postId, enabled]);
}
