import { describe, it, expect } from 'vitest';
import {
  rankCourseName,
  courseDisplayName,
  normalizeOpenGolfSummary,
  normalizeOpenGolfDetail,
  normalizeGcaSummary,
  normalizeGcaDetail,
  normalizeOsmElement,
  rowToCourse,
  isThinRow,
  UUID_RE,
  mergeSearchRows,
  adoptionDecision,
  sameFacilityName,
  catalogAttribution,
  OSM_ATTRIBUTION,
  OPENGOLF_ATTRIBUTION,
  type CatalogRow,
  type NearbyRow,
} from '../course-catalog';

/** Minimal catalog row; tests override what they care about. */
function row(overrides: Partial<CatalogRow> & Pick<CatalogRow, 'id' | 'name'>): CatalogRow {
  return {
    external_source: 'osm',
    external_id: `way/${overrides.id}`,
    club_name: null,
    city: null,
    region: null,
    country: null,
    total_par: null,
    holes_count: null,
    hole_data: null,
    course_rating: {},
    slope_rating: {},
    lat: null,
    lng: null,
    description: null,
    description_attribution: null,
    architect: null,
    year_built: null,
    course_type: null,
    website: null,
    phone: null,
    hydrated_at: null,
    place_id: null,
    country_code: null,
    region_code: null,
    location_source: null,
    ...overrides,
  };
}

const nearby = (overrides: Partial<NearbyRow> & Pick<NearbyRow, 'id'>): NearbyRow => ({
  external_source: 'osm',
  external_id: `way/${overrides.id}`,
  name: 'Eagle Creek Golf Course',
  club_name: null,
  city: null,
  region: null,
  country: null,
  ...overrides,
});

