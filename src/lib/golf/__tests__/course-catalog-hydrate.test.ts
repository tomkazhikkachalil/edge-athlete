import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { hydrateCourseDetailed, hydrationDue, resetProviderBreakerForTests, sheetFromRow, type CatalogRow } from '../course-catalog';

// H1 (Oct 2026): every hydration ends in a named OUTCOME — logged once, the
// operational ones as Sentry warnings — and the sheet says what is missing.

vi.mock('@/lib/observability/report', () => ({
  reportRouteError: vi.fn(),
  reportRouteWarning: vi.fn(),
}));
import { reportRouteWarning } from '@/lib/observability/report';

const now = Date.now();
const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  id: 'c1', external_source: 'golfcourseapi', external_id: '42', name: 'QA Links', club_name: null, city: null, region: null,
  country: null, total_par: null, holes_count: null, hole_data: null, course_rating: null, slope_rating: null, lat: 45.3, lng: -75.7,
  description: null, description_attribution: null, architect: null, year_built: null, course_type: null, website: null, phone: null,
  hydrated_at: null, place_id: null, country_code: null, region_code: null, location_source: null, club_id: null, section_name: null, section_kind: null,
  ...over,
} as CatalogRow);

/** A fake admin: the rpc budget answers in order, every update is recorded,
 *  the post-update select answers the row the update produced. */
function fakeAdmin(budget: boolean[] = [true, true, true]) {
  const updates: Array<Record<string, unknown>> = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'maybeSingle']) b[m] = () => b;
  b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
  b.update = (fields: Record<string, unknown>) => {
    updates.push(fields);
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'select']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: { ...row(), ...fields }, error: null });
    chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
    return chain;
  };
  const answers = [...budget];
  const admin = {
    rpc: () => ({ single: async () => ({ data: { allowed: answers.shift() ?? true }, error: null }) }),
    from: () => b,
  };
  return { admin: admin as never, updates };
}

const gca = (course: unknown) => ({ course });
const teeBox = (name: string, yards: number[]) => ({ tee_name: name, course_rating: 70.1, slope_rating: 125, par_total: 72, number_of_holes: yards.length, holes: yards.map(y => ({ par: 4, yardage: y, handicap: 1 })) });

beforeEach(() => { vi.stubEnv('GOLF_COURSE_API_KEY', 'k'); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(reportRouteWarning).mockClear(); resetProviderBreakerForTests(); });

