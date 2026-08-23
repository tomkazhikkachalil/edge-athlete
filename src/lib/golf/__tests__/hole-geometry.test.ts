import { describe, expect, it } from 'vitest';
import { parseHoleGeometry } from '../hole-geometry';
import rideauView from './fixtures/overpass-rideau-view.json';

// Fixture: a REAL Overpass `out geom` response for Rideau View GC (18
// golf=hole ways, refs 1–18, pars, tee→green polylines). Captured Aug 2026.

describe('parseHoleGeometry', () => {
  it('parses a clean 18-hole course (real Rideau View response)', () => {
    const g = parseHoleGeometry(rideauView);
    expect(g).not.toBeNull();
    expect(g!.holes).toHaveLength(18);
    expect(g!.holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    const h1 = g!.holes[0];
    expect(h1.par).toBeGreaterThanOrEqual(3);
    expect(h1.line.length).toBeGreaterThanOrEqual(2);
    // 6dp rounding, [lat,lng] order, plausibly at Rideau View (Manotick).
    expect(h1.line[0][0]).toBeGreaterThan(45.19);
    expect(h1.line[0][0]).toBeLessThan(45.21);
    expect(h1.line[0][1]).toBeLessThan(-75.6);
  });

  it('rejects duplicate refs — the Ottawa Hunt 27-hole ambiguity', () => {
    const dup = JSON.parse(JSON.stringify(rideauView)) as { elements: { tags: { ref: string } }[] };
    dup.elements[1].tags.ref = dup.elements[0].tags.ref;
    expect(parseHoleGeometry(dup)).toBeNull();
  });

  it('rejects unlabeled hole ways and short lines outright', () => {
    const noRef = JSON.parse(JSON.stringify(rideauView)) as { elements: { tags: { ref?: string } }[] };
    delete noRef.elements[4].tags.ref;
    expect(parseHoleGeometry(noRef)).toBeNull();

    const shortLine = JSON.parse(JSON.stringify(rideauView)) as {
      elements: { geometry: unknown[] }[];
    };
    shortLine.elements[2].geometry = shortLine.elements[2].geometry.slice(0, 1);
    expect(parseHoleGeometry(shortLine)).toBeNull();
  });

  it('rejects sub-9-hole coverage and junk payloads', () => {
    const few = { elements: (rideauView as { elements: unknown[] }).elements.slice(0, 5) };
    expect(parseHoleGeometry(few)).toBeNull();
    expect(parseHoleGeometry(null)).toBeNull();
    expect(parseHoleGeometry({})).toBeNull();
    expect(parseHoleGeometry({ elements: 'nope' })).toBeNull();
  });

  it('ignores non-hole golf features mixed into the response', () => {
    const mixed = JSON.parse(JSON.stringify(rideauView)) as { elements: unknown[] };
    mixed.elements.push({ type: 'way', tags: { golf: 'green' }, geometry: [] });
    const g = parseHoleGeometry(mixed);
    expect(g!.holes).toHaveLength(18);
  });
});
