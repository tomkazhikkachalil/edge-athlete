'use client';

// The activity route map — loaded ONLY through RouteMap's next/dynamic
// wrapper (ssr:false), so Leaflet and its CSS never reach a page without a
// map. Same tiles as the course map (src/lib/maps/tiles.ts). The route is
// drawn as it arrives: a viewer's stream is already trimmed by the server
// (nulls at both ends), so this never re-derives privacy — it only draws.
// Start / finish markers are the owner's (a viewer's ends are not the
// real ends, and a marker would pretend otherwise).
//
// A FRAMED picture, not a navigation tool (Oct 9 2026, route-frame.ts): the
// camera lives inside the padded box around the route (`maxBounds`, viscosity
// 1 — it STOPS at the edge), zooms out no further than the box filling the
// container and in no further than street level, has no zoom control (a
// "Fit route" button instead), no scroll-wheel zoom (the page scrolls), no
// keyboard or box zoom. Leaflet has no rotation or tilt. The base map is
// muted (`ea-route-frame`, globals.css) so the route is the focus. The box is
// computed from the stream THIS viewer was given — never stored.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { OSM_TILES, SATELLITE_TILES } from '@/lib/maps/tiles';
import { FRAME, padBounds, routeBounds, type GeoBounds } from '@/lib/activities/route-frame';

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const toLatLngBounds = (b: GeoBounds) => L.latLngBounds([b.south, b.west], [b.north, b.east]);

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
  const routeBoundsRef = useRef<L.LatLngBounds | null>(null);
  const [layer, setLayer] = useState<'osm' | 'satellite'>('osm');

  /** The default framing: the route with a little room, no motion under reduced motion. */
  const fitRoute = (map: L.Map, animate: boolean) => {
    const rb = routeBoundsRef.current;
    if (rb) map.fitBounds(rb, { padding: [FRAME.fitPaddingPx, FRAME.fitPaddingPx], animate: animate && !reducedMotion() });
  };

  /** The camera, mirrored onto the container for the e2e hooks (read-only). */
  const mirror = (map: L.Map, frame: GeoBounds | null) => {
    const el = containerRef.current;
    if (!el) return;
    const c = map.getCenter();
    el.dataset.mapZoom = String(map.getZoom());
    el.dataset.mapMinZoom = String(map.getMinZoom());
    el.dataset.mapMaxZoom = String(map.getMaxZoom());
    el.dataset.mapCenter = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
    if (frame) el.dataset.mapBounds = `${frame.south},${frame.west},${frame.north},${frame.east}`;
    el.dataset.mapAnimate = reducedMotion() ? 'false' : 'true';
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const segs = segments(lat, lng);
    const rb = routeBounds(lat, lng);
    const frame = rb ? padBounds(rb) : null;
    const still = reducedMotion();
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: false,
      boxZoom: false,
      keyboard: false,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      maxZoom: FRAME.maxZoom,
      maxBounds: frame ? toLatLngBounds(frame) : undefined,
      maxBoundsViscosity: 1.0,
      zoomAnimation: !still,
      fadeAnimation: !still,
      markerZoomAnimation: !still,
      attributionControl: false,
    });
    // The OSM / Esri credit is a licence condition, not chrome: kept, without the "Leaflet" link.
    L.control.attribution({ prefix: false }).addTo(map);
    mapRef.current = map;
    routeBoundsRef.current = rb ? toLatLngBounds(rb) : null;
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
    if (rb && frame) {
      fitRoute(map, false);
      // Zooming out stops where the padded box fills the container — the whole
      // route visible and the map no wider. Recomputed on every resize (a
      // phone turned sideways — and the container's FIRST real size: WebKit
      // can hand the map a container that is still settling, so the initial
      // fit is one level off until this fires), and the route refitted.
      const applyMinZoom = () => {
        const min = Math.min(map.getBoundsZoom(toLatLngBounds(frame), false), FRAME.maxZoom);
        map.setMinZoom(min);
        if (map.getZoom() < min) fitRoute(map, false);
        mirror(map, frame);
      };
      applyMinZoom();
      const ro = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            map.invalidateSize({ animate: false });
            fitRoute(map, false);
            applyMinZoom();
          })
        : null;
      ro?.observe(containerRef.current);
      map.on('moveend zoomend', () => mirror(map, frame));
      return () => {
        ro?.disconnect();
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    }
    map.setView([0, 0], 1);
    mirror(map, null);
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

  const pill =
    'absolute z-[400] rounded-full bg-surface/95 px-3 py-1.5 text-sm font-semibold text-primary shadow-md border border-border min-h-[36px]';
  return (
    // `isolate` keeps Leaflet's z-400 panes inside the map, under the page's
    // dialogs (the recorder's review sheet sat under its map — Oct 9 2026).
    <div className="relative isolate">
      <div
        ref={containerRef}
        className={`h-64 sm:h-80 w-full rounded-lg border border-border overflow-hidden${layer === 'osm' ? ' ea-route-frame' : ''}`}
        data-activity-map
        data-route-frame=""
      />
      <button type="button" onClick={() => setLayer(l => (l === 'osm' ? 'satellite' : 'osm'))} className={`${pill} top-2 right-2`}>
        {layer === 'osm' ? 'Satellite' : 'Map'}
      </button>
      <button
        type="button"
        onClick={() => {
          const map = mapRef.current;
          if (map) fitRoute(map, true);
        }}
        className={`${pill} bottom-2 right-2`}
        aria-label="Fit route"
        data-route-fit=""
      >
        Fit route
      </button>
    </div>
  );
}
