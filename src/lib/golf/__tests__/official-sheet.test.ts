import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { nineFromCombination, type SheetHole } from '../sheet-merge';
import { confirmParsFromOpenGolf, findOfficialSheet, topUpParEvidence, pickSheetCandidate, readMapSheet, resetProviderBreakerForTests, sheetAskUnanswered, sheetSearchQueries, withMapSheet, SHEET_ASK_RETRIES, SHEET_PROVIDERS, SHEET_SEARCH_MAX, type CatalogRow } from '../course-catalog';

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

function fakeAdmin(budget: boolean[] = [], geometry: unknown = null, sheetSources: unknown = undefined, heldEvidence: unknown[] = [], courseEvidence: unknown[] = []) {
  const updates: Array<Record<string, unknown>> = [];
  const keys: string[] = [];
  const released: string[] = [];
  const read: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) read[m] = () => read;
  read.delete = () => ({ eq: async (_col: string, key: string) => { released.push(key); return { error: null }; } });
  // Evidence rows (317): what recordParEvidence wrote, by table.
  const evidence: Array<{ course_id: string; source: string; label: string; votes: boolean; pars: Array<number | null> }> = [];
  const evidenceTable = {
    upsert: async (rows: typeof evidence) => { evidence.push(...rows); return { error: null }; },
    delete: () => ({ eq: () => ({ eq: () => ({ lt: async () => ({ error: null }) }) }) }),
    // topUpParEvidence asks whether the course already holds the provider's boxes.
    // confirmParsFromOpenGolf reads every row the course holds (one eq, awaited).
    select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: heldEvidence, error: null }) }), then: (resolve: (v: unknown) => void) => resolve({ data: courseEvidence, error: null }) }) }),
  };
  read.maybeSingle = async () => ({ data: { hole_geometry: geometry, ...(sheetSources === undefined ? {} : { sheet_sources: sheetSources }) }, error: null });
  read.update = (fields: Record<string, unknown>) => {
    updates.push(fields);
    // Awaited after .eq(), or after .eq().is() (a write guarded on a null column).
    const done = Object.assign(Promise.resolve({ error: null }), { is: async () => ({ error: null }) });
    return { eq: () => done };
  };
  const answers = [...budget];
  const admin = {
    rpc: (_fn: string, args: { p_key: string }) => {
      keys.push(args.p_key);
      return { single: async () => ({ data: { allowed: answers.shift() ?? true }, error: null }) };
    },
    from: (table?: string) => (table === 'golf_par_evidence' ? evidenceTable : read),
  };
  return { admin: admin as never, updates, keys, released, evidence };
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

function stubProviders(over: { openGolfSearch?: unknown; openGolf?: unknown; gcaSearch?: unknown; gca?: unknown; gcaById?: Record<string, unknown>; fail?: string } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const host = url.includes('opengolfapi.org') ? 'opengolfapi' : 'golfcourseapi';
    const kind = url.includes('search') ? 'search' : 'detail';
    calls.push(`${host}:${kind}`);
    if (over.fail === `${host}:${kind}`) return { ok: false, status: 503, json: async () => ({}) };
    const body =
      host === 'opengolfapi'
        ? kind === 'search' ? over.openGolfSearch ?? { courses: [{ id: 'og-1', course_name: 'Camelot Golf & Country Club', city: 'Cumberland', state: 'ON', country_iso: 'CA' }] } : over.openGolf ?? openGolfDetail()
        : kind === 'search' ? over.gcaSearch ?? { courses: [{ id: 'gca-1', club_name: 'Camelot Golf & Country Club', course_name: 'Camelot', location: { city: 'Cumberland', state: 'ON', country: 'Canada' } }] } : over.gcaById?.[url.split('/').pop()!] ?? over.gca ?? gcaDetail();
    return { ok: true, json: async () => body };
  }));
  return calls;
}

