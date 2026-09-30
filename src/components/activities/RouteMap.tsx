'use client';

// Dynamic wrapper: Leaflet (~42KB gz + CSS) loads only when an activity's
// route actually renders — the course map's pattern (CourseMap.tsx).

import dynamic from 'next/dynamic';
import type { RouteMapInnerProps } from './RouteMapInner';

const RouteMapInner = dynamic(() => import('./RouteMapInner'), {
  ssr: false,
  loading: () => <div className="h-64 sm:h-80 w-full animate-pulse rounded-lg border border-border bg-surface-sunken" />,
});

export default function RouteMap(props: RouteMapInnerProps) {
  return <RouteMapInner {...props} />;
}
