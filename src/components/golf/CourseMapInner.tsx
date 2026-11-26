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
import { greenPoint, targetDistances, type GreenRing, type HoleLine } from '@/lib/golf/hole-geometry';
import { ringCentroid } from '@/lib/golf/green';
import { chipDistanceLines, greenLabel, liveLine, playsLikeShort } from '@/lib/golf/hole-detail';
import type { HoleElevation } from '@/lib/golf/elevation';
import { OSM_TILES, SATELLITE_TILES } from '@/lib/maps/tiles';
import { followDefault, shouldPan } from '@/lib/golf/map-follow';
import { COPY } from '@/lib/copy';
import FaIcon from '@/components/FaIcon';
import { faBullseye } from '@/lib/icons/fa/bullseye';
import { faFlag } from '@/lib/icons/fa/flag';
import { faLocationCrosshairs } from '@/lib/icons/fa/location-crosshairs';
import { faMap } from '@/lib/icons/fa/map';
import { faSatellite } from '@/lib/icons/fa/satellite';
import { faXmark } from '@/lib/icons/fa/xmark';
import { CloseIcon, FollowIcon, LayersIcon, LocateIcon, MinusIcon, PlusIcon, RecenterIcon, TargetIcon } from '@/components/golf/scoring/icons';

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
  /** PR 3: the green outlines independently of the lines — a numbered
   *  ring with no line still gets its label, dot, flag and distance; the
   *  UNNUMBERED rings (greens-only) draw faintly and feed "Nearest green". */
  greens?: GreenRing[] | null;
  /** Fit the view to this hole and draw its tee→green line. Focusing pauses
   *  follow (same as a drag) — Re-center returns to the player. */
  focusHole?: number | null;
  onHoleTap?: (hole: number) => void;
  /** PR D: the ONE position watcher lives here — every fix (and the stop,
   *  as null) is PUBLISHED so the page can hand it to the scorer. */
  onFix?: (fix: [number, number] | null) => void;
  /** Overlay mode: the Set target key was tapped with no target set — the
   *  caller shows how a target is set (the info panel). */
  onTargetHelp?: () => void;
  /** Overlay mode: the caller's notes about the hole (not mapped, pick a
   *  nine…), drawn first in the column under the hole plate. */
  overlayNotes?: React.ReactNode;
  /** Overlay mode: the caller's panel above the bottom bar (the info hints). */
  overlayFooter?: React.ReactNode;
  /** M1: bump to re-fit the view to the focused hole even when the hole
   *  has not changed (the page's "first hole" control after a drag). */
  fitNonce?: number;
  /** M2: the course's elevation profile — the pill shows the plays-like
   *  beside the live distance when the focused hole has one. */
  elevation?: HoleElevation | null;
}

// The tile layers are shared with the activity route map (src/lib/maps/tiles.ts).
const OSM = OSM_TILES;
const SATELLITE = SATELLITE_TILES;

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
    // The live-round spec (Nov 25 2026, D4): a 13 px dot in the position
    // colour with a 2 px white stroke, in a soft 30 px halo.
    html: '<div data-player-dot="" style="width:30px;height:30px;border-radius:50%;background:rgba(77,163,255,.28);display:flex;align-items:center;justify-content:center"><div style="width:13px;height:13px;border-radius:50%;background:#4da3ff;border:2px solid #ffffff;box-sizing:content-box;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
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

// The green's flag. No pin position exists in any course data — this marks
// the END of the hole's line, the centre of the green — but a 6px green dot
// on satellite grass was "hard to tell where the pin is" (Tom, Oct 2026).
// A red flag on a white-cased pole, anchored at the pole's foot ON the point;
// never interactive, so a tap on the green still places the target.
const FLAG_H = 36;
// The live page's control column over the map's top-right corner: four 40px
// buttons (layer, track, Follow me, Re-center), then the distance pill
// (~170px wide), from 12px in. gps-hole-flag.spec measures the flag clear of it.
const CONTROL_COLUMN_W = 76;
const CONTROL_COLUMN_H = 280;

// A round key over the map (the live-round spec, section B): 44 px, the raised grey; accent while on.
// Sized in px, like every offset around it: `rem` grows with the reader's text
// size, and keys that grow walk into the plate and the pills beside them.
/**
 * One zoom step from a key. Leaflet drops a zoom request made while the last
 * zoom is still animating (`_tryAnimatedZoom` returns early), so a quick
 * second tap was lost. Taps made during an animation are added up and applied
 * together when it ends.
 */
