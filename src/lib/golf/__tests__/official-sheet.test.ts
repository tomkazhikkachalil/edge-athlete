import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { findOfficialSheet, pickSheetCandidate, readMapSheet, sheetSearchQueries, withMapSheet, SHEET_PROVIDERS, SHEET_SEARCH_MAX, type CatalogRow } from '../course-catalog';

// Nov 16 2026: "Find the official scorecard" asks EVERY provider that is not
// the row's own, by name, until the card lacks nothing; answers fill the card.
// The response shapes are the ones the normalisers' tests pin from live calls.

vi.mock('@/lib/observability/report', () => ({ reportRouteWarning: vi.fn(), reportRouteError: vi.fn() }));

const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  id: 'c1', external_source: 'osm', external_id: 'way/1', name: 'Camelot Golf & Country Club', club_name: null, city: 'Cumberland', region: 'Ontario',
  country: 'Canada', total_par: null, holes_count: null, hole_data: null, course_rating: {}, slope_rating: {}, lat: 45.3, lng: -75.7,
  description: null, description_attribution: null, architect: null, year_built: null, course_type: null, website: null, phone: null,
  hydrated_at: null, place_id: null, country_code: 'CA', region_code: 'ON', location_source: 'osm', club_id: null, section_name: null, section_kind: null,
  ...over,
} as CatalogRow);

function fakeAdmin(budget: boolean[] = [], geometry: unknown = null) {
  const updates: Array<Record<string, unknown>> = [];
  const keys: string[] = [];
  const read: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) read[m] = () => read;
  read.maybeSingle = async () => ({ data: { hole_geometry: geometry }, error: null });
  read.update = (fields: Record<string, unknown>) => {
    updates.push(fields);
    return { eq: async () => ({ error: null }) };
  };
  const answers = [...budget];
  const admin = {
    rpc: (_fn: string, args: { p_key: string }) => {
      keys.push(args.p_key);
      return { single: async () => ({ data: { allowed: answers.shift() ?? true }, error: null }) };
    },
    from: () => read,
  };
  return { admin: admin as never, updates, keys };
}

const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** OpenGolfAPI: pars + one tee's yardages, no stroke index, no ratings. */
const openGolfDetail = (pars = NINE.map(() => 4)) => ({
  id: 'og-1', course_name: 'Camelot', club_name: 'Camelot Golf & Country Club', city: 'Cumberland', state: 'ON', country_iso: 'CA', par: 36, holes: 9,
  tees: [], holes_data: NINE.map((n, i) => ({ number: n, par: pars[i], yardages: { white: 380 + n } })),
});
/** GolfCourseAPI: two tees with ratings and stroke indexes. */
const gcaDetail = (pars = NINE.map(() => 4)) => ({
  course: {
    id: 'gca-1', club_name: 'Camelot Golf & Country Club', course_name: 'Camelot', location: { city: 'Cumberland', state: 'ON', country: 'Canada' },
    tees: {
      male: ['Blue', 'White'].map((tee_name, t) => ({
        tee_name, course_rating: 71 - t, slope_rating: 128 - t, number_of_holes: 9, par_total: 36,
        holes: NINE.map((n, i) => ({ par: pars[i], yardage: 400 - t * 30 + n, handicap: n })),
      })),
    },
  },
});

function stubProviders(over: { openGolfSearch?: unknown; openGolf?: unknown; gcaSearch?: unknown; gca?: unknown; fail?: string } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const host = url.includes('opengolfapi.org') ? 'opengolfapi' : 'golfcourseapi';
    const kind = url.includes('search') ? 'search' : 'detail';
    calls.push(`${host}:${kind}`);
    if (over.fail === `${host}:${kind}`) return { ok: false, status: 503, json: async () => ({}) };
    const body =
      host === 'opengolfapi'
        ? kind === 'search' ? over.openGolfSearch ?? { courses: [{ id: 'og-1', course_name: 'Camelot Golf & Country Club', city: 'Cumberland', state: 'ON', country_iso: 'CA' }] } : over.openGolf ?? openGolfDetail()
        : kind === 'search' ? over.gcaSearch ?? { courses: [{ id: 'gca-1', club_name: 'Camelot Golf & Country Club', course_name: 'Camelot', location: { city: 'Cumberland', state: 'ON', country: 'Canada' } }] } : over.gca ?? gcaDetail();
    return { ok: true, json: async () => body };
  }));
  return calls;
}