beforeEach(() => {
  vi.stubEnv('GOLF_COURSE_API_KEY', 'k');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetProviderBreakerForTests(); });

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
    // The day's ask is allowed, OpenGolfAPI's budget is not. (Another day: the failed host's short skip is over.)
    resetProviderBreakerForTests();
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
    // …and while that host is being skipped the reason is still a provider's trouble, not "no match".
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

// Nov 19 2026: GolfCourseAPI holds Glen Abbey (Oakville) twice: same name, same
// address, same coordinates. Two indistinguishable candidates used to mean no
// card. One course listed twice is asked for by each id; the answers must be one card.
describe('one course listed twice by a provider', () => {
  const OAKVILLE = { city: 'Oakville', state: 'ON', country: 'Canada', latitude: 43.4524049, longitude: -79.717847 };
  const twins = { courses: ['twin-a', 'twin-b'].map(id => ({ id, club_name: 'Glen Abbey Golf Club', course_name: 'Glen Abbey Golf Club', location: OAKVILLE })) };
  const glenAbbey = () => row({ name: 'Glen Abbey', city: 'Oakville', lat: 43.4527, lng: -79.7169 });
  const card = (id: string, pars = NINE.map(() => 4)) => ({ course: { ...gcaDetail(pars).course, id } });
  const empty = (id: string) => ({ course: { id, club_name: 'Glen Abbey Golf Club', course_name: 'Glen Abbey Golf Club', location: OAKVILLE, tees: {} } });

  it('the first listing has no holes: the second one\'s card is taken', async () => {
    const calls = stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: twins, gcaById: { 'twin-a': empty('twin-a'), 'twin-b': card('twin-b') } });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, glenAbbey());
    expect(calls.filter(c => c === 'golfcourseapi:detail')).toHaveLength(2);
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(r.trace!.find(t => t.source === 'golfcourseapi')).toMatchObject({ candidates: 2, picked: 'twin-b', result: 'filled' });
    expect(updates).toHaveLength(1);
  });

  it('both listings hold the same card: taken once', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: twins, gcaById: { 'twin-a': card('twin-a'), 'twin-b': card('twin-b') } });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, glenAbbey());
    expect(r.trace!.find(t => t.source === 'golfcourseapi')).toMatchObject({ picked: 'twin-a', result: 'filled' });
    expect(updates).toHaveLength(1);
  });

  it('the listings hold DIFFERENT cards: they are not one course, nothing is saved', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: twins, gcaById: { 'twin-a': card('twin-a'), 'twin-b': card('twin-b', [5, 5, 5, 3, 3, 3, 4, 4, 4]) } });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, glenAbbey());
    expect(r.found).toBe(false);
    expect(r.trace!.find(t => t.source === 'golfcourseapi')).toMatchObject({ picked: null, result: 'not_narrowed' });
    expect(updates).toEqual([]);
  });

  it('each listing asked for is budgeted; a twin\'s card still has to agree with the map', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: twins, gcaById: { 'twin-a': empty('twin-a'), 'twin-b': card('twin-b') } });
    const { admin, keys } = fakeAdmin();
    await findOfficialSheet(admin, glenAbbey());
    // One search and two details on GolfCourseAPI's key.
    expect(keys.filter(k => k === 'golf-provider:golfcourseapi')).toHaveLength(3);
  });

  it('two courses of one club at one point are NOT twins: no card, and the reason says it is a tie', async () => {
    const markham = { city: 'Markham', state: 'ON', country: 'Canada', latitude: 43.902072, longitude: -79.324842 };
    const calls = stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: { courses: [{ id: 's', club_name: 'Angus Glen Golf Club', course_name: 'South Course', location: markham }, { id: 'n', club_name: 'Angus Glen Golf Club', course_name: 'North Course', location: markham }] } });
    const { admin, updates } = fakeAdmin();
    // (An unlinked club row goes on to be split into its courses: club-split.test.ts. This one is already linked.)
    const r = await findOfficialSheet(admin, row({ name: 'Angus Glen Golf Club', city: 'Markham', lat: 43.8984, lng: -79.3327, club_id: 'club-x', section_kind: 'unspecified' } as Partial<CatalogRow>));
    expect(calls).not.toContain('golfcourseapi:detail');
    expect(r.trace!.find(t => t.source === 'golfcourseapi')).toMatchObject({ candidates: 2, named: 2, picked: null, result: 'not_narrowed' });
    expect(updates).toEqual([]);
  });
});

