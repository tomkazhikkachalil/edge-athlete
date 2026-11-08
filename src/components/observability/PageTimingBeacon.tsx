'use client';

/**
 * The real-user page timings beacon (performance program Phase 0.4, Nov 2026 —
 * Tom's pick over Vercel Speed Insights: first-party, keyed by the BUILD).
 * Next reports each browser timing metric as the browser measures it; this batches
 * them for two seconds and sends ONE `navigator.sendBeacon` to
 * POST /api/page-timings with the build (the deploy's commit), the route with its
 * ids masked, a device class from the viewport and how the page was
 * reached. Nothing about the person goes with it. The page is never slowed:
 * the send is a beacon, the batch waits for the metrics, a page that is
 * left sends what it has. Renders nothing.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { BEACON_BATCH_MS, TIMING_METRICS, cleanBuild, deviceClass, maskRoute } from '@/lib/observability/page-timings-rules';

type Pending = { name: string; value: number; rating?: string };

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID;

export default function PageTimingBeacon() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const pendingRef = useRef<Pending[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const metrics = pendingRef.current.splice(0);
    const build = cleanBuild(BUILD);
    if (metrics.length === 0 || !build || typeof window === 'undefined') return;
    let navigation: string | null = null;
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      navigation = nav?.type ?? null;
    } catch {
      /* no timing API */
    }
    const body = JSON.stringify({ build, route: maskRoute(pathRef.current ?? '/'), device: deviceClass(window.innerWidth), navigation, metrics });
    try {
      if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/page-timings', new Blob([body], { type: 'application/json' }))) return;
    } catch {
      /* fall through to fetch */
    }
    void fetch('/api/page-timings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'include' }).catch(() => undefined);
  };

  useReportWebVitals((metric) => {
    if (!(TIMING_METRICS as readonly string[]).includes(metric.name)) return;
    pendingRef.current.push({ name: metric.name, value: metric.value, rating: (metric as { rating?: string }).rating });
    if (!timerRef.current) timerRef.current = setTimeout(flush, BEACON_BATCH_MS);
  });

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  return null;
}
