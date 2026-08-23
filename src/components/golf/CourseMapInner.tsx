'use client';

// The actual Leaflet map — loaded ONLY via CourseMap's next/dynamic wrapper
// (ssr:false), so leaflet and its CSS never enter a server bundle or a page
// that doesn't show a map.
//
// Two tile layers, toggleable in-map:
//   osm       — OpenStreetMap raster (attribution required by usage policy)
//   satellite — Esri World Imagery via the public tile endpoint, with Esri's
//               full attribution line. The clean long-term path is Esri's
//               free-tier API key (flagged in DEVLOG; owner signup, later).
//
// Card usages keep the classic layout (fixed height, controls below).
// The live portal's Map tab uses fill+overlayControls: the map owns the
// whole panel and the tracking/layer controls float ON it. `visible` exists
// because Leaflet renders blank tiles when sized while hidden — the parent
// keeps the tab mounted (so tracking survives tab flips) and this component
// invalidates size when shown again.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface CourseMapInnerProps {
  lat: number;
  lng: number;
  courseName: string;
  /** Offer "Track my position" via device geolocation. The position NEVER
   *  leaves the device — map marker only, no writes. */
  enableTracking?: boolean;
  /** Start tracking WITHOUT a click iff permission is already granted —
   *  never auto-prompts. Live portal only. */
  autoTrack?: boolean;
  /** Fill the parent (h-full, square corners) instead of the h-64 card. */
  fill?: boolean;
  /** Overlay the controls on the map instead of below it. */
  overlayControls?: boolean;
  /** Parent-driven visibility for the invalidateSize dance. */
  visible?: boolean;
  defaultLayer?: 'osm' | 'satellite';
}

