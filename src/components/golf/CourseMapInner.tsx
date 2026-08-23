'use client';

// The actual Leaflet map — loaded ONLY via CourseMap's next/dynamic wrapper
// (ssr:false), so leaflet and its CSS never enter a server bundle or a page
// that doesn't show a map. OSM raster tiles; the attribution control is a
// usage-policy requirement, not decoration.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface CourseMapInnerProps {
  lat: number;
  lng: number;
  courseName: string;
  /** Live rounds only: offer "Track my position" via device geolocation.
   *  The position NEVER leaves the device — map marker only, no writes. */
  enableTracking?: boolean;
}

// Inline divIcons: Leaflet's default marker images 404 under bundlers, and
// shipping copies for two tiny markers isn't worth it.
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

export default function CourseMapInner({ lat, lng, courseName, enableTracking = false }: CourseMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const playerMarkerRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const pannedRef = useRef(false);
  const [tracking, setTracking] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([lat, lng], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.marker([lat, lng], { icon: courseIcon() }).addTo(map).bindPopup(courseName);
    mapRef.current = map;
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
      map.remove();
      mapRef.current = null;
    };
    // Mount-only: a course's pin doesn't move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    playerMarkerRef.current?.remove();
    playerMarkerRef.current = null;
    accuracyRef.current?.remove();
    accuracyRef.current = null;
    pannedRef.current = false;
    setTracking(false);
  };

  const startTracking = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Location is not available on this device.');
      return;
    }
    setGeoError(null);
    setTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const map = mapRef.current;
        if (!map) return;
        const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude];
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
        // Pan to the player once — after that the map is theirs to move.
        if (!pannedRef.current) {
          pannedRef.current = true;
          map.panTo(ll);
        }
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

  return (
    <div>
      <div ref={containerRef} className="h-64 w-full rounded-lg border border-border" />
      {enableTracking && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[10px] text-faint">
            Your position stays on your device — it&apos;s never uploaded.
          </p>
          <button
            type="button"
            onClick={() => (tracking ? stopTracking() : startTracking())}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-fg ea-interactive"
          >
            <i className={`fas ${tracking ? 'fa-location-crosshairs fa-beat' : 'fa-location-crosshairs'}`} aria-hidden="true"></i>
            {tracking ? 'Stop tracking' : 'Track my position'}
          </button>
        </div>
      )}
      {geoError && <p className="mt-1 text-xs text-tertiary">{geoError}</p>}
    </div>
  );
}
