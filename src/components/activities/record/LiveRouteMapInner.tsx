'use client';

// The LIVE map (Live Activities): ONE polyline extended with each admitted
// fix — never redrawn — a player marker with its accuracy circle (the golf
// rangefinder's), the segments as coloured spans, photo pins, follow mode
// with a Re-center button. RouteMapInner draws once on mount by design,
// which is why this is its own component rather than a prop.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { OSM_TILES } from '@/lib/maps/tiles';
import type { ActivityPoint } from '@/lib/activities/types';
import type { ActivitySegment, SegmentKind } from '@/lib/activities/segments';

export interface LiveRouteMapInnerProps {
  points: ActivityPoint[];
  startedAt: number | null;
  segments: ActivitySegment[];
  openSegmentFromS: number | null;
  photos: Array<{ localId: string; atS: number }>;
  accuracy: number | null;
}

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

export default function LiveRouteMapInner({ points, startedAt, segments, openSegmentFromS, photos, accuracy }: LiveRouteMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const casingRef = useRef<L.Polyline | null>(null);
  const drawnRef = useRef(0);
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
    casingRef.current = L.polyline([], { color: '#ffffff', weight: 7, opacity: 0.9 }).addTo(map);
    lineRef.current = L.polyline([], { color: '#7c3aed', weight: 4 }).addTo(map);
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
      drawnRef.current = 0;
      playerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // Append the new fixes only.
  useEffect(() => {
    const map = mapRef.current;
    const line = lineRef.current;
    const casing = casingRef.current;
    if (!map || !line || !casing) return;
    for (let i = drawnRef.current; i < points.length; i++) {
      const p = points[i];
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      line.addLatLng([p.lat, p.lng]);
      casing.addLatLng([p.lat, p.lng]);
    }
    drawnRef.current = points.length;
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
        else map.panTo(at, { animate: true });
      }
    }
  }, [points, accuracy]);

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
    <div className="relative">
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
