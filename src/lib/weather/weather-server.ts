// ── The weather provider call (Oct 29 2026) — server only ───────────────────
// Open-Meteo's forecast API, `current` block only: a live golf round wants
// the conditions at tee-off, nothing more (one call-weight). Metric always
// (°C, km/h, unixtime) — conversion is the screen's job. The free host is
// for non-commercial use; OPEN_METEO_API_KEY (the elevation client's key —
// dual-purpose now) flips to the paid host; WEATHER_OFF=1 is the brake;
// WEATHER_MOCK_BASE points a LOCAL test server at the e2e stand-in and is
// ignored in production (polar-server's posture). Nothing here logs a URL
// or a coordinate.

import { parseOpenMeteo, roundCoord, type Weather } from './weather';

const FREE_HOST = 'https://api.open-meteo.com/v1/forecast';
const PAID_HOST = 'https://customer-api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 5_000;
const UA = 'EdgeAthlete/1.0 (https://edgeathlete.ca)';

const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
].join(',');

export interface WeatherConfig {
  base: string;
  apikey: string | null;
  mock: boolean;
}

/** null = the feature is off (WEATHER_OFF=1); never an error. */
export function weatherConfig(env: Record<string, string | undefined> = process.env): WeatherConfig | null {
  if (env.WEATHER_OFF === '1') return null;
  const mock = env.VERCEL_ENV === 'production' ? undefined : env.WEATHER_MOCK_BASE?.trim().replace(/\/+$/, '');
  if (mock) return { base: `${mock}/v1/forecast`, apikey: null, mock: true };
  const apikey = env.OPEN_METEO_API_KEY?.trim();
  return apikey ? { base: PAID_HOST, apikey, mock: false } : { base: FREE_HOST, apikey: null, mock: false };
}

/** The exact request — exported so a test pins every parameter. */
export function weatherUrl(cfg: WeatherConfig, lat: number, lng: number): string {
  const cell = roundCoord(lat, lng);
  const params = new URLSearchParams({
    latitude: cell.lat.toFixed(2),
    longitude: cell.lng.toFixed(2),
    current: CURRENT_FIELDS,
    timezone: 'auto',
    timeformat: 'unixtime',
    wind_speed_unit: 'kmh',
  });
  if (cfg.apikey) params.set('apikey', cfg.apikey);
  return `${cfg.base}?${params.toString()}`;
}

export type WeatherFetch =
  | { ok: true; weather: Weather }
  | { ok: false; reason: 'timeout' | 'upstream' | 'bad-body' };

export async function fetchWeather(
  lat: number,
  lng: number,
  deps: { cfg: WeatherConfig; fetch?: typeof fetch }
): Promise<WeatherFetch> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(weatherUrl(deps.cfg, lat, lng), {
      cache: 'no-store',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'upstream' };
  }
  if (!res.ok) return { ok: false, reason: 'upstream' };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'bad-body' };
  }
  const weather = parseOpenMeteo(json);
  return weather ? { ok: true, weather } : { ok: false, reason: 'bad-body' };
}

/** The provider's day cap, well under the free host's 10,000 (the CDN keys
 *  on the 2-dp cell for 10 minutes, so a busy course costs one call). */
export const WEATHER_DAILY_BUDGET = Number(process.env.WEATHER_DAILY_BUDGET) || 8_000;
export const WEATHER_BUDGET_KEY = 'provider:weather';
