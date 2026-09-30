// A route's line drawing from its stored preview (already trimmed by the
// server). Server-safe: no hooks, no Leaflet. Renders nothing without a route.

import { routeSvg } from '@/lib/activities/route-svg';

export default function RouteThumb({ preview, className = '', w = 160, h = 90 }: { preview: string | null; className?: string; w?: number; h?: number }) {
  const svg = routeSvg(preview, w, h);
  if (!svg) return null;
  return (
    <svg viewBox={svg.viewBox} className={className} role="img" aria-label="Route" preserveAspectRatio="xMidYMid meet">
      <path d={svg.d} fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={0.18} />
      <path d={svg.d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