const OSM = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
const SATELLITE = {
  url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

const courseIcon = () =>
  L.divIcon({
    className: '',
    html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#7c3aed;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });

const playerIcon = () =>
  L.divIcon({
    className: '',
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,.35)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

export default function CourseMapInner({
  lat,
  lng,
  courseName,
  enableTracking = false,
  autoTrack = false,
  fill = false,
  overlayControls = false,
  visible = true,
  defaultLayer = 'osm',
}: CourseMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const playerMarkerRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const followRef = useRef(true);
  const lastFixRef = useRef<[number, number] | null>(null);
  const [tracking, setTracking] = useState(false);
  const [followPaused, setFollowPaused] = useState(false);
  const [layer, setLayer] = useState<'osm' | 'satellite'>(defaultLayer);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: fill }).setView([lat, lng], fill ? 16 : 15);
    const t = layer === 'satellite' ? SATELLITE : OSM;
    tileRef.current = L.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution }).addTo(map);
    L.marker([lat, lng], { icon: courseIcon() }).addTo(map).bindPopup(courseName);
    // Manual pan pauses follow — the map is the player's until they re-center.
    map.on('dragstart', () => {
      if (followRef.current) {
        followRef.current = false;
        setFollowPaused(true);
      }
    });
    mapRef.current = map;
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
      map.remove();
      mapRef.current = null;
    };
    // Mount-only: the course pin doesn't move; layer swaps happen below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layer swap without remount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = layer === 'satellite' ? SATELLITE : OSM;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution }).addTo(map);
  }, [layer]);

  // Blank-tiles guard: a map shown from a hidden tab must re-measure.
  useEffect(() => {
    if (visible) mapRef.current?.invalidateSize();
  }, [visible]);

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    playerMarkerRef.current?.remove();
    playerMarkerRef.current = null;
    accuracyRef.current?.remove();
    accuracyRef.current = null;
    followRef.current = true;
    setFollowPaused(false);
    setTracking(false);
  };

  const startTracking = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Location is not available on this device.');
      return;
    }
    setGeoError(null);
    setTracking(true);
    followRef.current = true;
    setFollowPaused(false);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const map = mapRef.current;
        if (!map) return;
        const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        lastFixRef.current = ll;
        if (!playerMarkerRef.current) {
          playerMarkerRef.current = L.marker(ll, { icon: playerIcon() }).addTo(map);
          accuracyRef.current = L.circle(ll, {
            radius: pos.coords.accuracy,
            weight: 1,
            color: '#2563eb',
            fillOpacity: 0.08,
          }).addTo(map);
        } else {
          playerMarkerRef.current.setLatLng(ll);
          accuracyRef.current?.setLatLng(ll).setRadius(pos.coords.accuracy);
        }
        // Follow mode: keep the player centered hole after hole ("accurate
        // by hole" without per-hole geometry — the player IS the hole).
        if (followRef.current) map.panTo(ll, { animate: true });
      },
      err => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied — enable it in your browser settings to track your position.'
            : 'Could not get your location right now.'
        );
        stopTracking();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  };

  // Silent auto-start: only when permission is ALREADY granted. Never prompts.
  useEffect(() => {
    if (!enableTracking || !autoTrack || tracking) return;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then(status => {
        if (!cancelled && status.state === 'granted') startTracking();
      })
      .catch(() => { /* Permissions API unavailable — stay manual */ });
    return () => { cancelled = true; };
    // Run-once intent; startTracking/tracking are stable enough for this gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableTracking, autoTrack]);

  const recenter = () => {
    followRef.current = true;
    setFollowPaused(false);
    if (lastFixRef.current) mapRef.current?.panTo(lastFixRef.current, { animate: true });
  };

  const trackButton = enableTracking && (
    <button
      type="button"
      onClick={() => (tracking ? stopTracking() : startTracking())}
      className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-medium text-brand-fg shadow-sm ea-interactive"
    >
      <i className="fas fa-location-crosshairs" aria-hidden="true"></i>
      {tracking ? 'Stop tracking' : 'Track my position'}
    </button>
  );

  const layerButton = (
    <button
      type="button"
      onClick={() => setLayer(l => (l === 'satellite' ? 'osm' : 'satellite'))}
      className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-medium text-secondary shadow-sm ea-interactive"
      aria-label={layer === 'satellite' ? 'Switch to map view' : 'Switch to satellite view'}
    >
      <i className={`fas ${layer === 'satellite' ? 'fa-map' : 'fa-satellite'}`} aria-hidden="true"></i>
      {layer === 'satellite' ? 'Map' : 'Satellite'}
    </button>
  );

  return (
    <div className={fill ? 'relative h-full w-full' : ''}>
      <div
        ref={containerRef}
        className={fill ? 'h-full w-full' : 'h-64 w-full rounded-lg border border-border'}
      />
      {overlayControls ? (
        <>
          {/* Leaflet panes sit at z-index ≤ 400 inside the container —
              z-[500] floats these above tiles/markers but below the app's
              modals. */}
          <div className="absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
            {layerButton}
            {trackButton}
            {followPaused && tracking && (
              <button
                type="button"
                onClick={recenter}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-medium text-brand-fg shadow-sm ea-interactive"
              >
                <i className="fas fa-crosshairs" aria-hidden="true"></i>
                Re-center
              </button>
            )}
          </div>
          {geoError && (
            <p className="absolute inset-x-3 top-3 z-[500] mr-40 rounded-lg bg-surface/90 px-3 py-2 text-xs text-tertiary shadow-sm">
              {geoError}
            </p>
          )}
          {enableTracking && (
            <p className="absolute bottom-6 left-3 z-[500] rounded bg-surface/80 px-2 py-1 text-[10px] text-faint">
              Your position stays on your device — never uploaded.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            {enableTracking ? (
              <p className="text-[10px] text-faint">
                Your position stays on your device — it&apos;s never uploaded.
              </p>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {layerButton}
              {trackButton}
            </div>
          </div>
          {geoError && <p className="mt-1 text-xs text-tertiary">{geoError}</p>}
        </>
      )}
    </div>
  );
}
