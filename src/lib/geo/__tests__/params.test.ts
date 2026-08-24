import { describe, expect, it } from 'vitest';
import { hasLocationFilter, parseNear, readLocationParams, rpcLocationArgs } from '../params';

describe('parseNear', () => {
  it('parses "lat,lng" and rejects junk and out-of-range values', () => {
    expect(parseNear('45.4215,-75.6972')).toEqual({ lat: 45.4215, lng: -75.6972 });
    expect(parseNear(' 45.4 , -75.7 ')).toEqual({ lat: 45.4, lng: -75.7 });
    expect(parseNear('')).toBeUndefined();
    expect(parseNear(null)).toBeUndefined();
    expect(parseNear('45.4')).toBeUndefined();
    expect(parseNear('a,b')).toBeUndefined();
    expect(parseNear('95,0')).toBeUndefined();
    expect(parseNear('0,181')).toBeUndefined();
  });
});

describe('readLocationParams', () => {
  it('normalises codes, caps the radius, ignores malformed values', () => {
    const p = readLocationParams(new URLSearchParams('country=ca&region=on&near=45.42,-75.69&radius=9999'));
    expect(p).toEqual({ countryCode: 'CA', regionCode: 'ON', near: { lat: 45.42, lng: -75.69 }, radiusKm: 500 });
    expect(readLocationParams(new URLSearchParams('country=Canada&radius=-5&near=x'))).toEqual({
      countryCode: undefined, regionCode: undefined, near: undefined, radiusKm: undefined,
    });
  });
});

describe('hasLocationFilter / rpcLocationArgs', () => {
  it('omits unset keys so an old RPC signature still matches', () => {
    expect(hasLocationFilter({})).toBe(false);
    expect(rpcLocationArgs({})).toEqual({});
    const p = readLocationParams(new URLSearchParams('region=ON&near=45,-75&radius=25'));
    expect(hasLocationFilter(p)).toBe(true);
    expect(rpcLocationArgs(p)).toEqual({ p_region_code: 'ON', p_near_lat: 45, p_near_lng: -75, p_radius_km: 25 });
  });
});
