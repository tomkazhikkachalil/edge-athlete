'use client';

// The LIVE map (Live Activities): the route as RUNS of solid polyline, each
// extended with the admitted fixes — never redrawn — broken where the app
// could not record (the phone locked, the app closed: `gaps`, resume pill
// program Oct 12 2026) by a straight DASHED bridge; a player marker with its
// accuracy circle (the golf rangefinder's), the segments as coloured spans,
// photo pins, follow mode with a Re-center button. RouteMapInner draws once
// on mount by design, which is why this is its own component rather than a
// prop.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { OSM_TILES } from '@/lib/maps/tiles';
import type { ActivityPoint } from '@/lib/activities/types';
import type { ActivitySegment, SegmentKind } from '@/lib/activities/segments';
import type { RecordingGap } from '@/lib/activities/record/recording';
import { gapBetween } from '@/lib/activities/record/route-gaps';

export interface LiveRouteMapInnerProps {
  points: ActivityPoint[];
  startedAt: number | null;
  segments: ActivitySegment[];
  openSegmentFromS: number | null;
  photos: Array<{ localId: string; atS: number }>;
  accuracy: number | null;
  /** Spans the app could not record — the line breaks there, a dashed bridge across (route-gaps.ts). */
  gaps?: readonly RecordingGap[];
}

const LINE_COLOUR = '#7c3aed';
const lineStyle = (): L.PolylineOptions => ({ color: LINE_COLOUR, weight: 4 });
const casingStyle = (): L.PolylineOptions => ({ color: '#ffffff', weight: 7, opacity: 0.9 });
const bridgeStyle = (): L.PolylineOptions => ({ color: LINE_COLOUR, weight: 3, opacity: 0.7, dashArray: '6 8', interactive: false });

const SEGMENT_COLOURS: Record<SegmentKind, string> = { sprint: '#dc2626', climb: '#d97706', interval: '#2563eb', recovery: '#16a34a', lap: '#7c3aed' };

const playerIcon = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});
const cameraIcon = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:6px;background:white;border:2px solid #7c3aed;display:flex;align-items:center;justify-content:center;font-size:12px">📷</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** The index of the point nearest `atS` seconds into the recording. */
function indexAt(points: ActivityPoint[], startedAt: number, atS: number): number {
  const target = startedAt + atS * 1000;
  let best = 0;
  let gap = Infinity;
  for (let i = 0; i < points.length; i++) {
    const g = Math.abs(points[i].t - target);
    if (g < gap) {
      gap = g;
      best = i;
    }
  }
  return best;
}

