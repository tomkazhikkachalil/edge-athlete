'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SATELLITE_TILES } from '@/lib/maps/tiles';

/**
 * The scoring card's map preview (Tom's live-round spec, Nov 25 2026 — A9):
 * a small, STILL crop of the real map for the hole on the card, with its
 * line of play. Not a second map to use: no drag, no zoom, no controls, no
 * pointer events at all — the tile around it is the button, and it opens the
 * real map on this hole.
 *
 * The same satellite tiles the live map opens on. The tile credits are not
 * drawn in a 64 px crop; they are on the map this opens, and in the
 * preview's accessible description.
 */
interface HoleMapPreviewInnerProps {
  /** The hole's line of play, tee first: [lat, lng][]. */
  line: ReadonlyArray<readonly [number, number]> | null;
  /** Where to look when the hole has no line: the course. */
  fallback: readonly [number, number] | null;
}

export default function HoleMapPreviewInner({ line, fallback }: HoleMapPreviewInnerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      zoomSnap: 0.25,
    });
    L.tileLayer(SATELLITE_TILES.url, { maxZoom: SATELLITE_TILES.maxZoom }).addTo(map);
    markRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markRef.current = null;
    };
  }, []);

  const key = line ? line.map(p => `${p[0]},${p[1]}`).join(';') : fallback ? `at:${fallback[0]},${fallback[1]}` : '';
  useEffect(() => {
    const map = mapRef.current;
    const marks = markRef.current;
    if (!map || !marks) return;
    marks.clearLayers();
    if (line && line.length >= 2) {
      const points = line.map(p => [p[0], p[1]] as [number, number]);
      // The line of play as the map draws it: a white casing, the route on top.
      L.polyline(points, { color: '#ffffff', weight: 4, opacity: 0.9, interactive: false }).addTo(marks);
      L.polyline(points, { color: '#8b5cf6', weight: 2, opacity: 1, interactive: false }).addTo(marks);
      map.fitBounds(L.latLngBounds(points), { padding: [8, 8], animate: false, maxZoom: 18 });
    } else if (fallback) {
      map.setView([fallback[0], fallback[1]], 15, { animate: false });
    }
    // `key` is the content of `line` / `fallback`: a new array of the same
    // hole must not refit the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={elRef} className="h-full w-full" style={{ pointerEvents: 'none', background: 'var(--mech-recess)' }} data-hole-map-preview="" />;
}