beforeEach(() => {
  vi.stubEnv('GOLF_COURSE_API_KEY', 'k');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('findOfficialSheet — every other provider, until the card lacks nothing', () => {
  it('the order: the keyless provider first, GolfCourseAPI for what is still missing', () => {
    expect(SHEET_PROVIDERS.map(p => p.source)).toEqual(['opengolfapi', 'golfcourseapi']);
  });

  it('a map-only row: OpenGolfAPI gives pars and a tee, GolfCourseAPI adds a tee, stroke indexes and ratings', async () => {
    const calls = stubProviders();
    const { admin, updates, keys } = fakeAdmin();
    const r = await findOfficialSheet(admin, row());
    expect(calls).toEqual(['opengolfapi:search', 'opengolfapi:detail', 'golfcourseapi:search', 'golfcourseapi:detail']);
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(r.course.holes[0]).toEqual({ number: 1, par: 4, yardage: { white: 381, blue: 401 }, handicap: 1 });
    expect(r.course.courseRating).toEqual({ blue: 71, white: 70 });
    expect(r.course.slopeRating).toEqual({ blue: 128, white: 127 });
    expect(updates).toHaveLength(1);
    expect(updates[0].sheet_sources).toEqual({ pars: 'opengolfapi', strokeIndex: 'golfcourseapi', tees: { white: 'opengolfapi', blue: 'golfcourseapi' }, ratings: { blue: 'golfcourseapi', white: 'golfcourseapi' } });
    expect(keys[0]).toBe('golf-sheet-ask:c1');
  });

  it('stops asking once the card is complete', async () => {
    const full = openGolfDetail() as Record<string, unknown>;
    full.tees = [{ tee_name: 'White', tee_color: 'white', course_rating: 69.8, slope: 122 }];
    full.holes_data = NINE.map(n => ({ number: n, par: 4, handicap_index: n, yardages: { white: 380 + n } }));
    const calls = stubProviders({ openGolf: full });
    const r = await findOfficialSheet(fakeAdmin().admin, row());
    expect(calls).toEqual(['opengolfapi:search', 'opengolfapi:detail']);
    expect(r.outcome).toBe('found');
  });

  it("the row's own provider is not asked again by name: an OpenGolfAPI row asks GolfCourseAPI only", async () => {
    const calls = stubProviders();
    await findOfficialSheet(fakeAdmin().admin, row({ external_source: 'opengolfapi', external_id: 'og-1' }));
    expect(calls).toEqual(['golfcourseapi:search', 'golfcourseapi:detail']);
  });

  it('a card with gaps is topped up, and nothing it holds is replaced', async () => {
    const stored = NINE.map(n => ({ number: n, par: 4, yardage: { white: 300 + n }, handicap: 0 }));
    stubProviders();
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, row({ external_source: 'opengolfapi', external_id: 'og-1', hole_data: stored, total_par: 36, holes_count: 9 }));
    expect(r.outcome).toBe('found');
    expect(r.course.holes[0]).toEqual({ number: 1, par: 4, yardage: { white: 301, blue: 401 }, handicap: 1 });
    expect((updates[0].course_rating as Record<string, number>).blue).toBe(71);
  });

  it('a complete card asks nobody', async () => {
    const calls = stubProviders();
    const complete = NINE.map(n => ({ number: n, par: 4, yardage: { white: 300 + n }, handicap: n }));
    const { admin, keys } = fakeAdmin();
    const r = await findOfficialSheet(admin, row({ hole_data: complete, course_rating: { white: 70 }, slope_rating: { white: 120 } }));
    expect(r.outcome).toBe('already');
    expect(calls).toEqual([]);
    expect(keys).toEqual([]);
  });

  it('an answer that disagrees with the stored card is refused; the card is still the card', async () => {
    const stored = NINE.map(n => ({ number: n, par: 4, yardage: { white: 300 + n }, handicap: 0 }));
    stubProviders({ gca: gcaDetail(NINE.map(() => 5)) });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, row({ external_source: 'opengolfapi', external_id: 'og-1', hole_data: stored }));
    expect(r).toMatchObject({ found: true, outcome: 'already' });
    expect(r.course.holes).toEqual(stored);
    expect(updates).toEqual([]);
  });

  it('one ask per course per day: a refused day asks no provider', async () => {
    const calls = stubProviders();
    const r = await findOfficialSheet(fakeAdmin([false]).admin, row());
    expect(r).toMatchObject({ found: false, outcome: 'no_match' });
    expect(calls).toEqual([]);
  });

  it("one provider's trouble or spent budget does not stop the other", async () => {
    let calls = stubProviders({ fail: 'opengolfapi:search' });
    let r = await findOfficialSheet(fakeAdmin().admin, row());
    expect(calls).toEqual(['opengolfapi:search', 'golfcourseapi:search', 'golfcourseapi:detail']);
    expect(r.outcome).toBe('found');
    // The day's ask is allowed, OpenGolfAPI's budget is not.
    calls = stubProviders();
    r = await findOfficialSheet(fakeAdmin([true, false]).admin, row());
    expect(calls).toEqual(['golfcourseapi:search', 'golfcourseapi:detail']);
    expect(r.outcome).toBe('found');
  });

  it('nothing anywhere: the reason is named and nothing is written', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: { courses: [] } });
    const { admin, updates } = fakeAdmin();
    expect(await findOfficialSheet(admin, row())).toMatchObject({ found: false, outcome: 'no_match' });
    stubProviders({ fail: 'golfcourseapi:search', openGolfSearch: { courses: [] } });
    expect((await findOfficialSheet(admin, row())).outcome).toBe('provider_error');
    expect(updates).toEqual([]);
  });

  it('a test row with a card is never topped up from outside', async () => {
    const calls = stubProviders();
    const stored = NINE.map(n => ({ number: n, par: 4, yardage: {}, handicap: 0 }));
    const r = await findOfficialSheet(fakeAdmin().admin, row({ external_source: 'qa-e2e' as never, hole_data: stored }));
    expect(r.outcome).toBe('already');
    expect(calls).toEqual([]);
  });
});

