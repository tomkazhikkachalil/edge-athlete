import { describe, expect, it } from 'vitest';
import {
  acceptGeocode,
  buildGeocodeQueries,
  haversineKm,
  pickGolfCourseResult,
  shouldReplaceCoords,
} from '../geocode';

describe('buildGeocodeQueries', () => {
  it('leads with name+city and includes the Club↔Course swap (the Eagle Creek case)', () => {
    expect(buildGeocodeQueries('Eagle Creek Golf Club', 'Ottawa', 'Ontario')).toEqual([
      { q: 'Eagle Creek Golf Club, Ottawa', localityScoped: true },
      { q: 'Eagle Creek Golf Course, Ottawa', localityScoped: true },
      { q: 'Eagle Creek Golf Club', localityScoped: false },
    ]);
  });

  it('swaps Course back to Club too', () => {
    expect(buildGeocodeQueries('Riverside Golf Course', null, 'Ontario')[1].q).toBe(
      'Riverside Golf Club, Ontario'
    );
  });

  it('falls back to region, then bare name, and never exceeds 3', () => {
    expect(buildGeocodeQueries('Pebble Beach Golf Links', null, 'California')).toEqual([
      { q: 'Pebble Beach Golf Links, California', localityScoped: true },
      { q: 'Pebble Beach Golf Links', localityScoped: false },
    ]);
    expect(buildGeocodeQueries('St Andrews Links', null, null)).toEqual([
      { q: 'St Andrews Links', localityScoped: false },
    ]);
    expect(buildGeocodeQueries('', 'Ottawa', null)).toEqual([]);
  });
});

describe('acceptGeocode', () => {
  it('rejects a far bare-name match with stored coords (the Cottonwood 917km case)', () => {
    const glendive = { lat: 47.13, lng: -104.745 };
    const saltLake = { lat: 40.6511, lng: -111.8403, localityScoped: false };
    expect(acceptGeocode(glendive, saltLake)).toBe(false);
  });

  it('accepts locality-scoped matches regardless of distance, and near/unanchored bare matches', () => {
    const glendive = { lat: 47.13, lng: -104.745 };
    expect(acceptGeocode(glendive, { lat: 40.6511, lng: -111.8403, localityScoped: true })).toBe(true);
    expect(acceptGeocode(null, { lat: 40.6511, lng: -111.8403, localityScoped: false })).toBe(true);
    // 360 Ewa Beach: bare-name match 4.6 km from stored — inside the radius.
    expect(
      acceptGeocode({ lat: 21.323, lng: -157.9975 }, { lat: 21.3148, lng: -158.0406, localityScoped: false })
    ).toBe(true);
  });
});

describe('pickGolfCourseResult', () => {
  it('accepts only golf_course-typed results (Pebble Beach top hit is a restaurant)', () => {
    const results = [
      { lat: '36.5696', lon: '-121.9497', type: 'restaurant' },
      { lat: '45.3417', lon: '-75.6818', type: 'golf_course' },
    ];
    expect(pickGolfCourseResult(results)).toEqual({ lat: 45.3417, lng: -75.6818 });
    expect(pickGolfCourseResult([{ lat: '1', lon: '2', type: 'restaurant' }])).toBeNull();
    expect(pickGolfCourseResult([])).toBeNull();
    expect(pickGolfCourseResult(null)).toBeNull();
    expect(pickGolfCourseResult([{ lat: 'nope', lon: '2', type: 'golf_course' }])).toBeNull();
  });
});

describe('shouldReplaceCoords', () => {
  const realOttawaHunt = { lat: 45.3417, lng: -75.6818 };

  it('replaces missing coords', () => {
    expect(shouldReplaceCoords(null, realOttawaHunt)).toBe(true);
    expect(shouldReplaceCoords({ lat: 45.3, lng: undefined }, realOttawaHunt)).toBe(true);
  });

  it('replaces the real bad rows (8–22 km off) but not small offsets', () => {
    // The stored Ottawa Hunt row that shipped to Tom's phone: ~8 km off.
    expect(shouldReplaceCoords({ lat: 45.3847, lng: -75.7294 }, realOttawaHunt)).toBe(true);
    // Pebble Beach stored vs OSM node: ~250 m — keep stored, no churn.
    expect(
      shouldReplaceCoords({ lat: 36.5675, lng: -121.9481 }, { lat: 36.5696, lng: -121.9497 })
    ).toBe(false);
  });

  it('haversine sanity: Ottawa→Kingston is ~150 km', () => {
    const d = haversineKm({ lat: 45.4215, lng: -75.6972 }, { lat: 44.2312, lng: -76.486 });
    expect(d).toBeGreaterThan(140);
    expect(d).toBeLessThan(165);
  });
});
