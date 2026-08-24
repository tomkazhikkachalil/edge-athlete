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
import { greenDistanceYards, targetDistances, type HoleLine } from '@/lib/golf/hole-geometry';

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
  /** Per-hole OSM geometry: numbered labels at every tee. */
  holes?: HoleLine[] | null;
  /** Fit the view to this hole and draw its tee→green line. Focusing pauses
   *  follow (same as a drag) — Re-center returns to the player. */
  focusHole?: number | null;
  onHoleTap?: (hole: number) => void;
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

// The player-placed target: an orange ring inside a 44px transparent hit
// area (drag handle on a phone with a glove on). Distinct from every other
// marker colour on the map (violet course pin, blue player, green flag).
const targetIcon = () =>
  L.divIcon({
    className: '',
    html: '<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center"><div style="width:22px;height:22px;border-radius:50%;border:3px solid #f97316;background:rgba(255,255,255,.35);box-shadow:0 0 0 2px rgba(255,255,255,.9),0 1px 4px rgba(0,0,0,.4)"></div></div>',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

const TARGET_LINE = { weight: 3, opacity: 0.95, dashArray: '2 8' } as const;
const TARGET_LINE_HALO = { weight: 6, opacity: 0.8, dashArray: '2 8', color: '#ffffff' } as const;

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
  holes = null,
  focusHole = null,
  onHoleTap,
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
  // Mirrors lastFixRef into render for the yardage pill (~1 update/s while
  // tracking; nothing but the pill depends on it). On-device only.
  const [playerFix, setPlayerFix] = useState<[number, number] | null>(null);
  const [layer, setLayer] = useState<'osm' | 'satellite'>(defaultLayer);
  const [geoError, setGeoError] = useState<string | null>(null);
  // ── Rangefinder target ────────────────────────────────────────────────────
  // A point the player drops on the focused hole ("can I carry that water?").
  // Keyed by hole so stepping to another hole drops it BY DERIVATION — no
  // setState in an effect. The map's click handler is registered once at
  // mount and reads the focused line through a ref.
  const [target, setTarget] = useState<{ hole: number; ll: [number, number] } | null>(null);
  const focusedLineRef = useRef<{ hole: number; line: [number, number][] } | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const targetLinesRef = useRef<L.LayerGroup | null>(null);

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
    // Tap-to-target, only while a hole is focused. A pan never fires click;
    // marker taps don't bubble here (Leaflet markers default
    // bubblingMouseEvents:false), so tee labels keep their tap-to-focus.
    map.on('click', e => {
      const f = focusedLineRef.current;
      if (!f) return;
      setTarget({ hole: f.hole, ll: [e.latlng.lat, e.latlng.lng] });
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

  // ── Per-hole geometry layers (OSM golf=hole ways) ─────────────────────────
  const holeLabelsRef = useRef<L.LayerGroup | null>(null);
  const focusLineRef = useRef<L.LayerGroup | null>(null);
  const onHoleTapRef = useRef(onHoleTap);
  useEffect(() => {
    onHoleTapRef.current = onHoleTap;
  }, [onHoleTap]);

  // Numbered label at every tee — "the holes, correctly labeled".
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    holeLabelsRef.current?.remove();
    holeLabelsRef.current = null;
    if (!holes?.length) return;
    const group = L.layerGroup();
    for (const h of holes) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:rgba(17,24,39,.82);color:#fff;font:700 11px/22px system-ui;text-align:center;border:1.5px solid rgba(255,255,255,.9);box-shadow:0 1px 3px rgba(0,0,0,.5)">${h.hole}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = L.marker(h.line[0], { icon, keyboard: false });
      marker.on('click', () => onHoleTapRef.current?.(h.hole));
      group.addLayer(marker);
    }
    group.addTo(map);
    holeLabelsRef.current = group;
    return () => {
      holeLabelsRef.current?.remove();
      holeLabelsRef.current = null;
    };
  }, [holes]);

  // Focused hole: tee→green line + green dot, and the view fits the hole.
  // This is the "bring me to hole N" behavior; it takes the map from
  // follow-the-player (Re-center hands it back).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    focusLineRef.current?.remove();
    focusLineRef.current = null;
    const h = focusHole != null ? holes?.find(x => x.hole === focusHole) : null;
    if (!h) return;
    const group = L.layerGroup();
    group.addLayer(L.polyline(h.line, { color: '#ffffff', weight: 6, opacity: 0.85 }));
    group.addLayer(L.polyline(h.line, { color: '#7c3aed', weight: 3, opacity: 0.95 }));
    group.addLayer(
      L.circleMarker(h.line[h.line.length - 1], {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#16a34a',
        fillOpacity: 1,
      })
    );
    group.addTo(map);
    focusLineRef.current = group;
    // Ref-only: the Re-center button's visibility derives from focusActive
    // in render (setState here trips react-hooks/set-state-in-effect).
    followRef.current = false;
    map.fitBounds(L.latLngBounds(h.line), { padding: [60, 60], maxZoom: 18 });
    return () => {
      focusLineRef.current?.remove();
      focusLineRef.current = null;
    };
  }, [focusHole, holes]);

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
    setPlayerFix(null);
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
        setPlayerFix(ll);
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
        // Only a permission denial is fatal. TIMEOUT and POSITION_UNAVAILABLE
        // are TRANSIENT — a golfer standing still for 15s trips the timeout
        // (no new fix ≠ no permission), tree cover trips unavailable — and
        // stopping the watch on those silently killed tracking mid-round
        // (probe-caught). Keep watching; the next good fix just resumes.
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError(
            'Location permission was denied — enable it in your browser settings to track your position.'
          );
          stopTracking();
        }
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

  // A focused hole suspends follow (the effect writes followRef); the button
  // is DERIVED from the prop so it stays available for the whole hole view —
  // Re-center pans to the player and resumes follow while the hole stays
  // drawn (on-course, the player is standing on that hole anyway).
  const focusActive = focusHole != null && !!holes?.some(h => h.hole === focusHole);
  // The rangefinder number: player's live fix → the focused hole's green
  // (line end — "to green", never "to pin"). Null past 1500 yds so a
  // couch-peek shows nothing. Computed on-device; the fix never uploads.
  const focusedLine = focusHole != null ? holes?.find(h => h.hole === focusHole)?.line : undefined;
  const distanceYds = playerFix && focusedLine ? greenDistanceYards(playerFix, focusedLine) : null;

  // The click handler above reads the focused line via this ref (mirrored
  // in an effect, same as onHoleTapRef — refs aren't read during render).
  useEffect(() => {
    focusedLineRef.current = focusedLine && focusHole != null ? { hole: focusHole, line: focusedLine } : null;
  }, [focusedLine, focusHole]);

  const activeTarget = target && target.hole === focusHole && focusedLine ? target.ll : null;
  // Origin = the live fix while tracking, else the tee: planning a hole
  // from the couch (or before tracking starts) still gets real numbers.
  const targetOrigin: [number, number] | null = focusedLine ? (playerFix ?? focusedLine[0]) : null;
  const targetYds =
    activeTarget && focusedLine && targetOrigin ? targetDistances(targetOrigin, activeTarget, focusedLine) : null;

  // Draw the target: draggable marker + dashed origin→target and
  // target→green legs. Redraws on every fix while tracking (cheap: three
  // polylines). The marker persists across redraws; it's dropped when the
  // target clears (hole change, ✕).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    targetLinesRef.current?.remove();
    targetLinesRef.current = null;
    if (!activeTarget || !focusedLine || !targetOrigin) {
      targetMarkerRef.current?.remove();
      targetMarkerRef.current = null;
      return;
    }
    if (!targetMarkerRef.current) {
      const marker = L.marker(activeTarget, {
        icon: targetIcon(),
        draggable: true,
        keyboard: false,
        zIndexOffset: 500,
      });
      const move = () => {
        const f = focusedLineRef.current;
        const ll = marker.getLatLng();
        if (f) setTarget({ hole: f.hole, ll: [ll.lat, ll.lng] });
      };
      marker.on('drag', move);
      marker.on('dragend', move);
      marker.addTo(map);
      targetMarkerRef.current = marker;
    } else {
      targetMarkerRef.current.setLatLng(activeTarget);
    }
    const green = focusedLine[focusedLine.length - 1];
    const group = L.layerGroup();
    group.addLayer(L.polyline([targetOrigin, activeTarget], TARGET_LINE_HALO));
    group.addLayer(L.polyline([targetOrigin, activeTarget], { ...TARGET_LINE, color: '#f97316' }));
    group.addLayer(L.polyline([activeTarget, green], TARGET_LINE_HALO));
    group.addLayer(L.polyline([activeTarget, green], { ...TARGET_LINE, color: '#16a34a' }));
    group.addTo(map);
    targetLinesRef.current = group;
    return () => {
      targetLinesRef.current?.remove();
      targetLinesRef.current = null;
    };
  }, [activeTarget, focusedLine, targetOrigin]);

  const targetPill = targetYds && (
    <div
      aria-live="polite"
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border bg-surface/90 py-1 pl-3 pr-1 text-sm font-bold text-primary shadow-sm"
    >
      <i className="fas fa-bullseye text-orange-500" aria-hidden="true"></i>
      <span>
        {!playerFix && <span className="font-medium text-secondary">from tee: </span>}
        {targetYds.toTarget} to target · {targetYds.targetToGreen} to green
      </span>
      <button
        type="button"
        onClick={() => setTarget(null)}
        aria-label="Clear target"
        className="ea-icon-btn inline-flex items-center justify-center text-secondary"
      >
        <i className="fas fa-xmark text-xs" aria-hidden="true"></i>
      </button>
    </div>
  );
  const targetHint = focusedLine && !activeTarget;

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
            {(followPaused || focusActive) && tracking && (
              <button
                type="button"
                onClick={recenter}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-medium text-brand-fg shadow-sm ea-interactive"
              >
                <i className="fas fa-crosshairs" aria-hidden="true"></i>
                Re-center
              </button>
            )}
            {tracking && distanceYds != null && (
              <p
                aria-live="polite"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-bold text-primary shadow-sm"
              >
                <i className="fas fa-flag text-green-600" aria-hidden="true"></i>
                {distanceYds} yds to green
              </p>
            )}
            {targetPill}
          </div>
          {geoError && (
            <p className="absolute inset-x-3 top-3 z-[500] mr-40 rounded-lg bg-surface/90 px-3 py-2 text-xs text-tertiary shadow-sm">
              {geoError}
            </p>
          )}
          {(enableTracking || targetHint) && (
            <div className="absolute bottom-6 left-3 z-[500] flex flex-col items-start gap-1">
              {targetHint && (
                <p className="rounded bg-surface/80 px-2 py-1 text-[10px] text-faint">
                  Tap the map to set a target
                </p>
              )}
              {enableTracking && (
                <p className="rounded bg-surface/80 px-2 py-1 text-[10px] text-faint">
                  Your position stays on your device — never uploaded.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            {enableTracking ? (
              <p className="text-[10px] text-faint">
                Your position stays on your device — it&apos;s never uploaded.
              </p>
            ) : targetHint ? (
              <p className="text-[10px] text-faint">Tap the map to set a target</p>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {layerButton}
              {trackButton}
            </div>
          </div>
          {targetPill && <div className="mt-2">{targetPill}</div>}
          {geoError && <p className="mt-1 text-xs text-tertiary">{geoError}</p>}
        </>
      )}
    </div>
  );
}