/** fetch routed by host: the provider answers `provider`, Nominatim never answers. */
function stubFetch(provider: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }> | never) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('golfcourseapi.com')) return provider();
    return { ok: false, status: 503, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('hydrationDue', () => {
  it('a thin provider row never asked (or asked over 7 days ago) is due; a seed / OSM row never', () => {
    expect(hydrationDue(row())).toBe(true);
    expect(hydrationDue(row({ hydrated_at: new Date(now - 8 * 24 * 3600_000).toISOString() }), now)).toBe(true);
    expect(hydrationDue(row({ hydrated_at: new Date(now - 3600_000).toISOString() }), now)).toBe(false);
    expect(hydrationDue(row({ hole_data: [{ number: 1, par: 4, yardage: { white: 388 }, handicap: 0 }] }))).toBe(false);
    expect(hydrationDue(row({ external_source: 'osm' }))).toBe(false);
    expect(hydrationDue(row({ external_source: 'seed' }))).toBe(false);
  });
});

describe('hydrateCourseDetailed — the outcomes', () => {
  it('fresh → no fetch, no write, quiet', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => gca({ id: 42 }) }));
    const { admin, updates } = fakeAdmin();
    const r = await hydrateCourseDetailed(admin, row({ hydrated_at: new Date(now - 1000).toISOString() }));
    expect(r.outcome.outcome).toBe('fresh');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(reportRouteWarning).not.toHaveBeenCalled();
  });
  it('a refused budget → stamped, a warning', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => gca({ id: 42 }) }));
    const { admin, updates } = fakeAdmin([false, false]);
    const r = await hydrateCourseDetailed(admin, row());
    expect(r.outcome.outcome).toBe('budget_refused');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].hydrated_at).toBeTruthy();
    expect(reportRouteWarning).toHaveBeenCalledTimes(1);
  });
  it('a 500 → http_500 + a warning; a 404 and a null body → console only', async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect((await hydrateCourseDetailed(fakeAdmin().admin, row())).outcome.outcome).toBe('http_500');
    expect(reportRouteWarning).toHaveBeenCalledTimes(1);
    // While that host is skipped: no call, no stamp, no second warning; the row keeps its one attempt.
    const skipped = fakeAdmin();
    const calledBefore = vi.mocked(fetch).mock.calls.length;
    expect((await hydrateCourseDetailed(skipped.admin, row())).outcome.outcome).toBe('provider_down');
    expect(vi.mocked(fetch).mock.calls.length).toBe(calledBefore);
    expect(skipped.updates).toEqual([]);
    expect(reportRouteWarning).toHaveBeenCalledTimes(1);
    resetProviderBreakerForTests();
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect((await hydrateCourseDetailed(fakeAdmin().admin, row())).outcome.outcome).toBe('http_404');
    stubFetch(async () => ({ ok: true, json: async () => ({ course: {} }) }));
    expect((await hydrateCourseDetailed(fakeAdmin().admin, row())).outcome.outcome).toBe('provider_null');
    expect(reportRouteWarning).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
  });
  it('a timeout (AbortError) → timeout; a network error → network — both stamped and warned', async () => {
    stubFetch(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
    const a = fakeAdmin();
    expect((await hydrateCourseDetailed(a.admin, row())).outcome.outcome).toBe('timeout');
    expect(a.updates[0].hydrated_at).toBeTruthy();
    resetProviderBreakerForTests();
    stubFetch(async () => { throw new TypeError('fetch failed'); });
    expect((await hydrateCourseDetailed(fakeAdmin().admin, row())).outcome.outcome).toBe('network');
    expect(reportRouteWarning).toHaveBeenCalledTimes(2);
  });
  it('a detail with no tees → no_tees, hole_data null, stamped', async () => {
    stubFetch(async () => ({ ok: true, json: async () => gca({ id: 42, club_name: 'QA', course_name: 'Links', tees: {} }) }));
    const { admin, updates } = fakeAdmin();
    const r = await hydrateCourseDetailed(admin, row());
    expect(r.outcome).toMatchObject({ outcome: 'no_tees', holes: 0, tees: 0 });
    const write = updates.find(u => 'hole_data' in u)!;
    expect(write.hole_data).toBeNull();
    expect(write.hydrated_at).toBeTruthy();
  });
  it('boxes that disagree in hole count leave no yardage → no_yardage_for_tee', async () => {
    stubFetch(async () => ({ ok: true, json: async () => gca({ id: 42, club_name: 'QA', course_name: 'Links', tees: { male: [{ ...teeBox('white', Array(18).fill(0)), holes: Array.from({ length: 18 }, () => ({ par: 4 })) }] } }) }));
    const r = await hydrateCourseDetailed(fakeAdmin().admin, row());
    expect(r.outcome.outcome).toBe('no_yardage_for_tee');
    expect(r.outcome.holes).toBe(18);
  });
  it('the happy path → ok with the counts; nothing warned', async () => {
    stubFetch(async () => ({ ok: true, json: async () => gca({ id: 42, club_name: 'QA', course_name: 'Links', tees: { male: [teeBox('white', Array(18).fill(388)), teeBox('blue', Array(18).fill(412))] } }) }));
    const { admin } = fakeAdmin();
    const r = await hydrateCourseDetailed(admin, row());
    expect(r.outcome).toMatchObject({ outcome: 'ok', holes: 18, tees: 2, source: 'golfcourseapi', external_id: '42' });
    expect(r.course.holes).toHaveLength(18);
    expect(r.course.hydratedAt).toBeTruthy();
    expect(reportRouteWarning).not.toHaveBeenCalled();
  });
  it('no key → not_configured (a data fact, no warning); a seed row → not_applicable', async () => {
    vi.stubEnv('GOLF_COURSE_API_KEY', '');
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => gca({ id: 42 }) }));
    expect((await hydrateCourseDetailed(fakeAdmin().admin, row())).outcome.outcome).toBe('not_configured');
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('golfcourseapi.com'))).toBe(true);
    expect((await hydrateCourseDetailed(fakeAdmin().admin, row({ external_source: 'seed' }))).outcome.outcome).toBe('not_applicable');
    expect(reportRouteWarning).not.toHaveBeenCalled();
  });
});