// Nov 19 2026: GolfCourseAPI lists Ottawa Hunt's three nines as three
// eighteens: "North" is North + South, "South" is South + West, "West" is
// West + North (real pars and Gold yardages below). A nine's card is the
// front of its own listing, taken only when a sibling's back nine says the same.
describe('a nine listed as an eighteen that combines two nines', () => {
  const HUNT = { city: 'Ottawa', state: 'ON', country: 'Canada', latitude: 45.3379788, longitude: -75.6852228 };
  const NINES = {
    North: { pars: '534444435', yds: [482, 194, 443, 411, 398, 424, 375, 180, 523] },
    South: { pars: '444435435', yds: [445, 365, 436, 386, 201, 596, 475, 195, 561] },
    West: { pars: '544343435', yds: [554, 405, 419, 172, 432, 185, 401, 151, 544] },
  };
  type Nine = keyof typeof NINES;
  const BACK: Record<Nine, Nine> = { North: 'South', South: 'West', West: 'North' };
  const ID: Record<Nine, string> = { North: 'qjxgwhx7', South: '7t91wa4y', West: 'wfyry8me' };
  const eighteen = (front: Nine, back: Nine = BACK[front], tee = 'Gold') => ({
    course: {
      id: ID[front], club_name: 'Ottawa Hunt & Golf Club', course_name: front, location: HUNT,
      tees: { male: [{ tee_name: `${front[0]}${back[0].toLowerCase()} ${tee}`, course_rating: 74, slope_rating: 140, number_of_holes: 18, par_total: 72, holes: [...NINES[front].pars].map((p, i) => ({ par: Number(p), yardage: NINES[front].yds[i], handicap: 2 * i + 1 })).concat([...NINES[back].pars].map((p, i) => ({ par: Number(p), yardage: NINES[back].yds[i], handicap: 2 * i + 2 }))) }] },
    },
  });
  const search = { courses: (['West', 'North', 'South'] as Nine[]).map(n => ({ id: ID[n], club_name: 'Ottawa Hunt & Golf Club', course_name: n, location: HUNT })) };
  const nineRow = (n: Nine) => row({ name: `Ottawa Hunt and Golf Club (${n} Nine)`, city: 'Nepean', lat: 45.3417, lng: -75.6829, section_name: `${n} Nine`, section_kind: 'nine', holes_count: 9 } as Partial<CatalogRow>);
  const all = () => ({ [ID.North]: eighteen('North'), [ID.South]: eighteen('South'), [ID.West]: eighteen('West') });

  it.each(['North', 'South', 'West'] as Nine[])('%s takes the front nine of its own listing, confirmed by a sibling', async n => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: search, gcaById: all() });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, nineRow(n));
    expect(r).toMatchObject({ found: true, outcome: 'found' });
    expect(r.trace!.find(t => t.source === 'golfcourseapi')).toMatchObject({ picked: ID[n], fromCombination: true, result: 'filled' });
    expect(r.course.holes).toHaveLength(9);
    expect(r.course.holes.map(h => h.par).join('')).toBe(NINES[n].pars);
    expect(r.course.holes.map(h => Object.values(h.yardage)[0])).toEqual(NINES[n].yds);
    // An eighteen's ratings and stroke indexes are not a nine's.
    expect(r.course.courseRating).toEqual({});
    expect(r.course.holes.every(h => !h.handicap)).toBe(true);
    expect(updates[0]).toMatchObject({ holes_count: 9, total_par: [...NINES[n].pars].reduce((s, p) => s + Number(p), 0) });
  });

  it('no sibling confirms it: the eighteen is refused, as before', async () => {
    // The siblings' back nines are something else (West's back is South here, not North).
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: search, gcaById: { [ID.North]: eighteen('North'), [ID.South]: eighteen('South', 'South'), [ID.West]: eighteen('West', 'South') } });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, nineRow('North'));
    expect(r.found).toBe(false);
    expect(r.trace!.find(t => t.source === 'golfcourseapi')!.result).toBe('wrong_holes');
    expect(updates).toEqual([]);
  });

  it('the siblings asked for are budgeted, and an eighteen row never takes this path', async () => {
    const calls = stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: search, gcaById: all() });
    const { admin, keys } = fakeAdmin();
    await findOfficialSheet(admin, nineRow('North'));
    expect(calls.filter(c => c === 'golfcourseapi:detail')).toHaveLength(3);
    expect(keys.filter(k => k === 'golf-provider:golfcourseapi')).toHaveLength(4); // one search, three details
    const calls18 = stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: search, gcaById: all() });
    const r = await findOfficialSheet(fakeAdmin().admin, row({ name: 'Ottawa Hunt and Golf Club (North)', city: 'Nepean', section_name: 'North', section_kind: 'course_18', holes_count: 18 } as Partial<CatalogRow>));
    expect(calls18.filter(c => c === 'golfcourseapi:detail')).toHaveLength(1);
    expect(r.course.holes).toHaveLength(18);
  });

  describe('nineFromCombination', () => {
    const holes = (front: Nine, back: Nine, tee = 'gold'): SheetHole[] =>
      [...NINES[front].pars].map((p, i) => ({ number: i + 1, par: Number(p), yardage: { [tee]: NINES[front].yds[i] }, handicap: i + 1 }))
        .concat([...NINES[back].pars].map((p, i) => ({ number: i + 10, par: Number(p), yardage: { [tee]: NINES[back].yds[i] }, handicap: i + 10 })));
    it('the front nine, renumbered, when a sibling\'s back nine has the same pars and one tee\'s yardages', () => {
      const nine = nineFromCombination(holes('North', 'South', 'ns gold'), [holes('South', 'West', 'sw gold'), holes('West', 'North', 'wn gold')])!;
      expect(nine.map(h => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(nine.map(h => h.par).join('')).toBe(NINES.North.pars);
      expect(nine.map(h => h.yardage['ns gold'])).toEqual(NINES.North.yds);
    });
    it('null: no sibling, the same pars with other yardages, one par apart, or not an eighteen', () => {
      const card = holes('North', 'South');
      expect(nineFromCombination(card, [])).toBeNull();
      expect(nineFromCombination(card, [holes('South', 'West')])).toBeNull();
      const otherYards = holes('West', 'North').map(h => (h.number >= 10 ? { ...h, yardage: { gold: h.yardage.gold + 7 } } : h));
      expect(nineFromCombination(card, [otherYards])).toBeNull();
      const onePar = holes('West', 'North').map(h => (h.number === 12 ? { ...h, par: h.par + 1 } : h));
      expect(nineFromCombination(card, [onePar])).toBeNull();
      expect(nineFromCombination(card.slice(0, 9), [holes('West', 'North')])).toBeNull();
      expect(nineFromCombination(card, [holes('West', 'North').slice(0, 9)])).toBeNull();
    });
  });
});