// Nov 18 2026 (Tom): the map card is protected from ONE wrong same-named
// course. Two independent providers that agree with each other against it
// are right and the map is wrong (production: Lost Marsh Golf Course was
// refused by both and kept no card).
describe('findOfficialSheet — two providers against the map', () => {
  /** A map card of nine par 3s: every provider card of par 4s disagrees with it. */
  const mapOf = (pars: number[]) => ({ source: 'osm', greens: [], holes: pars.map((par, i) => ({ hole: i + 1, par, line: [[45.3 + i * 0.001, -75.7], [45.3004 + i * 0.001, -75.7]] })) });
  const par3s = mapOf(NINE.map(() => 3));

  it('both providers agree with each other: their card is taken and the map is recorded as overruled', async () => {
    stubProviders();
    const { admin, updates } = fakeAdmin([], par3s);
    const r = await findOfficialSheet(admin, row());
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(r.course.holes.map(h => h.par)).toEqual(NINE.map(() => 4));
    expect(r.course.holes[0].yardage).toEqual({ white: 381, blue: 401 });
    expect(updates).toHaveLength(1);
    expect(updates[0].sheet_sources).toMatchObject({ pars: 'opengolfapi', mapOverruled: true });
  });

  it('ONE provider against the map: taken when it is the only card, whole, and has the map\'s hole count', async () => {
    // Club de Golf Gatineau, production Nov 18 2026: the paid provider held the card, the map refused it.
    stubProviders({ openGolfSearch: { courses: [] } });
    const { admin, updates } = fakeAdmin([], par3s);
    const r = await findOfficialSheet(admin, row());
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(r.course.holes.map(h => h.par)).toEqual(NINE.map(() => 4));
    expect(updates[0].sheet_sources).toMatchObject({ pars: 'golfcourseapi', mapOverruled: true });
    expect(r.trace!.find(t => t.source === 'golfcourseapi')!.result).toBe('filled');
  });

  it('ONE provider against the map: refused when its pars do not add up to its own total', async () => {
    const bad = gcaDetail();
    for (const tee of bad.course.tees.male) tee.par_total = 35;
    stubProviders({ openGolfSearch: { courses: [] }, gca: bad });
    const { admin, updates } = fakeAdmin([], par3s);
    const r = await findOfficialSheet(admin, row());
    expect(r).toMatchObject({ found: false, outcome: 'map_disagrees' });
    expect(updates).toEqual([]);
  });

  it('ONE provider against the map: refused when the map has a different number of holes', async () => {
    stubProviders({ openGolfSearch: { courses: [] } });
    const { admin, updates } = fakeAdmin([], mapOf(Array.from({ length: 18 }, () => 3)));
    const r = await findOfficialSheet(admin, row());
    expect(r).toMatchObject({ found: false, outcome: 'map_disagrees' });
    expect(updates).toEqual([]);
  });

  it('two providers that disagree with the map AND with each other are both refused', async () => {
    stubProviders({ gca: gcaDetail(NINE.map(() => 5)) });
    const { admin, updates } = fakeAdmin([], par3s);
    const r = await findOfficialSheet(admin, row());
    expect(r).toMatchObject({ found: false, outcome: 'map_disagrees' });
    expect(updates).toEqual([]);
  });

  it('a map the providers agree with is not "overruled"', async () => {
    stubProviders();
    const { admin, updates } = fakeAdmin([], mapOf(NINE.map(() => 4)));
    const r = await findOfficialSheet(admin, row());
    expect(r.outcome).toBe('found');
    expect(updates[0].sheet_sources).not.toHaveProperty('mapOverruled');
  });
});

