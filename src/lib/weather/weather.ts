// ── Weather at a place (Oct 29 2026) — pure, zero imports ───────────────────
// Tom: outdoor sport cares about the weather; a free API, °F and °C, based
// on location — for now only where golf has a clear input for it: the live
// round's Conditions step, from the COURSE's coordinates, stamped on the
// round. The provider is Open-Meteo (free host, non-commercial; the paid
// host behind OPEN_METEO_API_KEY at go-public — weather-server.ts). This
// module owns the shape we keep, the defensive parse of the provider's
// `current` block, the 2-decimal cell every call is keyed on (≈1 km: the
// CDN key and a privacy floor), the WMO code table, and the golf mapping
// into the Conditions step's three fields. Metric throughout — °C and km/h
// — converted only on screen (units.ts's rule); the golf temperature column
// keeps its °F meaning, so `golfTempF` converts at that one edge.

export const WEATHER_SOURCE = 'open-meteo' as const;
export const WEATHER_ATTRIBUTION = { text: 'Weather by Open-Meteo', url: 'https://open-meteo.com/' } as const;

export interface Weather {
  tempC: number;
  feelsLikeC: number | null;
  windKmh: number;
  windGustKmh: number | null;
  /** Degrees the wind comes FROM, 0–360. */
  windDir: number | null;
  precipMm: number | null;
  /** WMO weather interpretation code (0 clear … 99 thunderstorm with hail). */
  code: number;
  isDay: boolean;
  /** Epoch SECONDS of the provider's observation (timeformat=unixtime). */
  observedAt: number;
  source: typeof WEATHER_SOURCE;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The provider's `current` block → our shape; null when the essentials
 *  (temperature, code, time) are missing or not numbers. Never throws. */
export function parseOpenMeteo(json: unknown): Weather | null {
  if (!json || typeof json !== 'object') return null;
  const current = (json as { current?: unknown }).current;
  if (!current || typeof current !== 'object') return null;
  const c = current as Record<string, unknown>;
  const tempC = finite(c.temperature_2m);
  const code = finite(c.weather_code);
  const observedAt = finite(c.time);
  if (tempC === null || code === null || observedAt === null) return null;
  const wind = finite(c.wind_speed_10m);
  const isDayRaw = c.is_day;
  return {
    tempC,
    feelsLikeC: finite(c.apparent_temperature),
    windKmh: wind ?? 0,
    windGustKmh: finite(c.wind_gusts_10m),
    windDir: finite(c.wind_direction_10m),
    precipMm: finite(c.precipitation),
    code: Math.trunc(code),
    isDay: isDayRaw === 1 || isDayRaw === true,
    observedAt: Math.trunc(observedAt),
    source: WEATHER_SOURCE,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r; // never "-0"
};

/** The 2-decimal cell (≈1.1 km): the CDN key, the memo key, the privacy floor. */
export function roundCoord(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: round2(clamp(lat, -90, 90)), lng: round2(clamp(lng, -180, 180)) };
}

/** "43.65,-79.38" — the canonical spelling of a cell, for URLs and keys. */
export function coordKey(lat: number, lng: number): string {
  const r = roundCoord(lat, lng);
  return `${r.lat.toFixed(2)},${r.lng.toFixed(2)}`;
}

/** Query strings → finite coordinates within the globe, else null. */
export function parseCoords(lat: string | null | undefined, lng: string | null | undefined): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (lat.trim() === '' || lng.trim() === '') return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

export type WeatherIcon =
  | 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'smog'
  | 'cloud-rain' | 'cloud-showers-heavy' | 'snowflake' | 'cloud-bolt';

/** WMO code → words and the house glyph (Font Awesome `fa-${icon}`). */
export function wmoLabel(code: number, isDay = true): { text: string; icon: WeatherIcon } {
  if (code === 0) return { text: 'Clear', icon: isDay ? 'sun' : 'moon' };
  if (code === 1) return { text: 'Mostly clear', icon: isDay ? 'sun' : 'moon' };
  if (code === 2) return { text: 'Partly cloudy', icon: isDay ? 'cloud-sun' : 'cloud-moon' };
  if (code === 3) return { text: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { text: 'Fog', icon: 'smog' };
  if (code >= 51 && code <= 57) return { text: 'Drizzle', icon: 'cloud-rain' };
  if (code >= 61 && code <= 67) return { text: 'Rain', icon: 'cloud-rain' };
  if (code >= 71 && code <= 77) return { text: 'Snow', icon: 'snowflake' };
  if (code >= 80 && code <= 82) return { text: 'Showers', icon: 'cloud-showers-heavy' };
  if (code === 85 || code === 86) return { text: 'Snow showers', icon: 'snowflake' };
  if (code >= 95 && code <= 99) return { text: 'Thunderstorm', icon: 'cloud-bolt' };
  return { text: 'Cloudy', icon: 'cloud' };
}

const isWet = (code: number) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);

export type GolfCondition = 'sunny' | 'partly-cloudy' | 'cloudy' | 'rainy' | 'windy';
export type GolfWindBand = 'calm' | 'light' | 'moderate' | 'strong';

const MPH_PER_KMH = 0.621371;
/** "Windy" for the golf select: the step's own strong band (20+ mph) begins at 32.2 km/h. */
const WINDY_KMH = 20 / MPH_PER_KMH;

/** The Conditions step's weather value from the provider's code and wind.
 *  Rain beats everything; wind beats sky when it reaches the strong band;
 *  snow and fog read as cloudy (the select has no word for them). */
export function golfConditionOf(w: Pick<Weather, 'code' | 'windKmh'>): GolfCondition {
  if (isWet(w.code)) return 'rainy';
  if (w.windKmh >= WINDY_KMH) return 'windy';
  if (w.code <= 1) return 'sunny';
  if (w.code === 2) return 'partly-cloudy';
  return 'cloudy';
}

/** The Conditions step's wind band from km/h, on its mph edges (5 / 10 / 20). */
export function golfWindBandOf(windKmh: number): GolfWindBand {
  const mph = windKmh * MPH_PER_KMH;
  if (mph < 5) return 'calm';
  if (mph < 10) return 'light';
  if (mph < 20) return 'moderate';
  return 'strong';
}

/** The scorecard keeps the wind as mph (0 / 7 / 15 / 25 for the four bands,
 *  shared-round-submit.ts); the mirrored round keeps the band's word. */
export function golfWindBandFromMph(mph: number | null | undefined): GolfWindBand | null {
  if (mph == null || !Number.isFinite(mph)) return null;
  return golfWindBandOf(mph / MPH_PER_KMH);
}

/** The golf temperature column is Fahrenheit (a whole number) — the one edge
 *  where metric becomes imperial on the way IN. */
export function golfTempF(tempC: number): number {
  return Math.round(tempC * 1.8 + 32);
}

/** "14 km/h" / "9 mph" — the wind as the viewer's unit system says it. */
export function formatWindKmh(kmh: number, sys: 'metric' | 'imperial'): string {
  return sys === 'imperial' ? `${Math.round(kmh * MPH_PER_KMH)} mph` : `${Math.round(kmh)} km/h`;
}