// Nov 19 2026: OpenGolfAPI answered HTTP 500 after 20 s for hours, and every
// pick waited out the whole timeout on it before asking the provider that
// worked. A host that just failed is skipped for a few minutes.
describe('a provider that is down is not waited on by the next pick', () => {
  it('the first pick meets the failure; the second skips that provider, spends none of its budget, and still gets the card', async () => {
    const calls = stubProviders({ fail: 'opengolfapi:search' });
    const first = fakeAdmin();
    const one = await findOfficialSheet(first.admin, row());
    expect(calls).toEqual(['opengolfapi:search', 'golfcourseapi:search', 'golfcourseapi:detail']);
    expect(one.trace!.find(t => t.source === 'opengolfapi')!.result).toBe('provider_error');
    expect(one.found).toBe(true);

    calls.length = 0;
    const second = fakeAdmin();
    const two = await findOfficialSheet(second.admin, row({ id: 'c2' }));
    expect(calls).toEqual(['golfcourseapi:search', 'golfcourseapi:detail']);
    expect(two.trace!.find(t => t.source === 'opengolfapi')!.result).toBe('provider_down');
    expect(second.keys.filter(k => k === 'golf-provider:opengolfapi')).toEqual([]);
    expect(two).toMatchObject({ found: true, outcome: 'found' });
  });

  it('"not found" is an answer, not an outage: the provider is asked again next time', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const host = url.includes('opengolfapi.org') ? 'opengolfapi' : 'golfcourseapi';
      calls.push(host);
      return host === 'opengolfapi' ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, json: async () => ({ courses: [] }) };
    }));
    await findOfficialSheet(fakeAdmin().admin, row());
    calls.length = 0;
    await findOfficialSheet(fakeAdmin().admin, row({ id: 'c2' }));
    expect(calls).toContain('opengolfapi');
  });
});