describe('sheetFromRow — what is missing', () => {
  it('complete, no holes, holes without any yardage', () => {
    expect(sheetFromRow(row({ hole_data: [{ number: 1, par: 4, yardage: { white: 388 }, handicap: 0 }], course_rating: { white: 70.1 } }))).toMatchObject({ partial: null, source: 'golfcourseapi', courseRating: { white: 70.1 } });
    expect(sheetFromRow(row())).toMatchObject({ partial: 'no_holes', holes: [], courseRating: {}, slopeRating: {} });
    expect(sheetFromRow(row({ hole_data: [{ number: 1, par: 4, yardage: {}, handicap: 0 }, { number: 2, par: 4, yardage: { white: 0 }, handicap: 0 }] })).partial).toBe('no_yardage');
  });
});

// Oct 31 2026: an empty provider answer never erases a sheet the row holds.
// Nov 16 2026: nor does a thinner one — the answer fills, it never replaces.
describe('hydration keeps an existing sheet', () => {
  const stored = {
    total_par: 36, holes_count: 9,
    hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { blue: 400 + i, white: 380 + i }, handicap: i + 1 })),
    course_rating: { blue: 71.2, white: 69.8 }, slope_rating: { blue: 128, white: 122 },
  };

  it('a thinner provider answer leaves every tee, yardage and rating in place', async () => {
    const thin = { tee_name: 'White', par_total: 36, number_of_holes: 9, holes: Array.from({ length: 9 }, () => ({ par: 4, yardage: 300 })) };
    stubFetch(async () => ({ ok: true, json: async () => gca({ id: '42', club_name: 'QA Links', tees: { male: [thin] } }) }));
    const { admin, updates } = fakeAdmin();
    await hydrateCourseDetailed(admin, row(stored));
    const write = updates.find(u => 'hole_data' in u)!;
    expect(write.hole_data).toEqual(stored.hole_data);
    expect(write.course_rating).toEqual(stored.course_rating);
    expect(write.slope_rating).toEqual(stored.slope_rating);
    expect(write.total_par).toBe(36);
  });

  it('an answer adds the tee the card lacked', async () => {
    stubFetch(async () => ({ ok: true, json: async () => gca({ id: '42', club_name: 'QA Links', tees: { male: [teeBox('Gold', [340, 341, 342, 343, 344, 345, 346, 347, 348])] } }) }));
    const { admin, updates } = fakeAdmin();
    await hydrateCourseDetailed(admin, row(stored));
    const write = updates.find(u => 'hole_data' in u)! as { hole_data: Array<{ yardage: Record<string, number> }>; course_rating: Record<string, number> };
    expect(write.hole_data[0].yardage).toEqual({ blue: 400, white: 380, gold: 340 });
    expect(write.course_rating).toEqual({ blue: 71.2, white: 69.8, gold: 70.1 });
  });

  it('a different course under the same id is refused: the card stays', async () => {
    const other = { tee_name: 'Red', par_total: 45, number_of_holes: 9, holes: Array.from({ length: 9 }, () => ({ par: 5, yardage: 250 })) };
    stubFetch(async () => ({ ok: true, json: async () => gca({ id: '42', club_name: 'QA Links', tees: { male: [other] } }) }));
    const { admin, updates } = fakeAdmin();
    await hydrateCourseDetailed(admin, row(stored));
    expect(updates.find(u => 'hole_data' in u)!.hole_data).toEqual(stored.hole_data);
  });
});
