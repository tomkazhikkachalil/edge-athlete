'use client';

// Dynamic wrapper: leaflet (~42KB gz + CSS) loads only when a map actually
// renders. Every map in the app goes through this — one map system.

import dynamic from 'next/dynamic';

const CourseMapInner = dynamic(() => import('./CourseMapInner'), {
  ssr: false,
  loading: () => (
    <div className="h-full min-h-64 w-full animate-pulse rounded-lg border border-border bg-surface-sunken" />
  ),
});

export default function CourseMap(props: {
  lat: number;
  lng: number;
  courseName: string;
  enableTracking?: boolean;
  autoTrack?: boolean;
  fill?: boolean;
  overlayControls?: boolean;
  visible?: boolean;
  defaultLayer?: 'osm' | 'satellite';
  holes?: import('@/lib/golf/hole-geometry').HoleLine[] | null;
  greens?: import('@/lib/golf/hole-geometry').GreenRing[] | null;
  focusHole?: number | null;
  onHoleTap?: (hole: number) => void;
  onFix?: (fix: [number, number] | null) => void;
  captionInset?: number;
  fitNonce?: number;
  elevation?: import('@/lib/golf/elevation').HoleElevation | null;
}) {
  return <CourseMapInner {...props} />;
}
