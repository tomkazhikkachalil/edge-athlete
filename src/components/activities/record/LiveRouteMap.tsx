'use client';

// Dynamic wrapper: Leaflet loads only when a GPS type is being recorded
// (the RouteMap.tsx pattern).

import dynamic from 'next/dynamic';
import type { LiveRouteMapInnerProps } from './LiveRouteMapInner';

const LiveRouteMapInner = dynamic(() => import('./LiveRouteMapInner'), {
  ssr: false,
  loading: () => <div className="h-[40vh] w-full animate-pulse bg-surface-sunken" />,
});

export default function LiveRouteMap(props: LiveRouteMapInnerProps) {
  return <LiveRouteMapInner {...props} />;
}