export default function LiveRouteMapInner({ points, startedAt, segments, openSegmentFromS, photos, accuracy, gaps = [] }: LiveRouteMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // The CURRENT run's line + casing; finished runs stay on the map untouched.
  const lineRef = useRef<L.Polyline | null>(null);
  const casingRef = useRef<L.Polyline | null>(null);
  const runsLayerRef = useRef<L.LayerGroup | null>(null);
  const bridgeLayerRef = useRef<L.LayerGroup | null>(null);
  const drawnRef = useRef(0);
  // How many of the current line's points are settled (all but the route's provisional end).
  const settledRef = useRef(0);
  // The last positioned point drawn — where a bridge starts when a gap follows it.
  const lastDrawnRef = useRef<ActivityPoint | null>(null);
  const playerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const segmentLayerRef = useRef<L.LayerGroup | null>(null);
  const photoLayerRef = useRef<L.LayerGroup | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: false, attributionControl: true });
    mapRef.current = map;
    L.tileLayer(OSM_TILES.url, { maxZoom: OSM_TILES.maxZoom, attribution: OSM_TILES.attribution }).addTo(map);
    runsLayerRef.current = L.layerGroup().addTo(map);
    bridgeLayerRef.current = L.layerGroup().addTo(map);
    casingRef.current = L.polyline([], casingStyle()).addTo(runsLayerRef.current);
    lineRef.current = L.polyline([], lineStyle()).addTo(runsLayerRef.current);
    segmentLayerRef.current = L.layerGroup().addTo(map);
    photoLayerRef.current = L.layerGroup().addTo(map);
    map.setView([0, 0], 2);
    // A drag pauses following; Re-center resumes it (the rangefinder's rule).
    map.on('dragstart', () => setFollow(false));
    return () => {
      map.remove();
      mapRef.current = null;
      lineRef.current = null;
      casingRef.current = null;
      runsLayerRef.current = null;
      bridgeLayerRef.current = null;
      drawnRef.current = 0;
      settledRef.current = 0;
      lastDrawnRef.current = null;
      playerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // Append the new points only — but the route's LAST point is provisional
  // (gps-filter's end-of-track rule moves or replaces it with every fix), so it
  // is redrawn each time rather than kept: keeping it left a kink per fix.
  // A recorded GAP between the last drawn fix and the next ends the current
  // run: a dashed bridge spans it and a fresh line + casing start after it.
  useEffect(() => {
    const map = mapRef.current;
    const runs = runsLayerRef.current;
    const bridges = bridgeLayerRef.current;
    if (!map || !runs || !bridges || !lineRef.current || !casingRef.current) return;
    let line = lineRef.current;
    let casing = casingRef.current;
    let latLngs = (line.getLatLngs() as L.LatLng[]).slice(0, settledRef.current);
    let lastPositioned = -1;
    for (let i = drawnRef.current; i < points.length; i++) {
      const p = points[i];
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      const prev = lastDrawnRef.current;
      if (prev && latLngs.length > 0 && gaps.length > 0 && gapBetween(prev, p, gaps) && typeof prev.lat === 'number' && typeof prev.lng === 'number') {
        // Close the run as drawn (its provisional end included), bridge, start anew.
        line.setLatLngs(latLngs);
        casing.setLatLngs(latLngs.slice());
        L.polyline([[prev.lat, prev.lng], [p.lat, p.lng]], bridgeStyle()).addTo(bridges);
        casing = L.polyline([], casingStyle()).addTo(runs);
        line = L.polyline([], lineStyle()).addTo(runs);
        casingRef.current = casing;
        lineRef.current = line;
        latLngs = [];
      }
      latLngs.push(L.latLng(p.lat, p.lng));
      lastDrawnRef.current = p;
      lastPositioned = i;
    }
    if (lastPositioned >= 0) {
      line.setLatLngs(latLngs);
      casing.setLatLngs(latLngs.slice());
      settledRef.current = latLngs.length - 1;
      drawnRef.current = lastPositioned;
    }
    const last = points[points.length - 1];
    if (last && typeof last.lat === 'number' && typeof last.lng === 'number') {
      const at: L.LatLngTuple = [last.lat, last.lng];
      if (playerRef.current) playerRef.current.setLatLng(at);
      else playerRef.current = L.marker(at, { icon: playerIcon, interactive: false, title: 'You' }).addTo(map);
      if (accuracy !== null) {
        if (circleRef.current) {
          circleRef.current.setLatLng(at);
          circleRef.current.setRadius(accuracy);
        } else circleRef.current = L.circle(at, { radius: accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
      }
      if (followRef.current) {
        if (points.length === 1) map.setView(at, 17);
        else map.panTo(at, { animate: !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) });
      }
    }
  }, [points, accuracy, gaps]);

  // Segments: redrawn when they change (rare).
  useEffect(() => {
    const layer = segmentLayerRef.current;
    if (!layer || startedAt === null) return;
    layer.clearLayers();
    const spans: Array<{ from: number; to: number; kind: SegmentKind }> = segments.map(s => ({ from: s.from_s, to: s.to_s, kind: s.kind }));
    if (openSegmentFromS !== null && points.length > 0) spans.push({ from: openSegmentFromS, to: (points[points.length - 1].t - startedAt) / 1000, kind: 'interval' });
    for (const span of spans) {
      const a = indexAt(points, startedAt, span.from);
      const b = indexAt(points, startedAt, span.to);
      const latlngs: L.LatLngTuple[] = [];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        const p = points[i];
        if (typeof p?.lat === 'number' && typeof p.lng === 'number') latlngs.push([p.lat, p.lng]);
      }
      if (latlngs.length > 1) L.polyline(latlngs, { color: SEGMENT_COLOURS[span.kind], weight: 6, opacity: 0.85 }).addTo(layer);
    }
  }, [segments, openSegmentFromS, points, startedAt]);

  useEffect(() => {
    const layer = photoLayerRef.current;
    if (!layer || startedAt === null) return;
    layer.clearLayers();
    for (const ph of photos) {
      const p = points[indexAt(points, startedAt, ph.atS)];
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') L.marker([p.lat, p.lng], { icon: cameraIcon, interactive: false }).addTo(layer);
    }
  }, [photos, points, startedAt]);

  return (
    // `isolate`: Leaflet's panes are z-index 400+; without a stacking context
    // here they rise above the page's own layers — the review sheet (z-50)
    // opened with the map drawn over its top half (Oct 9 2026).
    <div className="relative isolate">
      <div ref={containerRef} className="h-[40vh] min-h-[220px] w-full" data-record-map="" />
      {!follow && (
        <button
          type="button"
          onClick={() => {
            setFollow(true);
            const last = points[points.length - 1];
            if (last && typeof last.lat === 'number' && typeof last.lng === 'number') mapRef.current?.panTo([last.lat, last.lng]);
          }}
          className="absolute bottom-3 right-3 z-[400] rounded-full bg-surface/95 px-3 py-1.5 text-sm font-semibold text-primary shadow-md border border-border min-h-[36px]"
        >
          Re-center
        </button>
      )}
    </div>
  );
}