// Nov 20 2026: Ottawa Hunt's West Nine met one failed detail call and could not
// be asked again for a day. A provider's trouble is not the course's answer.
describe('a provider error does not spend the course\'s ask for the day', () => {
  it('pure rule: any provider that failed or was skipped leaves the ask unanswered', () => {
    expect(sheetAskUnanswered([{ result: 'no_candidates' }, { result: 'provider_error' }])).toBe(true);
    expect(sheetAskUnanswered([{ result: 'provider_down' }, { result: 'not_narrowed' }])).toBe(true);
    expect(sheetAskUnanswered([{ result: 'no_candidates' }, { result: 'no_name_match' }])).toBe(false);
    expect(sheetAskUnanswered([{ result: 'budget_refused' }])).toBe(false);
    expect(sheetAskUnanswered([])).toBe(false);
  });

  it('a failed detail call: nothing saved, the ask is handed back and the retry is counted', async () => {
    stubProviders({ fail: 'golfcourseapi:detail', openGolfSearch: { courses: [] } });
    const { admin, updates, keys, released } = fakeAdmin();
    const r = await findOfficialSheet(admin, row());
    expect(r.outcome).toBe('provider_error');
    expect(updates).toEqual([]);
    expect(released).toEqual([`golf-sheet-ask:${row().id}`]);
    expect(keys[keys.length - 1]).toBe(`golf-sheet-retry:${row().id}`);
  });

  it('an honest "no match" keeps the ask spent', async () => {
    stubProviders({ openGolfSearch: { courses: [] }, gcaSearch: { courses: [] } });
    const { admin, keys, released } = fakeAdmin();
    expect((await findOfficialSheet(admin, row())).outcome).toBe('no_match');
    expect(released).toEqual([]);
    expect(keys.some(k => k.startsWith('golf-sheet-retry:'))).toBe(false);
  });

  it(`after ${SHEET_ASK_RETRIES} hand-backs in a day the ask stays spent`, async () => {
    stubProviders({ fail: 'golfcourseapi:search', openGolfSearch: { courses: [] } });
    // The last budget answer is the retry counter's: refused.
    const probe = fakeAdmin();
    await findOfficialSheet(probe.admin, row());
    resetProviderBreakerForTests();
    const answers = probe.keys.map(k => !k.startsWith('golf-sheet-retry:'));
    const { admin, released } = fakeAdmin(answers);
    expect((await findOfficialSheet(admin, row())).outcome).toBe('provider_error');
    expect(released).toEqual([]);
  });

  it('a card saved from the provider that worked keeps the ask spent', async () => {
    stubProviders({ fail: 'opengolfapi:search' });
    const { admin, released } = fakeAdmin();
    expect((await findOfficialSheet(admin, row())).found).toBe(true);
    expect(released).toEqual([]);
  });
});