const pendingZoom = new WeakMap<L.Map, number>();
function stepZoom(map: L.Map | null, delta: 1 | -1) {
  if (!map) return;
  const animating = (map as unknown as { _animatingZoom?: boolean })._animatingZoom === true;
  if (!animating) {
    map.setZoom(map.getZoom() + delta);
    return;
  }
  const waiting = pendingZoom.has(map);
  pendingZoom.set(map, (pendingZoom.get(map) ?? 0) + delta);
  if (waiting) return;
  map.once('zoomend', () => {
    const steps = pendingZoom.get(map) ?? 0;
    pendingZoom.delete(map);
    if (steps !== 0) map.setZoom(map.getZoom() + steps);
  });
}

const ROUND_KEY = 'ea-mech-round inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center disabled:opacity-40';

const flagIcon = () =>
  L.divIcon({
    className: '',
    html: '<svg data-green-flag="" width="30" height="36" viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))"><path d="M5 34V3" stroke="#141318" stroke-width="5" stroke-linecap="round" opacity=".55"/><path d="M5 34V3" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/><path d="M6 3.5 26 10 6 16.5Z" fill="#e5333b" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    iconSize: [30, FLAG_H],
    iconAnchor: [5, 34],
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
  holes = null,
  greens = null,
  focusHole = null,
  onHoleTap,
  onFix,
  onTargetHelp,
  overlayNotes,
  overlayFooter,
  fitNonce = 0,
  elevation = null,
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
  // ── Follow me (M1) ────────────────────────────────────────────────────────
  // The player's INTENT: null until the first fix after tracking starts
  // decides it (on at the course, off elsewhere — map-follow.ts), then the
  // toggle's. `followRef` above is the PAUSE (a drag, a hole fit); panning
  // needs both. The watcher is registered once, so the intent and the holes
  // reach it through refs; `panAllowed` mirrors the last decision into
  // render for the toggle's data hook.
  const [follow, setFollow] = useState<boolean | null>(null);
  const followIntentRef = useRef<boolean | null>(null);
  const followDecidedRef = useRef(false);
  const holesRef = useRef(holes);
  const [panAllowed, setPanAllowed] = useState(false);
  // Mirrors lastFixRef into render for the yardage pill (~1 update/s while
  // tracking; nothing but the pill depends on it). On-device only.
  const [playerFix, setPlayerFix] = useState<[number, number] | null>(null);
  const [layer, setLayer] = useState<'osm' | 'satellite'>(defaultLayer);
  const [geoError, setGeoError] = useState<string | null>(null);
  // ── Rangefinder target ────────────────────────────────────────────────────
  // A point the player drops on the focused hole ("can I carry that water?").
  // Keyed by hole so it only ever renders on the hole it was placed on, and
  // a DIFFERENT hole clears it for good (Tom's call — no per-hole memory).
  // The map's click handler is registered once at mount and reads the
  // focused line through a ref.
  const [target, setTarget] = useState<{ hole: number; ll: [number, number] } | null>(null);
  // Render-time reset, the sanctioned "adjust state when a prop changes"
  // shape (not an effect). Only a different HOLE clears it: focusHole is
  // null while the Scorecard tab shows, and a tab flip is not a hole step.
  if (target && focusHole != null && target.hole !== focusHole) setTarget(null);
  const focusedLineRef = useRef<{ hole: number; line: [number, number][] } | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const targetLinesRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Overlay mode (the live page) draws its own zoom keys and its own credit
    // strip; the card map keeps Leaflet's.
    const map = L.map(containerRef.current, {
      scrollWheelZoom: fill,
      ...(overlayControls ? { zoomControl: false, attributionControl: false } : {}),
    }).setView([lat, lng], fill ? 16 : 15);
    const t = layer === 'satellite' ? SATELLITE : OSM;
    tileRef.current = L.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution }).addTo(map);
    L.marker([lat, lng], { icon: courseIcon() }).addTo(map).bindPopup(courseName);
    // Manual pan pauses follow — the map is the player's until they re-center.
    map.on('dragstart', () => {
      if (followRef.current) {
        followRef.current = false;
        setFollowPaused(true);
        setPanAllowed(false);
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
  const lastFitRef = useRef<string | null>(null);
  const onFixRef = useRef(onFix);
  useEffect(() => {
    onFixRef.current = onFix;
  }, [onFix]);
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
    if (!holes?.length && !greens?.some(g => g.hole != null)) return;
    const group = L.layerGroup();
    const label = (hole: number, at: [number, number]) => {
      const icon = L.divIcon({
        className: '',
        // D4: a 26 px disc, the surface colour, a 2 px white stroke, the number in the mono face.
        html: `<div data-tee-marker="${hole}" style="width:26px;height:26px;box-sizing:border-box;border-radius:50%;background:#141318;color:#fff;font:700 12px/22px var(--font-mono-ea),ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;border:2px solid #ffffff;box-shadow:0 1px 3px rgba(0,0,0,.5)">${hole}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker(at, { icon, keyboard: false });
      marker.on('click', () => onHoleTapRef.current?.(hole));
      group.addLayer(marker);
    };
    // PR 3: a numbered green with no line of its own is still a hole.
    for (const g of greens ?? []) {
      if (g.hole == null || holes?.some(h => h.hole === g.hole)) continue;
      const c = ringCentroid(g.ring);
      if (c) label(g.hole, c);
    }
    for (const h of holes ?? []) {
      label(h.hole, h.line[0]);
    }
    group.addTo(map);
    holeLabelsRef.current = group;
    return () => {
      holeLabelsRef.current?.remove();
      holeLabelsRef.current = null;
    };
  }, [holes, greens]);

  // Focused hole: green dot, and the view fits the hole. This is the "bring
  // me to hole N" behavior; it takes the map from follow-the-player
  // (Re-center hands it back). The LINE is drawn by the effect further down
  // — it bends around the target, so it must not be tied to this effect's
  // fitBounds (a drag or a GPS tick must never re-fit the view).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    focusLineRef.current?.remove();
    focusLineRef.current = null;
    const h = focusHole != null ? holes?.find(x => x.hole === focusHole) : null;
    // PR 3: a numbered green with no line of its own still focuses — the
    // dot, the flag and a fit to its ring.
    const ringOnly = !h && focusHole != null ? (greens?.find(g => g.hole === focusHole)?.ring ?? null) : null;
    const ringCentre = ringOnly ? ringCentroid(ringOnly) : null;
    if (!h && !ringCentre) {
      // Nothing focused (the Map tab is not showing, or the hole has no
      // line and no numbered green): the next focus fits afresh.
      lastFitRef.current = null;
      return;
    }
    const group = L.layerGroup();
    // The dot and the flag stand on the green's CENTRE: the outline's
    // centroid when the cache holds one (PR G3), else the line's end.
    const greenAt: [number, number] = h ? greenPoint(h.line, h.green) : ringCentre!;
    const fitPts: [number, number][] = h ? [...h.line, greenAt] : [...ringOnly!, greenAt];
    group.addLayer(
      L.circleMarker(greenAt, {
        // The small ring at the flag's base (white, 2 px).
        radius: 5,
        color: '#ffffff',
        weight: 2,
        fillColor: '#16a34a',
        fillOpacity: 1,
      })
    );
    group.addLayer(L.marker(greenAt, { icon: flagIcon(), interactive: false, keyboard: false }));
    group.addTo(map);
    focusLineRef.current = group;
    // Fit when the focus MOVES — another hole, or this hole's line arriving
    // or changing — never because `holes` is a new array: the page rebuilds
    // it on every score poll, and each one yanked the view back to the hole
    // (and took Re-center's follow away again).
    const fitKey = `${fitNonce}:${focusHole}:${fitPts.map(p => `${p[0]},${p[1]}`).join(';')}`;
    if (lastFitRef.current !== fitKey) {
      lastFitRef.current = fitKey;
      // Ref-only: the Re-center button's visibility derives from focusActive
      // in render (setState here trips react-hooks/set-state-in-effect).
      followRef.current = false;
      // Taller padding top and bottom than at the sides: the live page lays
      // its hole chip over the top of the map and "Score hole N" over the
      // bottom, and a hole that runs straight up the screen put its green —
      // and now its flag — underneath the chip (found by gps-hole-flag.spec).
      const bounds = L.latLngBounds(fitPts);
      // Overlay mode (Nov 25 2026): the hole plate (to 80 px) and, under it,
      // the "yds to green" pill (to ~142 px) sit over the top; the zoom keys
      // down the left; the bottom bar and the credit strip over the bottom
      // (to 94 px up). The flag stands 34 px above its point.
      const fit = (rightPad: number) =>
        map.fitBounds(bounds, overlayControls
          ? { paddingTopLeft: [76, 180], paddingBottomRight: [rightPad, 116], maxZoom: 18, animate: false }
          : { paddingTopLeft: [50, 116], paddingBottomRight: [rightPad, 104], maxZoom: 18, animate: false });
      fit(50);
      // The control capsule hangs down the map's top-right corner. A green
      // that lands under it loses its flag behind the keys — so that hole is
      // fitted again with the capsule's width kept clear.
      if (overlayControls) {
        const green = map.latLngToContainerPoint(greenAt);
        const underColumn = green.x > map.getSize().x - CONTROL_COLUMN_W && green.y - FLAG_H < CONTROL_COLUMN_H;
        if (underColumn) fit(CONTROL_COLUMN_W);
      }
    }
    return () => {
      focusLineRef.current?.remove();
      focusLineRef.current = null;
    };
  }, [focusHole, holes, greens, overlayControls, fitNonce]);

  // PR 3: every ring the cache holds, drawn faintly — the greens-only
  // course's whole picture, and context on a mapped one. Never interactive
  // (a tap on a green still places the target).
  const greenRingsRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    greenRingsRef.current?.remove();
    greenRingsRef.current = null;
    if (!greens?.length) return;
    const group = L.layerGroup();
    for (const g of greens) {
      group.addLayer(L.polygon(g.ring, { color: '#16a34a', weight: 1, fillColor: '#16a34a', fillOpacity: 0.14, interactive: false }));
    }
    group.addTo(map);
    greenRingsRef.current = group;
    return () => {
      greenRingsRef.current?.remove();
      greenRingsRef.current = null;
    };
  }, [greens]);

  // The watcher reads the holes through a ref (registered once at start).
  useEffect(() => {
    holesRef.current = holes;
  }, [holes]);

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
    followIntentRef.current = null;
    followDecidedRef.current = false;
    setFollow(null);
    setPanAllowed(false);
    setPlayerFix(null);
    onFixRef.current?.(null);
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
    // Undecided until the first fix says where the player is (M1).
    followIntentRef.current = null;
    followDecidedRef.current = false;
    setFollow(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const map = mapRef.current;
        if (!map) return;
        const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        lastFixRef.current = ll;
        setPlayerFix(ll);
        onFixRef.current?.(ll);
        if (!playerMarkerRef.current) {
          playerMarkerRef.current = L.marker(ll, { icon: playerIcon() }).addTo(map);
          accuracyRef.current = L.circle(ll, {
            radius: pos.coords.accuracy,
            weight: 1,
            color: '#4da3ff',
            fillOpacity: 0.08,
          }).addTo(map);
        } else {
          playerMarkerRef.current.setLatLng(ll);
          accuracyRef.current?.setLatLng(ll).setRadius(pos.coords.accuracy);
        }
        // Follow me (M1): decided ONCE, on the first fix — on at the course,
        // off elsewhere — then the toggle's. Only the PAN is gated: the
        // marker, the accuracy ring, the pill and the published fix run on.
        if (!followDecidedRef.current) {
          followDecidedRef.current = true;
          const on = followDefault(ll, { pin: [lat, lng], holes: holesRef.current });
          followIntentRef.current = on;
          setFollow(on);
        }
        const pan = shouldPan(followIntentRef.current, !followRef.current);
        setPanAllowed(pan);
        if (pan) map.panTo(ll, { animate: true });
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
  const focusActive = focusHole != null && (!!holes?.some(h => h.hole === focusHole) || !!greens?.some(g => g.hole === focusHole));
  // The rangefinder number: player's live fix → the focused hole's green
  // (line end — "to green", never "to pin"). Null past 1500 yds so a
  // couch-peek shows nothing. Computed on-device; the fix never uploads.
  const focusedHole = focusHole != null ? holes?.find(h => h.hole === focusHole) : undefined;
  const focusedLine = focusedHole?.line;
  const focusedGreen = focusedHole?.green ?? (focusHole != null ? greens?.find(g => g.hole === focusHole)?.ring : null) ?? null;
  const unnumberedRings = greens?.filter(g => g.hole == null).map(g => g.ring) ?? null;
  // M2: the pill reads the SAME live line as the chip and the scorer
  // (hole-detail.ts liveLine — the same number greenDistanceYards gave, the
  // same 1500 yd cap), plus the edges and the plays-like when they exist.
  // PR 3: with no line, a numbered green's centre; with neither, the
  // nearest unnumbered green (greens-only).
  const pillLive = playerFix
    ? liveLine({ fix: playerFix, line: focusedLine ?? null, green: focusedGreen, nearestRings: unnumberedRings, profile: elevation?.holes.find(h => h.hole === focusHole) ?? null })
    : null;
  const pillLines = pillLive && (pillLive.kind === 'gps' || pillLive.kind === 'nearest') ? chipDistanceLines({ yards: null, approx: false }, pillLive) : null;

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
    activeTarget && focusedLine && targetOrigin ? targetDistances(targetOrigin, activeTarget, focusedLine, focusedGreen) : null;

  // THE hole line — one line, and it's the thing you interact with (Tom:
  // "just have the single line"). Straight tee-in-play→green until a target
  // exists; then origin→target→green, the orange ring being the elbow you
  // drag. Tapping the line itself places the elbow too: Leaflet paths
  // bubble clicks to the map, where the mount-time handler lives. Redraws
  // on every fix while tracking (cheap: two polylines). The marker persists
  // across redraws; it's dropped when the target clears (hole change, ✕).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    targetLinesRef.current?.remove();
    targetLinesRef.current = null;
    if (!focusedLine) {
      targetMarkerRef.current?.remove();
      targetMarkerRef.current = null;
      return;
    }
    const green = greenPoint(focusedLine, focusedGreen);
    const vertices: [number, number][] =
      activeTarget && targetOrigin ? [targetOrigin, activeTarget, green] : [...focusedLine, green];
    const group = L.layerGroup();
    // D4: a 6 px white line with the route colour on top, round caps and joins.
    group.addLayer(L.polyline(vertices, { color: '#ffffff', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }));
    group.addLayer(L.polyline(vertices, { color: '#8b5cf6', weight: 3.5, opacity: 1, lineCap: 'round', lineJoin: 'round' }));
    group.addTo(map);
    targetLinesRef.current = group;
    if (!activeTarget) {
      targetMarkerRef.current?.remove();
      targetMarkerRef.current = null;
      return () => {
        targetLinesRef.current?.remove();
        targetLinesRef.current = null;
      };
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
    return () => {
      targetLinesRef.current?.remove();
      targetLinesRef.current = null;
    };
  }, [activeTarget, focusedLine, focusedGreen, targetOrigin]);

  const targetPill = targetYds && (
    <div
      aria-live="polite"
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border bg-surface/90 py-1 pl-3 pr-1 text-sm font-bold text-primary shadow-sm"
    >
      <FaIcon icon={faBullseye} className="text-orange-500" />
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
        <FaIcon icon={faXmark} className="text-xs" />
      </button>
    </div>
  );
  const targetHint = focusedLine && !activeTarget;

  const recenter = () => {
    followRef.current = true;
    setFollowPaused(false);
    // Re-center turns Follow on (Tom's rule) and resumes the pan.
    followIntentRef.current = true;
    setFollow(true);
    setPanAllowed(true);
    if (lastFixRef.current) mapRef.current?.panTo(lastFixRef.current, { animate: true });
  };
  const toggleFollow = () => {
    if (follow === true) {
      followIntentRef.current = false;
      setFollow(false);
      setPanAllowed(false);
    } else {
      recenter();
    }
  };

  // Overlay controls go ICON-ONLY below sm. The hole chip is anchored at
  // left-14 and ends ≈225 px in; "Track my position" is ~170 px wide and the
  // layer button ~100 px, right-aligned — at 320 px they share the chip's
  // row and collide (Tom's phone report; measured in the #221 probe). A
  // 40 px icon column keeps ≥ 43 px clear at every phone width. Labels
  // return at sm+, and every button carries an aria-label so the icon-only
  // form stays accessible. Card mode (controls BELOW the map) keeps labels.
  const compact = overlayControls;
  const labelClass = compact ? 'hidden sm:inline' : '';
  const controlPad = compact ? 'min-w-[40px] px-2 sm:px-3' : 'px-3';

  const trackButton = enableTracking && (
    <button
      type="button"
      onClick={() => (tracking ? stopTracking() : startTracking())}
      aria-label={tracking ? 'Stop tracking' : 'Track my position'}
      aria-pressed={tracking}
      className={`inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface/90 ${controlPad} py-1.5 text-sm font-medium text-brand-fg shadow-sm ea-interactive ${
        // Without its label the tracking state needs a visible cue.
        compact && tracking ? 'max-sm:bg-brand max-sm:text-white' : ''
      }`}
    >
      <FaIcon icon={faLocationCrosshairs} />
      <span className={labelClass}>{tracking ? 'Stop tracking' : 'Track my position'}</span>
    </button>
  );

  // M1: the explicit Follow toggle — rendered only while tracking (nothing
  // to follow otherwise). `data-map-follow` is the truth for the e2e:
  // undecided (no fix yet) · on · paused (a drag or a hole fit — Re-center
  // resumes) · off.
  const followState = follow == null ? 'undecided' : !follow ? 'off' : followPaused || !panAllowed ? 'paused' : 'on';
  const layerButton = (
    <button
      type="button"
      onClick={() => setLayer(l => (l === 'satellite' ? 'osm' : 'satellite'))}
      className={`inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface/90 ${controlPad} py-1.5 text-sm font-medium text-secondary shadow-sm ea-interactive`}
      aria-label={layer === 'satellite' ? 'Switch to map view' : 'Switch to satellite view'}
    >
      <FaIcon icon={layer === 'satellite' ? faMap : faSatellite} />
      <span className={labelClass}>{layer === 'satellite' ? 'Map' : 'Satellite'}</span>
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
              modals. The live-round spec (Nov 25 2026, D3): one glass capsule
              of round keys top right, a zoom capsule under the hole plate;
              the distance and target pills hang under the capsule as before. */}
          <div className="live-map-controls z-[500]">
            <div className="ea-mech-glass live-map-capsule" data-map-controls="">
              <button
                type="button"
                onClick={() => setLayer(l => (l === 'satellite' ? 'osm' : 'satellite'))}
                aria-label={layer === 'satellite' ? 'Switch to map view' : 'Switch to satellite view'}
                data-map-key="layers"
                className={ROUND_KEY}
              >
                <LayersIcon size={20} />
              </button>
              {enableTracking && (
                <button
                  type="button"
                  onClick={() => (tracking ? stopTracking() : startTracking())}
                  aria-label={tracking ? 'Stop tracking' : 'Track my position'}
                  aria-pressed={tracking}
                  data-map-key="position"
                  className={ROUND_KEY}
                >
                  <LocateIcon size={20} />
                </button>
              )}
              {/* Follow: only while tracking (nothing to follow otherwise).
                  `data-map-follow` is the truth for the e2e: undecided · on ·
                  paused (a drag or a hole fit — Re-center resumes) · off. */}
              {enableTracking && tracking && (
                <button
                  type="button"
                  onClick={toggleFollow}
                  aria-label={follow === true ? COPY.GOLF_HOLE.FOLLOW_ON : COPY.GOLF_HOLE.FOLLOW_OFF}
                  aria-pressed={follow === true}
                  data-map-follow={followState}
                  data-map-key="follow"
                  className={ROUND_KEY}
                >
                  <FollowIcon size={20} />
                </button>
              )}
              {(followPaused || focusActive || follow === false) && tracking && (
                <button type="button" onClick={recenter} aria-label="Re-center on my position" data-map-key="recenter" className={ROUND_KEY}>
                  <RecenterIcon size={20} />
                </button>
              )}
              {/* Set target: the key SHOWS whether a target is set. A target is
                  still set by a tap on the map; this key clears one, or says how. */}
              <button
                type="button"
                onClick={() => (activeTarget ? setTarget(null) : onTargetHelp?.())}
                disabled={!focusedLine}
                aria-label={activeTarget ? 'Clear target' : 'Set a target'}
                aria-pressed={!!activeTarget}
                data-map-key="target"
                className={ROUND_KEY}
              >
                <TargetIcon size={20} />
              </button>
            </div>
          </div>
          {/* Zoom: the same glass capsule, under the hole plate. */}
          <div className="ea-mech-glass live-map-capsule live-map-zoom z-[500]" data-map-zoom="">
            <button type="button" onClick={() => stepZoom(mapRef.current, 1)} aria-label="Zoom in" data-map-key="zoom-in" className={ROUND_KEY}>
              <PlusIcon size={20} />
            </button>
            <button type="button" onClick={() => stepZoom(mapRef.current, -1)} aria-label="Zoom out" data-map-key="zoom-out" className={ROUND_KEY}>
              <MinusIcon size={20} />
            </button>
          </div>
          {/* Under the hole plate, between the zoom keys and the control
              capsule: what the caller says about this hole (not mapped, pick
              a nine…), then the distance to the green, the target, a location
              error. One column, so nothing here can sit on anything else —
              at 320 px and on a short screen alike. */}
          <div className="live-map-notes pointer-events-none z-[500] [&>*]:pointer-events-auto" data-map-notes="">
            {overlayNotes}
            {tracking && (pillLive?.kind === 'gps' || pillLive?.kind === 'nearest') && pillLines?.distance && (
              <p
                aria-live="polite"
                data-rangefinder-pill=""
                data-green-fcb={pillLines.fcb ? '' : undefined}
                className="ea-mech-glass inline-flex min-h-[40px] max-w-full flex-col items-start justify-center rounded-[14px] px-3 py-1.5 text-sm font-bold text-[color:var(--mech-text)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FaIcon icon={faFlag} className="text-[color:var(--mech-good)]" />
                  {greenLabel(pillLive)}
                </span>
                {playsLikeShort(pillLive) && (
                  <span className="text-xs font-semibold text-[color:var(--mech-text-soft)]" data-plays-like-delta={pillLines.riseYds ?? undefined}>
                    {COPY.GOLF_HOLE.PLAYS_LIKE_WORD} {playsLikeShort(pillLive)}
                  </span>
                )}
              </p>
            )}
            {geoError && (
              <p className="ea-mech-glass max-w-full rounded-[14px] px-3 py-2 text-xs text-[color:var(--mech-text)]" role="status" data-map-geo-error="">
                {geoError}
              </p>
            )}
          </div>
          {/* Above the bottom bar: the target's distances (set by a tap on the
              map, AFTER the hole was fitted — up here it would sit on the
              flag), then the caller's panel (the info hints). */}
          <div className="live-map-footer pointer-events-none z-[500] [&>*]:pointer-events-auto" data-map-footer="">
            {overlayFooter}
            {targetYds && (
              <div aria-live="polite" className="ea-mech-glass inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-[14px] py-1 pl-3 pr-1 text-sm font-bold text-[color:var(--mech-text)]" data-target-pill="">
                <TargetIcon size={16} className="shrink-0 text-[color:var(--mech-danger)]" />
                <span>
                  {!playerFix && <span className="font-medium text-[color:var(--mech-text-soft)]">from tee: </span>}
                  {targetYds.toTarget} to target · {targetYds.targetToGreen} to green
                </span>
                <button type="button" onClick={() => setTarget(null)} aria-label="Clear target" className="ea-mech-btn inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center text-[color:var(--mech-text-soft)]" data-target-clear="">
                  <CloseIcon size={14} />
                </button>
              </div>
            )}
          </div>
          {/* The credit: a strip across the very bottom carrying every credit
              and link the tile providers require (they are a licence
              condition, not chrome). The text is the tile layer's own. */}
          <p
            // One line; on a phone it scrolls sideways so the WHOLE credit can be read — never cut with an ellipsis.
            className="absolute inset-x-0 bottom-0 z-[500] flex h-6 items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap px-3 text-[10px] leading-6 text-[#c9c6d1] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_a]:underline"
            data-scroll-x=""
            style={{ backgroundColor: 'rgb(11 10 13 / 0.78)' }}
            data-map-credit={layer}
          >
            <span className="shrink-0" dangerouslySetInnerHTML={{ __html: (layer === 'satellite' ? SATELLITE : OSM).attribution }} />
            {layer === 'satellite' && <span className="shrink-0">· hole lines © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></span>}
            <span className="ml-auto shrink-0 pl-3"><a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a></span>
          </p>
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
