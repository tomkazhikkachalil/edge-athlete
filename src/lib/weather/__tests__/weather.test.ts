import { describe, expect, it } from 'vitest';
import {
  coordKey,
  formatWindKmh,
  golfConditionOf,
  golfTempF,
  golfWindBandOf,
  parseCoords,
  parseOpenMeteo,
  roundCoord,
  WEATHER_ATTRIBUTION,
  wmoLabel,
} from '../weather';

// Weather at a place (Oct 29 2026): the shape we keep, the 2-decimal cell,
// the WMO table and the golf mapping — every rule pinned.

const fixture = {
  latitude: 43.65,
  longitude: -79.38,
  utc_offset_seconds: -14400,
  current: {
    time: 1_761_750_000,
    temperature_2m: 12.2,
    apparent_temperature: 10.4,
    is_day: 1,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 20,
    wind_direction_10m: 315,
    wind_gusts_10m: 33.5,
  },
};

describe('parseOpenMeteo', () => {
  it('keeps the current block, metric, with the observation time in seconds', () => {
    const w = parseOpenMeteo(fixture)!;
    expect(w).toMatchObject({
      tempC: 12.2,
      feelsLikeC: 10.4,
      windKmh: 20,
      windGustKmh: 33.5,
      windDir: 315,
      precipMm: 0,
      code: 2,
      isDay: true,
      observedAt: 1_761_750_000,
      source: 'open-meteo',
    });
  });

  it('answers null for anything without the essentials, and never throws', () => {
    expect(parseOpenMeteo(null)).toBeNull();
    expect(parseOpenMeteo('nope')).toBeNull();
    expect(parseOpenMeteo({})).toBeNull();
    expect(parseOpenMeteo({ current: { temperature_2m: '12', weather_code: 2, time: 1 } })).toBeNull();
    expect(parseOpenMeteo({ current: { temperature_2m: 12, weather_code: null, time: 1 } })).toBeNull();
    expect(parseOpenMeteo({ current: { temperature_2m: 12, weather_code: 2 } })).toBeNull();
  });

  it('tolerates missing optionals (wind defaults to calm, the rest null) and a non-numeric is_day', () => {
    const w = parseOpenMeteo({ current: { temperature_2m: -3, weather_code: 71, time: 5, is_day: 0 } })!;
    expect(w.windKmh).toBe(0);
    expect(w.feelsLikeC).toBeNull();
    expect(w.windDir).toBeNull();
    expect(w.isDay).toBe(false);
  });
});

describe('the 2-decimal cell', () => {
  it('rounds to ~1 km, never -0, clamped to the globe', () => {
    expect(roundCoord(43.6532, -79.3832)).toEqual({ lat: 43.65, lng: -79.38 });
    expect(Object.is(roundCoord(-0.004, 0.004).lat, 0)).toBe(true);
    expect(roundCoord(95, -200)).toEqual({ lat: 90, lng: -180 });
  });

  it('spells the cell one way', () => {
    expect(coordKey(43.6532, -79.3832)).toBe('43.65,-79.38');
    expect(coordKey(43.65, -79.38)).toBe('43.65,-79.38');
    expect(coordKey(1, 2)).toBe('1.00,2.00');
  });

  it('parses finite in-range coordinates only', () => {
    expect(parseCoords('43.65', '-79.38')).toEqual({ lat: 43.65, lng: -79.38 });
    expect(parseCoords(null, '1')).toBeNull();
    expect(parseCoords('', '1')).toBeNull();
    expect(parseCoords('abc', '1')).toBeNull();
    expect(parseCoords('91', '1')).toBeNull();
    expect(parseCoords('1', '181')).toBeNull();
    expect(parseCoords('Infinity', '1')).toBeNull();
  });
});

describe('wmoLabel', () => {
  it('names the codes, with night glyphs for the clear and partly cloudy skies', () => {
    expect(wmoLabel(0)).toEqual({ text: 'Clear', icon: 'sun' });
    expect(wmoLabel(0, false)).toEqual({ text: 'Clear', icon: 'moon' });
    expect(wmoLabel(2)).toEqual({ text: 'Partly cloudy', icon: 'cloud-sun' });
    expect(wmoLabel(2, false).icon).toBe('cloud-moon');
    expect(wmoLabel(3).text).toBe('Overcast');
    expect(wmoLabel(45).text).toBe('Fog');
    expect(wmoLabel(55).text).toBe('Drizzle');
    expect(wmoLabel(63).text).toBe('Rain');
    expect(wmoLabel(73)).toEqual({ text: 'Snow', icon: 'snowflake' });
    expect(wmoLabel(81).text).toBe('Showers');
    expect(wmoLabel(86).text).toBe('Snow showers');
    expect(wmoLabel(96)).toEqual({ text: 'Thunderstorm', icon: 'cloud-bolt' });
    expect(wmoLabel(123)).toEqual({ text: 'Cloudy', icon: 'cloud' });
  });
});

describe('the golf mapping', () => {
  it('rain beats everything, wind beats the sky at the strong band, snow and fog read as cloudy', () => {
    expect(golfConditionOf({ code: 61, windKmh: 50 })).toBe('rainy');
    expect(golfConditionOf({ code: 95, windKmh: 0 })).toBe('rainy');
    expect(golfConditionOf({ code: 0, windKmh: 40 })).toBe('windy');
    expect(golfConditionOf({ code: 0, windKmh: 20 })).toBe('sunny');
    expect(golfConditionOf({ code: 1, windKmh: 0 })).toBe('sunny');
    expect(golfConditionOf({ code: 2, windKmh: 0 })).toBe('partly-cloudy');
    expect(golfConditionOf({ code: 3, windKmh: 0 })).toBe('cloudy');
    expect(golfConditionOf({ code: 45, windKmh: 0 })).toBe('cloudy');
    expect(golfConditionOf({ code: 73, windKmh: 0 })).toBe('cloudy');
  });

  it('bands the wind on the step\'s mph edges (5 / 10 / 20)', () => {
    expect(golfWindBandOf(0)).toBe('calm');
    expect(golfWindBandOf(8.0)).toBe('calm'); // 4.97 mph
    expect(golfWindBandOf(8.1)).toBe('light'); // 5.03 mph
    expect(golfWindBandOf(16.0)).toBe('light'); // 9.94 mph
    expect(golfWindBandOf(16.2)).toBe('moderate'); // 10.07 mph
    expect(golfWindBandOf(20)).toBe('moderate');
    expect(golfWindBandOf(32.1)).toBe('moderate'); // 19.95 mph
    expect(golfWindBandOf(32.3)).toBe('strong'); // 20.07 mph
  });

  it('the temperature column stays Fahrenheit: 12 °C → 54, -3 °C → 27, 22 °C → 72', () => {
    expect(golfTempF(12)).toBe(54);
    expect(golfTempF(12.2)).toBe(54);
    expect(golfTempF(-3)).toBe(27);
    expect(golfTempF(22)).toBe(72);
  });

  it('formats the wind in the viewer\'s system', () => {
    expect(formatWindKmh(14, 'metric')).toBe('14 km/h');
    expect(formatWindKmh(14, 'imperial')).toBe('9 mph');
  });

  it('carries the CC-BY credit', () => {
    expect(WEATHER_ATTRIBUTION.text).toBe('Weather by Open-Meteo');
    expect(WEATHER_ATTRIBUTION.url).toMatch(/^https:\/\/open-meteo\.com/);
  });
});