// Nov 20 2026: the saved card says so when the provider's own tees disagreed.
describe('a provider whose tee boxes disagree on a par', () => {
  it('the card most boxes share is saved and the disputed hole is recorded with the sources', async () => {
    const pars = NINE.map(() => 4);
    const odd = [5, ...pars.slice(1)];
    const base = gcaDetail(pars).course;
    const box = (tee_name: string, p: number[], par_total: number) => ({ tee_name, course_rating: 71, slope_rating: 128, number_of_holes: 9, par_total, holes: NINE.map((n, i) => ({ par: p[i], yardage: 400 + n, handicap: n })) });
    stubProviders({ openGolfSearch: { courses: [] }, gca: { course: { ...base, tees: { male: [box('Black', odd, 37), box('Blue', pars, 36), box('White', pars, 36)] } } } });
    const { admin, updates } = fakeAdmin();
    const r = await findOfficialSheet(admin, row());
    expect(r.outcome).toBe('found');
    const saved = updates[0] as { hole_data: Array<{ par: number }>; total_par: number; sheet_sources?: { pars?: string; parsDisputed?: number[] } };
    expect(saved.hole_data.map(h => h.par)).toEqual(pars);
    expect(saved.total_par).toBe(36);
    expect(saved.sheet_sources).toMatchObject({ pars: 'golfcourseapi', parsDisputed: [1] });
  });

  it('tees that agree record no dispute', async () => {
    stubProviders({ openGolfSearch: { courses: [] } });
    const { admin, updates } = fakeAdmin();
    await findOfficialSheet(admin, row());
    expect((updates[0] as { sheet_sources?: { parsDisputed?: number[] } }).sheet_sources?.parsDisputed).toBeUndefined();
  });
});

// Nov 20 2026 (migration 317): what each source said is kept with the course.
describe('the lookup keeps what each source said as evidence', () => {
  it('GolfCourseAPI: one row per tee box, kept even though the card took one par row', async () => {
    const pars = NINE.map(() => 4);
    const odd = [5, ...pars.slice(1)];
    const base = gcaDetail(pars).course;
    const box = (tee_name: string, p: number[], par_total: number) => ({ tee_name, course_rating: 71, slope_rating: 128, number_of_holes: 9, par_total, holes: NINE.map((n, i) => ({ par: p[i], yardage: 400 + n, handicap: n })) });
    stubProviders({ openGolfSearch: { courses: [] }, gca: { course: { ...base, tees: { male: [box('Black', odd, 37), box('Blue', pars, 36)], female: [box('Blue', odd, 37)] } } } });
    const { admin, evidence } = fakeAdmin();
    expect((await findOfficialSheet(admin, row())).outcome).toBe('found');
    expect(evidence.map(e => [e.source, e.label, e.votes, e.pars.join('')])).toEqual([
      ['golfcourseapi', 'black', true, odd.join('')],
      ['golfcourseapi', 'blue', true, pars.join('')],
      ['golfcourseapi', 'blue (f)', false, odd.join('')],
    ]);
    expect(evidence.every(e => e.course_id === row().id)).toBe(true);
  });

  it('both providers answering: each one\'s rows are kept under its own name', async () => {
    stubProviders();
    const { admin, evidence } = fakeAdmin();
    await findOfficialSheet(admin, row());
    expect([...new Set(evidence.map(e => e.source))].sort()).toEqual(['golfcourseapi', 'opengolfapi']);
    expect(evidence.find(e => e.source === 'opengolfapi')).toMatchObject({ label: '', votes: false });
  });

  const mapOfPar3s = { source: 'osm', greens: [], holes: NINE.map((_, i) => ({ hole: i + 1, par: 3, line: [[45.3 + i * 0.001, -75.7], [45.3004 + i * 0.001, -75.7]] })) };

  it('an answer refused for disagreeing with the map may be another course: nothing is kept from it', async () => {
    // Its pars do not add up to its own total, so it cannot overrule the map either.
    const bad = gcaDetail();
    for (const tee of bad.course.tees.male) tee.par_total = 35;
    stubProviders({ openGolfSearch: { courses: [] }, gca: bad });
    const { admin, evidence } = fakeAdmin([], mapOfPar3s);
    expect((await findOfficialSheet(admin, row())).outcome).toBe('map_disagrees');
    expect(evidence).toEqual([]);
  });

  it('one provider taken against the map: what it said is kept', async () => {
    stubProviders({ openGolfSearch: { courses: [] } });
    const { admin, evidence } = fakeAdmin([], mapOfPar3s);
    expect((await findOfficialSheet(admin, row())).outcome).toBe('found');
    expect(evidence.map(e => e.source)).toEqual(['golfcourseapi', 'golfcourseapi']);
  });
});

