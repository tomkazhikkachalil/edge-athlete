import { describe, expect, it } from 'vitest';
import { containsPoint, FRAME, padBounds, routeBounds } from '../route-frame';

describe('route-frame — the box around the route a viewer was given', () => {
  it('spans the fixed points and skips the nulls a trimmed stream carries at both ends', () => {
    const lat = [null, null, 45.40, 45.41, 45.42, null];
    const lng = [null, null, -75.70, -75.69, -75.68, null];
    expect(routeBounds(lat, lng)).toEqual({ south: 45.4, west: -75.7, north: 45.42, east: -75.68 });
  });

  it('is null under two fixed points, and ignores non-finite values', () => {
    expect(routeBounds([], [])).toBeNull();
    expect(routeBounds([45.4], [-75.7])).toBeNull();
    expect(routeBounds([45.4, null, NaN], [-75.7, null, -75.6])).toBeNull();
    expect(routeBounds([45.4, 45.5], [-75.7])).toBeNull(); // ragged: only the shared length counts
  });

  it('pads each side by the ratio of the span (25 % → the box is 1.5× the route each way)', () => {
    const b = { south: 45.0, west: -75.0, north: 45.1, east: -74.8 };
    const p = padBounds(b, 0.25, 0);
    expect(p.north - p.south).toBeCloseTo(0.1 * 1.5, 9);
    expect(p.east - p.west).toBeCloseTo(0.2 * 1.5, 9);
    expect((p.north + p.south) / 2).toBeCloseTo(45.05, 9);
    expect((p.east + p.west) / 2).toBeCloseTo(-74.9, 9);
  });

  it('widens a tiny route to the minimum span before padding — a 200 m loop keeps room to pinch', () => {
    // ~100 m × ~100 m at Ottawa's latitude
    const b = { south: 45.4, west: -75.7, north: 45.4009, east: -75.6987 };
    const p = padBounds(b);
    const latM = (p.north - p.south) * 111_320;
    const lngM = (p.east - p.west) * 111_320 * Math.cos((45.4 * Math.PI) / 180);
    expect(latM).toBeCloseTo(FRAME.minSpanM * 1.5, -1);
    expect(lngM).toBeCloseTo(FRAME.minSpanM * 1.5, -1);
  });

  it('clamps latitude to the Web Mercator range', () => {
    const p = padBounds({ south: 84.95, west: 10, north: 85.05, east: 10.5 });
    expect(p.north).toBe(85.05); // 85.0 + 0.075 would be past the range
    expect(p.south).toBeCloseTo(84.925, 9);
  });

  it('containsPoint answers the frame question', () => {
    const p = { south: 45, west: -76, north: 46, east: -75 };
    expect(containsPoint(p, 45.5, -75.5)).toBe(true);
    expect(containsPoint(p, 44.9, -75.5)).toBe(false);
    expect(containsPoint(p, 45.5, -74.9)).toBe(false);
  });

  it('the numbers live in one place', () => {
    expect(FRAME).toEqual({ padRatio: 0.25, maxZoom: 17, fitPaddingPx: 24, minSpanM: 400 });
  });
});
