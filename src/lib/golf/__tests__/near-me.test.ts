import { describe, it, expect } from 'vitest';
import { formatKm, kmFromFix, nearbyOffer, NEAR_RADIUS_KM, OFFER_WITHIN_KM } from '../near-me';

// Golf near-me program PR B: the "Playing at X?" offer and the distance chip.

const fix = { lat: 45.3, lng: -75.7 };

describe('nearbyOffer', () => {
  it('offers the nearest course with coordinates within a kilometre', () => {
    const rows = [
      { id: 'far', name: 'Far Links', lat: 45.35, lng: -75.7 },
      { id: 'here', name: 'Here Links', lat: 45.3005, lng: -75.7 },
      { id: 'close', name: 'Close Links', lat: 45.304, lng: -75.7 },
    ];
    expect(nearbyOffer(rows, fix)?.course.id).toBe('here');
    expect(nearbyOffer(rows, fix)!.km).toBeLessThan(0.1);
  });
  it('prefers the RPC distance when the row carries one', () => {
    expect(nearbyOffer([{ id: 'a', name: 'A', distanceKm: 0.4 }], fix)?.km).toBe(0.4);
  });
  it('nothing within reach, or no coordinates → null', () => {
    expect(nearbyOffer([{ id: 'a', name: 'A', lat: 46, lng: -75.7 }], fix)).toBeNull();
    expect(nearbyOffer([{ id: 'a', name: 'A' }], fix)).toBeNull();
    expect(nearbyOffer([], fix)).toBeNull();
  });
  it('the radius asked of the catalog and the offer reach are the constants', () => {
    expect(NEAR_RADIUS_KM).toBe(50);
    expect(OFFER_WITHIN_KM).toBe(1);
  });
});

describe('kmFromFix + formatKm', () => {
  it('haversine when there is no RPC distance; null without coords', () => {
    expect(kmFromFix({ id: 'a', name: 'A', lat: 45.3, lng: -75.7 }, fix)).toBe(0);
    expect(kmFromFix({ id: 'a', name: 'A', lat: null }, fix)).toBeNull();
  });
  it('one decimal under 10 km, whole numbers above, blank for garbage', () => {
    expect(formatKm(0.34)).toBe('0.3 km');
    expect(formatKm(9.96)).toBe('10.0 km');
    expect(formatKm(23.4)).toBe('23 km');
    expect(formatKm(-1)).toBe('');
    expect(formatKm(Number.NaN)).toBe('');
  });
});
