'use client';

/**
 * Registers the service worker at boot when the deployment turns the static
 * cache on (speed round 2, phase E — src/lib/sw/static-cache.ts). Until now
 * the worker was registered only when a person turned phone notifications
 * on, so most installs had no worker and every cold open re-downloaded the
 * app's hashed files. Renders nothing; feature-detected for the iOS 15 floor;
 * the same URL the push opt-in uses, so there is ever one worker.
 */

import { useEffect } from 'react';
import { staticCacheEnabled, swUrl } from '@/lib/sw/static-cache';

export default function StaticCacheRegistrar() {
  useEffect(() => {
    if (!staticCacheEnabled()) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    if (!sw || typeof sw.register !== 'function') return;
    // After the page is interactive — never in the way of the first paint.
    const start = () => {
      sw.register(swUrl(true), { scope: '/' }).catch(() => {
        /* a refused worker is a slower cold open, never an error */
      });
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => window.removeEventListener('load', start);
  }, []);
  return null;
}
