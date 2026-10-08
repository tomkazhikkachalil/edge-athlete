import { describe, it, expect } from 'vitest';
import { atCourse, followDefault, shouldPan, AT_COURSE_KM } from '../map-follow';

// M1: Follow defaults ON at the course and OFF elsewhere; only panning is gated.

const pin: [number, number] = [45.3, -75.7];
// Eighteen straight holes marching north — hole 18's green ~7.5 km from the pin.
const holes = Array.from({ length: 18 }, (_, i) => {
  const lat = 45.3 + i * 0.004;
  return { line: [[lat, -75.7], [lat + 0.003, -75.699]] as [number, number][] };
});

describe('atCourse / followDefault', () => {
  it('on 200 m from the pin', () => {
    expect(followDefault([45.3018, -75.7], { pin })).toBe(true);
  });
  it('on 100 m from hole 18’s green, 7 km from the pin — the holes count', () => {
    const green = holes[17].line[1];
    const fix: [number, number] = [green[0] + 0.0009, green[1]];
    expect(atCourse(fix, { pin })).toBe(false);
    expect(atCourse(fix, { pin, holes })).toBe(true);
  });
  it('off 13 km away (downtown Ottawa) with or without holes', () => {
    expect(followDefault([45.4215, -75.6972], { pin, holes })).toBe(false);
    expect(followDefault([45.4215, -75.6972], { pin, holes: null })).toBe(false);
  });
  it('the band is AT_COURSE_KM', () => {
    const km = AT_COURSE_KM;
    expect(atCourse([45.3 + (km - 0.05) / 111.195, -75.7], { pin })).toBe(true);
    expect(atCourse([45.3 + (km + 0.05) / 111.195, -75.7], { pin })).toBe(false);
  });
});

describe('shouldPan', () => {
  it('only when on and not paused', () => {
    expect(shouldPan(true, false)).toBe(true);
    expect(shouldPan(true, true)).toBe(false);
    expect(shouldPan(false, false)).toBe(false);
    expect(shouldPan(null, false)).toBe(false);
  });
});