// Nov 20 2026 (phase 2): a card saved from GolfCourseAPI before its tee boxes
// were kept gets them once, on a person's pick, so it can be judged.
describe('an older card gets its tee boxes once, on a pick', () => {
  const whole = () => {
    const card = gcaDetail().course.tees.male[0].holes.map((h, i) => ({ number: i + 1, par: h.par as number, yardage: { blue: h.yardage }, handicap: i + 1 }));
    return row({ hole_data: card as never, total_par: 36, holes_count: 9, course_rating: { blue: 71 } as never, slope_rating: { blue: 128 } as never });
  };

  it('pars credited to GolfCourseAPI, no boxes held: one search and one detail, the boxes are kept', async () => {
    const calls = stubProviders();
    const { admin, evidence, keys, updates } = fakeAdmin([], null, { pars: 'golfcourseapi' });
    expect(await topUpParEvidence(admin, whole())).toBe('kept');
    expect(calls).toEqual(['golfcourseapi:search', 'golfcourseapi:detail']);
    expect(keys[0]).toBe(`golf-par-evidence-ask:${row().id}`);
    expect(evidence.map(e => [e.source, e.label])).toEqual([['golfcourseapi', 'blue'], ['golfcourseapi', 'white']]);
    // The card itself is not written by the top-up.
    expect(updates).toEqual([]);
  });

  it('nothing is asked when the boxes are already held, when another source supplied the pars, or on the provider\'s own row', async () => {
    const calls = stubProviders();
    expect(await topUpParEvidence(fakeAdmin([], null, { pars: 'golfcourseapi' }, [{ label: 'blue' }]).admin, whole())).toBe('not_needed');
    expect(await topUpParEvidence(fakeAdmin([], null, { pars: 'opengolfapi' }).admin, whole())).toBe('not_needed');
    expect(await topUpParEvidence(fakeAdmin([], null, { pars: 'golfcourseapi' }).admin, { ...whole(), external_source: 'golfcourseapi' } as never)).toBe('not_needed');
    expect(calls).toEqual([]);
  });

  it('once a day per course, and an answer that is not the saved card\'s course is not kept', async () => {
    const calls = stubProviders();
    expect(await topUpParEvidence(fakeAdmin([false], null, { pars: 'golfcourseapi' }).admin, whole())).toBe('not_today');
    expect(calls).toEqual([]);
    stubProviders({ gca: gcaDetail(NINE.map(() => 5)) });
    const { admin, evidence } = fakeAdmin([], null, { pars: 'golfcourseapi' });
    expect(await topUpParEvidence(admin, whole())).toBe('no_match');
    expect(evidence).toEqual([]);
  });
});