// Nov 18 2026: a miss says what each provider's ask came to (counts and a
// reason, never the provider's data).
// Nov 18 2026: lines without pars give an ESTIMATED card to show, and the
// estimate is never evidence against a provider's card.
describe('a map with lines but no pars', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  // Each line is about 49 yards long: every estimated par is a 3.
  const noPars = { source: 'osm', greens: [], holes: NINE.map((n, i) => ({ hole: n, line: [[45.3 + i * 0.001, -75.7], [45.3004 + i * 0.001, -75.7]] })) };
  const course = { id: ID, name: 'Camelot', holes: [], totalPar: 0, courseRating: {}, slopeRating: {} } as never;

  it('withMapSheet shows the estimated card, marked hole by hole', async () => {
    const { admin, updates } = fakeAdmin([], noPars);
    const c = await withMapSheet(admin, course);
    expect(c.sheetSource).toBe('map_estimated');
    expect(c.holes).toHaveLength(9);
    expect(c.holes.every(h => h.par === 3 && h.parEstimated === true)).toBe(true);
    expect(c.totalPar).toBe(27);
    expect(updates).toHaveLength(0); // read time only: nothing is saved
  });

  it('withMapSheet prefers tagged pars: one untagged hole makes the whole card estimated, none makes it a map card', async () => {
    const tagged = { ...noPars, holes: noPars.holes.map(h => ({ ...h, par: 4 })) };
    expect((await withMapSheet(fakeAdmin([], tagged).admin, course)).sheetSource).toBe('map');
    const oneMissing = { ...noPars, holes: tagged.holes.map((h, i) => (i === 2 ? noPars.holes[2] : h)) };
    const c = await withMapSheet(fakeAdmin([], oneMissing).admin, course);
    expect(c.sheetSource).toBe('map_estimated');
    expect(c.holes.map(h => h.par)).toEqual([4, 4, 3, 4, 4, 4, 4, 4, 4]);
    expect(c.holes.filter(h => h.parEstimated).map(h => h.number)).toEqual([3]);
  });

  it('the guards read no card there: a provider card of nine par 4s is taken, and no map is recorded as overruled', async () => {
    expect(await readMapSheet(fakeAdmin([], noPars).admin, ID)).toBeNull();
    stubProviders({ openGolfSearch: { courses: [] } });
    const { admin, updates } = fakeAdmin([], noPars);
    const r = await findOfficialSheet(admin, row());
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(r.course.holes.map(h => h.par)).toEqual(NINE.map(() => 4));
    expect((updates[0].sheet_sources as { mapOverruled?: boolean }).mapOverruled).toBeUndefined();
  });
});

