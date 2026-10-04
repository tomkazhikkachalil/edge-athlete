'use client';

// The activity route map — loaded ONLY through RouteMap's next/dynamic
// wrapper (ssr:false), so Leaflet and its CSS never reach a page without a
// map. Same tiles as the course map (src/lib/maps/tiles.ts). The route is
// drawn as it arrives: a viewer's stream is already trimmed by the server
// (nulls at both ends), so this never re-derives privacy — it only draws.
// Start / finish markers are the owner's (a viewer's ends are not the
// real ends, and a marker would pretend otherwise).

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { OSM_TILES, SATELLITE_TILES } from '@/lib/maps/tiles';

export interface RouteMapInnerProps {
  lat: (number | null)[];
  lng: (number | null)[];
  /** Owner only: mark the real start and finish. */
  showEnds: boolean;
  /** The chart's hovered sample, marked on the route. */
  highlightIndex?: number | null;
  /** Live Activities (251): a segment's span, drawn over the route. */
  highlightRange?: [number, number] | null;
  /** Live Activities (251): the photos' pins (already resolved for THIS viewer). */
  pins?: Array<{ id: string; at: [number, number] }>;
}

const dot = (bg: string, size: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

/** Consecutive runs of fixed points; a null (a trimmed end, a lost fix) breaks the line. */
function segments(lat: (number | null)[], lng: (number | null)[]): L.LatLngTuple[][] {
  const out: L.LatLngTuple[][] = [];
  let cur: L.LatLngTuple[] = [];
  for (let i = 0; i < lat.length; i++) {
    const a = lat[i];
    const b = lng[i];
    if (a === null || b === null || a === undefined || b === undefined) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else {
      cur.push([a, b]);
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

const cameraIcon = L.divIcon({
  className: '',
  html: '<div style="width:24px;height:24px;border-radius:6px;background:white;border:2px solid #7c3aed;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.3)">📷</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export default function RouteMapInner({ lat, lng, showEnds, highlightIndex, highlightRange, pins }: RouteMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const rangeRef = useRef<L.Polyline | null>(null);
  const pinsRef = useRef<L.LayerGroup | null>(null);
  const [layer, setLayer] = useState<'osm' | 'satellite'>('osm');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const segs = segments(lat, lng);
    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: true });
    mapRef.current = map;
    tileRef.current = L.tileLayer(OSM_TILES.url, { maxZoom: OSM_TILES.maxZoom, attribution: OSM_TILES.attribution }).addTo(map);
    for (const s of segs) {
      L.polyline(s, { color: '#ffffff', weight: 7, opacity: 0.9 }).addTo(map);
      L.polyline(s, { color: '#7c3aed', weight: 4 }).addTo(map);
    }
    if (showEnds && segs.length > 0) {
      const first = segs[0][0];
      const lastSeg = segs[segs.length - 1];
      const last = lastSeg[lastSeg.length - 1];
      L.marker(first, { icon: dot('#16a34a', 16), title: 'Start' }).addTo(map);
      L.marker(last, { icon: dot('#dc2626', 16), title: 'Finish' }).addTo(map);
    }
    const all = segs.flat();
    if (all.length > 0) map.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
    else map.setView([0, 0], 1);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Mount-only: an activity's route never changes under the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = layer === 'satellite' ? SATELLITE_TILES : OSM_TILES;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution }).addTo(map);
  }, [layer]);

  // A segment's span (251): one overlay polyline, redrawn when the range changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    rangeRef.current?.remove();
    rangeRef.current = null;
    if (!highlightRange) return;
    const [from, to] = highlightRange;
    const pts: L.LatLngTuple[] = [];
    for (let i = Math.max(0, Math.min(from, to)); i <= Math.min(lat.length - 1, Math.max(from, to)); i++) {
      const a = lat[i];
      const b = lng[i];
      if (a !== null && b !== null && a !== undefined && b !== undefined) pts.push([a, b]);
    }
    if (pts.length > 1) rangeRef.current = L.polyline(pts, { color: '#dc2626', weight: 6, opacity: 0.9 }).addTo(map);
  }, [highlightRange, lat, lng]);

  // Photo pins (251): where each photo was taken — resolved by the server for this viewer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pinsRef.current?.remove();
    pinsRef.current = null;
    if (!pins || pins.length === 0) return;
    const group = L.layerGroup().addTo(map);
    for (const p of pins) L.marker(p.at, { icon: cameraIcon, title: 'Photo', interactive: false }).addTo(group);
    pinsRef.current = group;
  }, [pins]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const i = highlightIndex ?? null;
    const a = i !== null ? lat[i] : null;
    const b = i !== null ? lng[i] : null;
    if (a === null || b === null || a === undefined || b === undefined) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current) markerRef.current.setLatLng([a, b]);
    else markerRef.current = L.marker([a, b], { icon: dot('#7c3aed', 14), interactive: false }).addTo(map);
  }, [highlightIndex, lat, lng]);

  return (
    <div className="relative">
      <div ref={containerRef} className="h-64 sm:h-80 w-full rounded-lg border border-border overflow-hidden" data-activity-map />
      <button
        type="button"
        onClick={() => setLayer(l => (l === 'osm' ? 'satellite' : 'osm'))}
        className="absolute top-2 right-2 z-[400] rounded-full bg-surface/95 px-3 py-1.5 text-sm font-semibold text-primary shadow-md border border-border min-h-[36px]"
      >
        {layer === 'osm' ? 'Satellite' : 'Map'}
      </button>
    </div>
  );
}
