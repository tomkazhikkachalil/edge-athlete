import { describe, expect, it } from 'vitest';
import { fetchWeather, weatherConfig, weatherUrl } from '../weather-server';

// The provider call (Oct 29 2026): the free host by default, the paid host
// behind the elevation client's key, the e2e stand-in honoured only outside
// production, the brake, the exact query, and every failure a reason.

const FREE = 'https://api.open-meteo.com/v1/forecast';
const PAID = 'https://customer-api.open-meteo.com/v1/forecast';

describe('weatherConfig', () => {
  it('is the free host with nothing set', () => {
    expect(weatherConfig({})).toEqual({ base: FREE, apikey: null, mock: false });
  });

  it('moves to the paid host with the (dual-purpose) key', () => {
    expect(weatherConfig({ OPEN_METEO_API_KEY: ' k1 ' })).toEqual({ base: PAID, apikey: 'k1', mock: false });
  });

  it('honours the stand-in outside production and IGNORES it in production', () => {
    expect(weatherConfig({ WEATHER_MOCK_BASE: 'http://127.0.0.1:4873/' })).toEqual({ base: 'http://127.0.0.1:4873/v1/forecast', apikey: null, mock: true });
    expect(weatherConfig({ WEATHER_MOCK_BASE: 'http://127.0.0.1:4873', VERCEL_ENV: 'preview' })?.mock).toBe(true);
    expect(weatherConfig({ WEATHER_MOCK_BASE: 'http://127.0.0.1:4873', VERCEL_ENV: 'production' })).toEqual({ base: FREE, apikey: null, mock: false });
  });

  it('WEATHER_OFF=1 is the brake', () => {
    expect(weatherConfig({ WEATHER_OFF: '1', OPEN_METEO_API_KEY: 'k' })).toBeNull();
    expect(weatherConfig({ WEATHER_OFF: '0' })).not.toBeNull();
  });
});

describe('weatherUrl', () => {
  it('asks for the current block only, metric, unixtime, at the 2-decimal cell', () => {
    const url = new URL(weatherUrl(weatherConfig({})!, 43.6532, -79.3832));
    expect(url.origin + url.pathname).toBe(FREE);
    expect(url.searchParams.get('latitude')).toBe('43.65');
    expect(url.searchParams.get('longitude')).toBe('-79.38');
    expect(url.searchParams.get('current')).toBe('temperature_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
    expect(url.searchParams.has('hourly')).toBe(false);
    expect(url.searchParams.has('daily')).toBe(false);
    expect(url.searchParams.has('temperature_unit')).toBe(false);
    expect(url.searchParams.has('apikey')).toBe(false);
  });

  it('carries the key only on the paid host', () => {
    const url = new URL(weatherUrl(weatherConfig({ OPEN_METEO_API_KEY: 'k1' })!, 1, 2));
    expect(url.origin + url.pathname).toBe(PAID);
    expect(url.searchParams.get('apikey')).toBe('k1');
  });
});

describe('fetchWeather', () => {
  const cfg = weatherConfig({})!;
  const body = { current: { time: 1_761_750_000, temperature_2m: 12.2, weather_code: 2, wind_speed_10m: 20, is_day: 1 } };
  const respond = (status: number, json: unknown) =>
    (async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

  it('returns the parsed weather on 200', async () => {
    const r = await fetchWeather(43.65, -79.38, { cfg, fetch: respond(200, body) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.weather.tempC).toBe(12.2);
  });

  it('names the failure: upstream, bad-body, timeout', async () => {
    expect(await fetchWeather(1, 2, { cfg, fetch: respond(500, { reason: 'x' }) })).toEqual({ ok: false, reason: 'upstream' });
    expect(await fetchWeather(1, 2, { cfg, fetch: respond(200, { nope: true }) })).toEqual({ ok: false, reason: 'bad-body' });
    const notJson = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await fetchWeather(1, 2, { cfg, fetch: notJson })).toEqual({ ok: false, reason: 'bad-body' });
    const timeout = (async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }) as unknown as typeof fetch;
    expect(await fetchWeather(1, 2, { cfg, fetch: timeout })).toEqual({ ok: false, reason: 'timeout' });
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await fetchWeather(1, 2, { cfg, fetch: down })).toEqual({ ok: false, reason: 'upstream' });
  });

  it('sends the request with no store, a User-Agent and the cell, never the raw coordinates', async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    const spy = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchWeather(43.6532, -79.3832, { cfg, fetch: spy });
    expect(seen!.url).toContain('latitude=43.65&longitude=-79.38');
    expect(seen!.url).not.toContain('43.6532');
    expect(seen!.init?.cache).toBe('no-store');
    expect((seen!.init?.headers as Record<string, string>)['User-Agent']).toContain('EdgeAthlete');
  });
});