// Nov 20 2026, the evening: a complete card whose tees disagree on a par is
// put to the other provider once a day on a pick, as a confirmation. The card
// itself is never written here.
describe('OpenGolfAPI confirms a complete card\'s pars', () => {
  const SAVED = [4, 4, 4, 4, 5, 4, 4, 4, 4];
  const whole = () => row({ hole_data: SAVED.map((par, i) => ({ number: i + 1, par, yardage: { blue: 400 + i }, handicap: i + 1 })) as never, total_par: 37, holes_count: 9 });
  const boxes = (...pars: number[][]) => pars.map((p, i) => ({ source: 'golfcourseapi', votes: true, label: `t${i}`, pars: p }));
  const DISAGREE = boxes(SAVED, [4, 4, 4, 4, 4, 4, 4, 4, 4]);

  it('tees that disagree, no OpenGolfAPI row yet: one search and one detail, its par row is kept as evidence and the card is untouched', async () => {
    const calls = stubProviders({ openGolf: openGolfDetail(SAVED) });
    const { admin, evidence, keys, updates } = fakeAdmin([], null, { pars: 'golfcourseapi' }, [], DISAGREE);
    expect(await confirmParsFromOpenGolf(admin, whole())).toBe('kept');
    expect(calls).toEqual(['opengolfapi:search', 'opengolfapi:detail']);
    expect(evidence).toEqual([expect.objectContaining({ source: 'opengolfapi', label: '', votes: false, pars: SAVED })]);
    expect(keys[0]).toBe('golf-par-confirm-ask:c1');
    expect(updates.filter(u => 'hole_data' in u)).toEqual([]);
    expect(updates).toEqual([]); // this answer names no website
  });

  it('the answer\'s website is kept on a row that has none, and never replaces one', async () => {
    stubProviders({ openGolf: { ...openGolfDetail(SAVED), website: 'https://camelotgolf.example/' } });
    const bare = fakeAdmin([], null, undefined, [], DISAGREE);
    expect(await confirmParsFromOpenGolf(bare.admin, whole())).toBe('kept');
    expect(bare.updates).toEqual([{ website: 'https://camelotgolf.example/' }]);
    const has = fakeAdmin([], null, undefined, [], DISAGREE);
    expect(await confirmParsFromOpenGolf(has.admin, { ...whole(), website: 'https://own.example/' })).toBe('kept');
    expect(has.updates).toEqual([]);
  });

  it('nothing to confirm, or already answered: the provider is not asked', async () => {
    const calls = stubProviders();
    expect(await confirmParsFromOpenGolf(fakeAdmin([], null, undefined, [], boxes(SAVED, SAVED)).admin, whole())).toBe('not_needed');
    expect(await confirmParsFromOpenGolf(fakeAdmin([], null, undefined, [], [...DISAGREE, { source: 'opengolfapi', votes: false, label: '', pars: SAVED }]).admin, whole())).toBe('not_needed');
    expect(await confirmParsFromOpenGolf(fakeAdmin().admin, whole())).toBe('not_needed');
    expect(calls).toEqual([]);
  });

  it('once a day per course; a card of another length or one that differs on three holes is another card', async () => {
    const calls = stubProviders();
    expect(await confirmParsFromOpenGolf(fakeAdmin([false], null, undefined, [], DISAGREE).admin, whole())).toBe('not_today');
    expect(calls).toEqual([]);
    stubProviders({ openGolf: openGolfDetail([5, 5, 5, 4, 5, 4, 4, 4, 4]) });
    const other = fakeAdmin([], null, undefined, [], DISAGREE);
    expect(await confirmParsFromOpenGolf(other.admin, whole())).toBe('no_match');
    expect(other.evidence).toEqual([]);
    stubProviders({ openGolfSearch: { courses: [] } });
    expect(await confirmParsFromOpenGolf(fakeAdmin([], null, undefined, [], DISAGREE).admin, whole())).toBe('no_match');
  });
});
