import { describe, it, expect } from 'vitest';
import { listTimeZones, venueTimeLabel } from '../venue-time';

const NY = 'America/New_York';
const DENVER = 'America/Denver';
const PHOENIX = 'America/Phoenix';
const LA = 'America/Los_Angeles';

// Every call passes viewerTz explicitly — tests must never depend on the
// runner's zone.

describe('venueTimeLabel', () => {
  const summerGame = {
    starts_at: '2026-07-16T01:00:00.000Z', // 7:00 PM Jul 15 MDT
    all_day: false,
    timezone: DENVER,
  };

  it("renders the venue's wall clock with a short zone name", () => {
    expect(venueTimeLabel(summerGame, LA)).toBe('7:00 PM MDT');
  });

  it('is null when the viewer is in the event zone', () => {
    expect(venueTimeLabel(summerGame, DENVER)).toBeNull();
  });

  it('is null for all-day events', () => {
    expect(venueTimeLabel({ ...summerGame, all_day: true }, LA)).toBeNull();
  });

  it('is null when a different zone currently shows the same wall clock', () => {
    // Phoenix (no DST) matches Denver in winter: repeating the visible
    // time is noise, not information.
    const winterGame = {
      starts_at: '2026-01-16T02:00:00.000Z', // 7:00 PM Jan 15 MST in both
      all_day: false,
      timezone: DENVER,
    };
    expect(venueTimeLabel(winterGame, PHOENIX)).toBeNull();
    // …but in summer Denver observes DST and Phoenix does not.
    expect(venueTimeLabel(summerGame, PHOENIX)).toBe('7:00 PM MDT');
  });

  it('labels a cross-country divergence', () => {
    expect(venueTimeLabel(summerGame, NY)).toBe('7:00 PM MDT');
  });

  it('degrades to null on a malformed zone or timestamp', () => {
    expect(venueTimeLabel({ ...summerGame, timezone: 'Not/AZone' }, NY)).toBeNull();
    expect(venueTimeLabel({ ...summerGame, starts_at: 'garbage' }, NY)).toBeNull();
  });
});

describe('listTimeZones', () => {
  it('always contains the current selection and stays sorted', () => {
    const zones = listTimeZones('America/Argentina/Ushuaia');
    expect(zones).toContain('America/Argentina/Ushuaia');
    expect([...zones].sort()).toEqual(zones);
  });

  it('contains the common zones an athlete family actually picks', () => {
    const zones = listTimeZones(NY);
    for (const z of [NY, DENVER, LA, 'America/Chicago', 'Europe/London', 'UTC']) {
      expect(zones).toContain(z);
    }
  });
});
