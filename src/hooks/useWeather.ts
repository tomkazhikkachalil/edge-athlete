'use client';

import { useEffect, useState } from 'react';
import { coordKey, type Weather } from '@/lib/weather/weather';
import { loadWeather } from '@/lib/weather/weather-client';

// ── useWeather (Oct 29 2026) ─────────────────────────────────────────────────
// The conditions at a place for a screen that holds coordinates (none yet —
// the golf Conditions step asks on a TAP through loadWeather directly). Never
// fetches without coordinates; `status` is DERIVED in render from the one
// state object, so the effect never sets state synchronously (the
// set-state-in-effect rule): it loads on a key change and lands the answer in
// `.then`, guarded by a `live` flag.

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface Entry {
  key: string;
  weather: Weather | null;
}

export function useWeather(coords: { lat: number; lng: number } | null): { weather: Weather | null; status: WeatherStatus } {
  const key = coords ? coordKey(coords.lat, coords.lng) : null;
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    if (!coords) return;
    const k = coordKey(coords.lat, coords.lng);
    let live = true;
    void loadWeather(coords).then(weather => {
      if (live) setEntry({ key: k, weather });
    });
    return () => {
      live = false;
    };
    // The key is the cell; a new object with the same cell must not re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { weather: null, status: 'idle' };
  if (!entry || entry.key !== key) return { weather: null, status: 'loading' };
  return entry.weather ? { weather: entry.weather, status: 'ready' } : { weather: null, status: 'unavailable' };
}