describe('findOfficialSheet — the trace', () => {
  it('names why each provider gave nothing', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: { courses: [{ id: 'gca-9', club_name: 'Some Other Club', course_name: 'Other', location: { city: 'Elsewhere', state: 'ON', country: 'Canada' } }] } });
    const { admin } = fakeAdmin();
    const r = await findOfficialSheet(admin, row());
    expect(r.found).toBe(false);
    expect(r.trace).toEqual([
      { source: 'opengolfapi', searches: 1, candidates: 0, named: 0, picked: null, result: 'no_candidates' },
      { source: 'golfcourseapi', searches: 1, candidates: 1, named: 0, picked: null, result: 'no_name_match' },
    ]);
  });

  it('a fill is traced too, and a complete card asks nobody so has no trace', async () => {
    stubProviders();
    const { admin } = fakeAdmin();
    const r = await findOfficialSheet(admin, row());
    expect(r.trace!.map(t => `${t.source}:${t.result}`)).toEqual(['opengolfapi:filled', 'golfcourseapi:filled']);
    const again = await findOfficialSheet(fakeAdmin().admin, { ...row(), hole_data: r.course.holes, course_rating: r.course.courseRating, slope_rating: r.course.slopeRating } as CatalogRow);
    expect(again.outcome).toBe('already');
    expect(again.trace).toBeUndefined();
  });

  it('a provider that is down is traced as such', async () => {
    stubProviders({ fail: 'opengolfapi:search', gcaSearch: { courses: [] } });
    const { admin } = fakeAdmin();
    const r = await findOfficialSheet(admin, row());
    expect(r.trace!.map(t => t.result)).toEqual(['provider_error', 'no_candidates']);
  });
});