describe('mergeSearchRows (post-import relevance + browse order)', () => {
  it('keeps DB order for an empty query — no ladder, no name sort', () => {
    // hydrated_at DESC NULLS LAST, name: the touched course leads even though
    // "'t Kruisselt" sorts first alphabetically (prod browse-head bug).
    const rows = [
      row({ id: 'a', name: 'Royal Ottawa Golf Club', hydrated_at: '2026-08-23T16:39:21Z' }),
      row({ id: 'b', name: "'t Kruisselt" }),
      row({ id: 'c', name: '"Ground Golf"' }),
    ];
    expect(mergeSearchRows(rows, '', 10).map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(mergeSearchRows(rows, '   ', 2).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('dedupes by id keeping the first (prefix-pass) occurrence', () => {
    const rows = [
      row({ id: 'k', name: 'Kanata Golf Club' }),
      row({ id: 'k', name: 'Kanata Golf Club' }),
      row({ id: 'x', name: 'Acacia Golf Course', city: 'Karachi' }),
    ];
    expect(mergeSearchRows(rows, 'ka', 10).map(r => r.id)).toEqual(['k', 'x']);
  });

  it('ladders exact > prefix > word-boundary > substring and keeps DB order inside a rank', () => {
    // The 'ka' regression: city prefix hits sorted ahead of the NAME prefix
    // hit in the alphabetical window. With the ladder the name prefix wins,
    // and two rank-1 rows keep their DB (hydrated-first) order — never a
    // localeCompare re-sort.
    const rows = [
      row({ id: 'city1', name: 'Acacia Golf Course', city: 'Karachi' }),
      row({ id: 'city2', name: 'Almaguin Highlands', city: 'Katrine' }),
      row({ id: 'p2', name: 'Kanata Golf Club', hydrated_at: '2026-08-23T00:00:00Z' }),
      row({ id: 'p1', name: 'Kananaskis Country Golf Course' }),
      row({ id: 'sub', name: 'Mikanata Links' }),
      row({ id: 'word', name: 'Club Kanata' }),
      row({ id: 'exact', name: 'Ka' }),
    ];
    expect(mergeSearchRows(rows, 'ka', 10).map(r => r.id)).toEqual([
      'exact',
      'p2',
      'p1',
      'city1',
      'city2',
      'word',
      'sub',
    ]);
  });

  it('breaks same-rank ties by richness: real data > city known > bare identity', () => {
    // Three rows named exactly "Eagle Creek Golf Club" — the seeded Ottawa
    // one carries the scorecard and must not lose to bare OSM rows that
    // happen to sort earlier.
    const rows = [
      row({ id: 'bare1', name: 'Eagle Creek Golf Club' }),
      row({ id: 'bare2', name: 'Eagle Creek Golf Club' }),
      row({ id: 'city', name: 'Eagle Creek Golf Club', city: 'Indianapolis' }),
      row({
        id: 'seed',
        name: 'Eagle Creek Golf Club',
        external_source: 'seed',
        city: 'Ottawa',
        hole_data: [{ number: 1, par: 4, yardage: { white: 380 }, handicap: 5 }],
        course_rating: { white: 71.8 },
        slope_rating: { white: 131 },
      }),
    ];
    expect(mergeSearchRows(rows, 'eagle creek', 10).map(r => r.id)).toEqual(['seed', 'city', 'bare1', 'bare2']);
    // Richness never overrides rank: a bare exact match still beats a rich prefix match.
    const exactBare = row({ id: 'exact', name: 'Eagle Creek' });
    expect(mergeSearchRows([rows[3], exactBare], 'eagle creek', 10).map(r => r.id)).toEqual(['exact', 'seed']);
  });

  it('respects the limit after ranking', () => {
    const rows = [row({ id: 'z', name: 'Zed Kanata' }), row({ id: 'k', name: 'Kanata Golf Club' })];
    expect(mergeSearchRows(rows, 'kanata', 1).map(r => r.id)).toEqual(['k']);
  });
});

describe('adoptionDecision (provider hit meets the OSM catalog)', () => {
  it('inserts when nothing nearby shares a name', () => {
    expect(adoptionDecision({ external_source: 'opengolfapi' }, [])).toEqual({ action: 'insert' });
    expect(adoptionDecision({ external_source: 'osm' }, [])).toEqual({ action: 'insert' });
  });

  it('adopts an OSM-only neighbour so the row can hydrate via the provider', () => {
    const target = nearby({ id: 'osm-1' });
    expect(adoptionDecision({ external_source: 'opengolfapi' }, [target])).toEqual({
      action: 'adopt',
      target,
    });
    expect(adoptionDecision({ external_source: 'golfcourseapi' }, [target]).action).toBe('adopt');
  });

  it('skips when any neighbour is already provider-carried (pre-import behaviour)', () => {
    const provider = nearby({ id: 'p', external_source: 'opengolfapi', external_id: '123' });
    expect(adoptionDecision({ external_source: 'golfcourseapi' }, [provider])).toEqual({ action: 'skip' });
    expect(
      adoptionDecision({ external_source: 'golfcourseapi' }, [nearby({ id: 'osm-1' }), provider])
    ).toEqual({ action: 'skip' });
  });

  it('never lets an OSM row adopt anything (import path stays insert-or-skip)', () => {
    expect(adoptionDecision({ external_source: 'osm' }, [nearby({ id: 'osm-1' })])).toEqual({ action: 'skip' });
  });

  it('picks the OSM neighbour as the target when several match', () => {
    const first = nearby({ id: 'osm-1' });
    const second = nearby({ id: 'osm-2' });
    const d = adoptionDecision({ external_source: 'opengolfapi' }, [first, second]);
    expect(d.action === 'adopt' && d.target.id).toBe('osm-1');
  });
});

describe('sameFacilityName (coord-less dedupe rule)', () => {
  it('accepts a strict token subset in either direction', () => {
    expect(sameFacilityName('Kahkwa Club', 'The Kahkwa Club')).toBe(true);
    expect(sameFacilityName('The Kahkwa Club', 'Kahkwa Club')).toBe(true);
    expect(sameFacilityName('Eagle Creek Golf Club', 'Eagle Creek Golf Course')).toBe(true);
  });

  it('rejects same-city clubs that merely share a token', () => {
    expect(sameFacilityName('Ottawa Hunt and Golf Club', 'Ottawa Valley Golf Club')).toBe(false);
    expect(sameFacilityName('Pinehurst No. 2', 'Pinehurst No. 8')).toBe(false);
    expect(sameFacilityName('The Marshes Golf Club', 'The Marchwood')).toBe(false);
  });

  it('never matches generic-only names', () => {
    expect(sameFacilityName('Golf Club', 'The Golf Course')).toBe(false);
  });
});

describe('catalogAttribution (ODbL, always on)', () => {
  it('sends the OSM line with providers off and the provider suffix with them on', () => {
    expect(catalogAttribution(false)).toBe(OSM_ATTRIBUTION);
    expect(catalogAttribution(true)).toBe(OPENGOLF_ATTRIBUTION);
    expect(OSM_ATTRIBUTION).toMatch(/OpenStreetMap contributors/);
    expect(OPENGOLF_ATTRIBUTION.startsWith(OSM_ATTRIBUTION)).toBe(true);
  });
});

describe('rowToCourse carries provenance', () => {
  it('exposes external_source as source so the picker can be honest per row', () => {
    expect(rowToCourse(row({ id: 'o', name: 'Kanata Golf Club' })).source).toBe('osm');
    expect(rowToCourse(row({ id: 'p', name: 'X', external_source: 'opengolfapi' })).source).toBe('opengolfapi');
  });
});

// Fixtures below are transcribed from LIVE provider responses (Aug 2026),
// not from docs — the old provider scaffolding died of guessed shapes.

describe('rankCourseName', () => {
  it('ladders exact > prefix > word-boundary > substring > none', () => {
    expect(rankCourseName('Pebble Beach Golf Links', 'pebble beach golf links')).toBe(0);
    expect(rankCourseName('Pebble Beach Golf Links', 'pebble')).toBe(1);
    expect(rankCourseName('Creekside At Pebble Creek', 'pebble')).toBe(2);
    expect(rankCourseName('Kingpebble GC', 'pebble')).toBe(3);
    expect(rankCourseName('Augusta National', 'pebble')).toBe(4);
  });
});

describe('courseDisplayName', () => {
  it('prefixes the club only when the course name does not carry it', () => {
    expect(courseDisplayName('St Andrews', 'St Andrews')).toBe('St Andrews');
    expect(courseDisplayName('Pinehurst Resort', 'No. 2')).toBe('Pinehurst Resort – No. 2');
    expect(courseDisplayName(null, 'Old Course')).toBe('Old Course');
    expect(courseDisplayName('  ', 'Old Course')).toBe('Old Course');
  });
});

describe('normalizeOpenGolfSummary (live search shape)', () => {
  it('maps identity and stays thin', () => {
    const row = normalizeOpenGolfSummary({
      id: '40977ee8-33ee-4195-b6a2-99a4ca83c2bc',
      course_name: 'Pebble Beach Golf Links',
      city: 'Pebble Beach',
      state: 'CA',
      country_iso: 'US',
      lat: 36.5685,
      lng: -121.949,
      par: 72,
      holes: 18,
    });
    expect(row.external_source).toBe('opengolfapi');
    expect(row.name).toBe('Pebble Beach Golf Links');
    expect(row.region).toBe('California');
    expect(row.region_code).toBe('CA');
    expect(row.country).toBe('United States');
    expect(row.country_code).toBe('US');
    expect(row.location_source).toBe('provider');
    expect(row.total_par).toBe(72);
    expect(isThinRow(row)).toBe(true); // search carries no ratings/holes
  });
});

describe('normalizeOpenGolfDetail (live detail shape)', () => {
  const detail = {
    id: '40977ee8-33ee-4195-b6a2-99a4ca83c2bc',
    course_name: 'Pebble Beach Golf Links',
    club_name: 'Pebble Beach Golf Linkstm',
    city: 'Pebble Beach',
    state: 'CA',
    par: 72,
    holes: 18,
    tees: [
      { tee_name: 'Blue', tee_color: 'blue', gender: 'Male', course_rating: 74.9, slope: 144 },
      { tee_name: 'Red', tee_color: 'red', gender: 'Female', course_rating: 72.1, slope: 130 },
      // Female tee colliding with a male key gets the (f) suffix
      { tee_name: 'Blue', tee_color: 'blue', gender: 'Female', course_rating: 76.0, slope: 139 },
    ],
    holes_data: [
      { number: 1, par: 4, handicap_index: 6, yardages: { red: 310, blue: 378, white: 337 } as Record<string, number> },
      { number: 2, par: 5, handicap_index: 10, yardages: { red: 420, blue: 502 } as Record<string, number> },
    ],
  };

  it('keys ratings by tee color, male first, female collisions suffixed', () => {
    const row = normalizeOpenGolfDetail(detail);
    expect(row.course_rating).toEqual({ blue: 74.9, red: 72.1, 'blue (f)': 76.0 });
    expect(row.slope_rating).toEqual({ blue: 144, red: 130, 'blue (f)': 139 });
  });

  it('keeps numbered holes with per-tee yardage records', () => {
    const row = normalizeOpenGolfDetail(detail);
    expect(row.hole_data).toHaveLength(2);
    expect(row.hole_data?.[0]).toEqual({ number: 1, par: 4, yardage: { red: 310, blue: 378, white: 337 }, handicap: 6 });
    expect(isThinRow(row)).toBe(false);
  });

  it('never fabricates holes', () => {
    const row = normalizeOpenGolfDetail({ ...detail, holes_data: [] });
    expect(row.hole_data).toBeNull();
  });
});

describe('normalizeGcaSummary (live search shape)', () => {
  it('maps identity, treats "Unknown" as null, stays thin', () => {
    const row = normalizeGcaSummary({
      id: '95rgfm85',
      club_name: 'St Andrews',
      course_name: 'St Andrews',
      location: { state: 'Unknown', country: 'Unknown' },
    });
    expect(row.external_source).toBe('golfcourseapi');
    expect(row.external_id).toBe('95rgfm85');
    expect(row.name).toBe('St Andrews');
    expect(row.region).toBeNull();
    expect(row.country).toBeNull();
    expect(isThinRow(row)).toBe(true);
  });
});

describe('normalizeGcaDetail (live detail shape — nests under `course`)', () => {
  const course = {
    id: '95rgfm85',
    club_name: 'St Andrews',
    course_name: 'St Andrews',
    location: { state: 'Unknown', country: 'Unknown' },
    tees: {
      male: [
        {
          tee_name: 'blue', course_rating: 69.1, slope_rating: 115,
          number_of_holes: 18, par_total: 70,
          holes: [
            { par: 4, yardage: 355 }, { par: 4, yardage: 380 },
          ],
        },
        {
          tee_name: 'white', course_rating: 67.9, slope_rating: 111,
          number_of_holes: 18, par_total: 70,
          holes: [
            { par: 4, yardage: 340 }, { par: 4, yardage: 362 },
          ],
        },
      ],
      female: [
        {
          tee_name: 'blue', course_rating: 71.2, slope_rating: 121,
          number_of_holes: 18, par_total: 70,
          // Different hole count → contributes NO per-hole yardage
          holes: [{ par: 4, yardage: 300 }],
        },
      ],
    },
  };

  it('numbers positional holes and assembles per-tee yardage from same-length boxes', () => {
    const row = normalizeGcaDetail(course);
    expect(row.hole_data).toHaveLength(2);
    expect(row.hole_data?.[0]).toEqual({ number: 1, par: 4, yardage: { blue: 355, white: 340 }, handicap: 0 });
    expect(row.hole_data?.[1].yardage).toEqual({ blue: 380, white: 362 });
  });

  it('folds ratings male-first with (f) suffix on collision', () => {
    const row = normalizeGcaDetail(course);
    expect(row.course_rating).toEqual({ blue: 69.1, white: 67.9, 'blue (f)': 71.2 });
    expect(row.slope_rating).toEqual({ blue: 115, white: 111, 'blue (f)': 121 });
    expect(row.total_par).toBe(70);
  });
});

describe('rowToCourse / UUID_RE', () => {
  it('produces the flat composer shape and validates catalog ids', () => {
    const course = rowToCourse({
      id: '9c504cde-d0c1-5c17-a568-063446830d98',
      external_source: 'seed',
      external_id: 'pebble-beach',
      name: 'Pebble Beach Golf Links',
      club_name: null,
      city: 'Pebble Beach',
      region: 'California',
      country: 'USA',
      total_par: 72,
      holes_count: 18,
      hole_data: [{ number: 1, par: 4, yardage: { white: 350 }, handicap: 11 }],
      course_rating: { white: 71.4 },
      slope_rating: { white: 133 },
      lat: null,
      lng: null,
      description: null,
      description_attribution: null,
      architect: null,
      year_built: null,
      course_type: null,
      website: null,
      phone: null,
      hydrated_at: null,
      place_id: null,
      country_code: 'US',
      region_code: 'CA',
      location_source: 'provider',
    });
    expect(course.countryCode).toBe('US');
    expect(course.regionCode).toBe('CA');
    expect(course.city).toBe('Pebble Beach');
    expect(course.state).toBe('California');
    expect(course.holes[0].yardage.white).toBe(350);
    expect(UUID_RE.test(course.id)).toBe(true);
    expect(UUID_RE.test('history-pebble-beach')).toBe(false);
    expect(UUID_RE.test('95rgfm85')).toBe(false);
  });
});

describe('normalizeOsmElement (Overpass out tags center shape)', () => {
  const eagleCreek = {
    type: 'way',
    id: 12345678,
    tags: {
      leisure: 'golf_course',
      name: 'Eagle Creek Golf Course',
      'addr:city': 'Ottawa',
      'addr:province': 'Ontario',
      website: 'https://eaglecreekgolf.ca',
      holes: '18',
    },
    center: { lat: 45.46393, lng: undefined, lon: -76.0423553 },
  };

  it('maps a named course way to a thin osm row', () => {
    const row = normalizeOsmElement(eagleCreek);
    expect(row).not.toBeNull();
    expect(row!.external_source).toBe('osm');
    expect(row!.external_id).toBe('way/12345678');
    expect(row!.name).toBe('Eagle Creek Golf Course');
    expect(row!.city).toBe('Ottawa');
    expect(row!.region).toBe('Ontario');
    expect(row!.holes_count).toBe(18);
    expect(row!.lat).toBeCloseTo(45.46393);
    expect(row!.lng).toBeCloseTo(-76.0423553);
    expect(row!.website).toBe('https://eaglecreekgolf.ca');
    expect(isThinRow(row!)).toBe(true);
  });

  it('relations get relation/-prefixed external ids', () => {
    const row = normalizeOsmElement({
      type: 'relation',
      id: 11276774,
      tags: { leisure: 'golf_course', name: 'The Marshes Golf Club' },
      center: { lat: 45.35, lon: -75.9 },
    });
    expect(row!.external_id).toBe('relation/11276774');
    expect(row!.city).toBeNull();
  });

  it('rejects nameless, coordless, and non-way/relation elements', () => {
    expect(normalizeOsmElement({ type: 'way', id: 1, tags: {}, center: { lat: 1, lon: 1 } })).toBeNull();
    expect(normalizeOsmElement({ type: 'way', id: 1, tags: { name: 'X GC' } })).toBeNull();
    expect(
      normalizeOsmElement({ type: 'node', id: 1, tags: { name: 'X GC' }, center: { lat: 1, lon: 1 } })
    ).toBeNull();
  });

  it('filters driving ranges and mini-putt by tag and by name', () => {
    expect(
      normalizeOsmElement({
        type: 'way',
        id: 2,
        tags: { name: 'Kevin Haime Golf Centre', golf: 'driving_range' },
        center: { lat: 45.3, lon: -75.9 },
      })
    ).toBeNull();
    for (const name of [
      "Stan's Driving Range & Miniature Golf",
      'White Sands Golf Course and Practice Center',
      'Riverside Mini-Putt',
    ]) {
      expect(
        normalizeOsmElement({ type: 'way', id: 3, tags: { name }, center: { lat: 45.3, lon: -75.9 } })
      ).toBeNull();
    }
    // Real courses with superficially similar words survive.
    expect(
      normalizeOsmElement({
        type: 'way',
        id: 4,
        tags: { name: 'Practice Green Golf Club' },
        center: { lat: 45.3, lon: -75.9 },
      })
    ).not.toBeNull();
  });
});
