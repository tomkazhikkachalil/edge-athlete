import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { findOfficialSheet, SHEET_PROVIDERS, type CatalogRow } from '../course-catalog';

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

function fakeAdmin(budget: boolean[] = []) {
  const updates: Array<Record<string, unknown>> = [];
  const keys: string[] = [];
  const read: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) read[m] = () => read;
  read.maybeSingle = async () => ({ data: { hole_geometry: null }, error: null });
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