// Nov 18 2026: Tom's own courses returned "nothing found" from BOTH providers
// because of how the search was worded, not because they are missing.
describe('the search is widened when it returns nothing', () => {
  it('the wordings: all the distinctive words, then without the section, then fewer words', () => {
    expect(sheetSearchQueries('Ottawa Hunt and Golf Club (North Nine)')).toEqual(['ottawa hunt north nine', 'ottawa hunt', 'ottawa']);
    expect(sheetSearchQueries('Greensmere Golf & Country Club (Legacy)')).toEqual(['greensmere legacy', 'greensmere']);
    expect(sheetSearchQueries('Carleton Golf & Yacht Club')).toEqual(['carleton yacht', 'carleton']);
    expect(sheetSearchQueries('Rockland Golf Club - East')).toEqual(['rockland east', 'rockland']);
    expect(sheetSearchQueries('Camelot Golf & Country Club')).toEqual(['camelot']);
    expect(sheetSearchQueries('The Links at Spanish Bay Resort North Shore Course').length).toBeLessThanOrEqual(SHEET_SEARCH_MAX);
  });

  it('a second search is made only when the first returns nothing, and it is budgeted', async () => {
    const queries: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url);
      const q = u.searchParams.get('q') ?? u.searchParams.get('search_query');
      if (q != null) {
        queries.push(`${url.includes('opengolfapi') ? 'og' : 'gca'}:${q}`);
        if (url.includes('opengolfapi')) return { ok: true, json: async () => ({ courses: [] }) };
        return { ok: true, json: async () => ({ courses: q === 'carleton' ? [{ id: 'gca-1', club_name: 'Carleton Golf & Yacht Club', course_name: 'Carleton', location: { city: 'Manotick', state: 'ON', country: 'Canada' } }] : [] }) };
      }
      return { ok: true, json: async () => gcaDetail() };
    }));
    const { admin, keys } = fakeAdmin();
    const r = await findOfficialSheet(admin, row({ name: 'Carleton Golf & Yacht Club', city: 'Manotick' }));
    expect(queries).toEqual(['og:carleton yacht', 'og:carleton', 'gca:carleton yacht', 'gca:carleton']);
    expect(r.outcome).toBe('found');
    expect(r.trace!.map(t => `${t.source}:${t.searches}:${t.result}`)).toEqual(['opengolfapi:2:no_candidates', 'golfcourseapi:2:filled']);
    // One budget unit per search and per detail call.
    expect(keys.filter(k => k === 'golf-provider:golfcourseapi')).toHaveLength(3);
    expect(keys.filter(k => k === 'golf-provider:opengolfapi')).toHaveLength(2);
  });

  it('a section takes only a candidate that names that section', () => {
    const c = (id: string, name: string) => ({ id, name, city: 'Almonte', region_code: 'ON', country_code: 'CA' });
    const legacy = { name: 'Greensmere Golf & Country Club (Legacy)', city: 'Almonte', region_code: 'ON', country_code: 'CA', section_name: 'Legacy' };
    // The club alone, or the sibling, is not this row's card.
    expect(pickSheetCandidate(legacy, [c('1', 'Greensmere Golf & Country Club')])).toBeNull();
    expect(pickSheetCandidate(legacy, [c('2', 'Greensmere Golf & Country Club - Premier')])).toBeNull();
    expect(pickSheetCandidate(legacy, [c('1', 'Greensmere Golf & Country Club'), c('2', 'Greensmere - Premier'), c('3', 'Greensmere - Legacy')])?.id).toBe('3');
    // "Nine" says nothing about which nine.
    const north = { name: 'Ottawa Hunt and Golf Club (North Nine)', city: 'Ottawa', region_code: 'ON', country_code: 'CA', section_name: 'North Nine' };
    expect(pickSheetCandidate(north, [c('4', 'Ottawa Hunt and Golf Club - North')])?.id).toBe('4');
    expect(pickSheetCandidate(north, [c('5', 'Ottawa Hunt and Golf Club - South/West')])).toBeNull();
    // A row with no section_name whose NAME carries one ("- East") is held to it too.
    const east = { name: 'Rockland Golf Club - East', city: 'Rockland', region_code: 'ON', country_code: 'CA' };
    expect(pickSheetCandidate(east, [c('7', 'Rockland Golf Club')])).toBeNull();
    expect(pickSheetCandidate(east, [c('7', 'Rockland Golf Club'), c('8', 'Rockland Golf Club - West'), c('9', 'Rockland Golf Club - East')])?.id).toBe('9');
    // A row with no section is matched as before.
    expect(pickSheetCandidate({ name: 'Camelot Golf & Country Club', city: 'Cumberland', region_code: 'ON', country_code: 'CA' }, [c('6', 'Camelot Golf & Country Club')])?.id).toBe('6');
  });

  it('a nine does not take an eighteen', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: { courses: [{ id: 'gca-1', club_name: 'Ottawa Hunt and Golf Club', course_name: 'North', location: { city: 'Ottawa', state: 'ON', country: 'Canada' } }] }, gca: { course: { ...gcaDetail().course, tees: { male: [{ tee_name: 'Blue', course_rating: 72, slope_rating: 130, number_of_holes: 18, par_total: 72, holes: Array.from({ length: 18 }, (_, i) => ({ par: 4, yardage: 400 + i, handicap: i + 1 })) }] } } } });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, row({ name: 'Ottawa Hunt and Golf Club (North Nine)', city: 'Ottawa', section_name: 'North Nine', section_kind: 'nine' } as Partial<CatalogRow>));
    expect(r.found).toBe(false);
    expect(r.trace!.find(t => t.source === 'golfcourseapi')!.result).toBe('wrong_holes');
    expect(updates).toEqual([]);
  });
});
